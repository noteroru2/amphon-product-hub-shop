import { runConversationIntake, type ConversationEngineEnv, type IntakeBatch } from './conversation-engine'

interface BatcherEnv extends ConversationEngineEnv {
  AI_BUYER_BATCH_DEBOUNCE_MS?: string
}

type PendingBatch = IntakeBatch & { retries: number; generation: string }

function debounceMs(env: BatcherEnv) {
  const value = Number(env.AI_BUYER_BATCH_DEBOUNCE_MS || 2500)
  if (!Number.isFinite(value)) return 2500
  return Math.max(500, Math.min(8000, Math.floor(value)))
}

export class ConversationBatcher {
  private state: DurableObjectState
  private env: BatcherEnv

  constructor(state: DurableObjectState, env: BatcherEnv) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/circuit/status' && request.method === 'GET') {
      return Response.json(await this.state.storage.get('creditCircuit') || { blocked: false })
    }
    if (url.pathname === '/circuit/trip' && request.method === 'POST') {
      const circuit = { blocked: true, reason: 'CREDIT_EXHAUSTED', since: new Date().toISOString() }
      await this.state.storage.put('creditCircuit', circuit)
      return Response.json(circuit)
    }
    if (url.pathname === '/circuit/reset' && request.method === 'POST') {
      await this.state.storage.delete('creditCircuit')
      return Response.json({ blocked: false })
    }
    if (url.pathname === '/reply/remember' && request.method === 'POST') {
      const value = await request.json() as { user: string; token: string; receivedAt: number }
      if (!value.user || !value.token || !Number.isFinite(value.receivedAt)) return new Response('Invalid reply', { status: 400 })
      await this.state.storage.put('latest:' + value.user, value)
      await this.state.storage.setAlarm(Date.now() + 60000)
      return Response.json({ ok: true })
    }
    if (url.pathname === '/reply/latest' && request.method === 'GET') {
      const key = 'latest:' + url.searchParams.get('user')
      const latest = await this.state.storage.get<{ token: string; receivedAt: number }>(key)
      if (latest && Date.now() - latest.receivedAt < 45000) return Response.json(latest)
      await this.state.storage.delete(key)
      return Response.json({})
    }
    if (url.pathname === '/reply/claim'  && request.method === 'POST') {
      const { hash } = await request.json() as { hash: string }
      if (!/^[a-f0-9]{64}$/.test(hash)) return new Response('Invalid hash', { status: 400 })
      const claimed = await this.state.storage.transaction(async storage => {
        const key = 'reply:' + hash
        if (await storage.get(key)) return false
        await storage.put(key, Date.now())
        return true
      })
      return Response.json({ claimed })
    }
    if (url.pathname !== '/touch'  || request.method !== 'POST') {
      return new Response('Not found', { status: 404 })
    }

    let incoming: IntakeBatch
    try {
      incoming = await request.json() as IntakeBatch
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }

    if (!incoming.conversationId || !incoming.caseId || !incoming.lineUserId) {
      return new Response('Invalid batch', { status: 400 })
    }

    const pending: PendingBatch = {
      conversationId: incoming.conversationId,
      caseId: incoming.caseId,
      lineUserId: incoming.lineUserId,
      replyToken: incoming.replyToken || null,
      touchedAt: Number(incoming.touchedAt || Date.now()),
      retries: 0,
      generation: crypto.randomUUID(),
    }

    if (pending.replyToken) {
      const remembered = await this.env.CONVERSATION_BATCHER!.get(this.env.CONVERSATION_BATCHER!.idFromName('ai-buyer-runtime-control-v1'))
        .fetch('https://control/reply/remember', { method: 'POST', body: JSON.stringify({
          user: pending.lineUserId, token: pending.replyToken, receivedAt: pending.touchedAt,
        }) })
      if (!remembered.ok) return new Response('Reply storage unavailable', { status: 503 })
    }
    await this.state.storage.put('pending', pending)
    await this.state.storage.setAlarm(Date.now() + debounceMs(this.env))
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    })
  }

  async alarm() {
    const pending = await this.state.storage.get<PendingBatch>('pending')
    if (!pending) {
      const tokens = await this.state.storage.list<{ receivedAt: number }>({ prefix: 'latest:' })
      for (const [key, value] of tokens) if (Date.now() - value.receivedAt >= 45000) await this.state.storage.delete(key)
      const claims = await this.state.storage.list<number>({ prefix: 'reply:' })
      for (const [key, at] of claims) if (Date.now() - at > 86400000) await this.state.storage.delete(key)
      return
    }

    const result = await runConversationIntake(this.env, pending)
    const latest = await this.state.storage.get<PendingBatch>('pending')
    if (latest && latest.generation !== pending.generation) return
    if (!result.ok && pending.retries < 1 && !/credit_balance_exhausted|insufficient_quota|AI_CREDIT_CIRCUIT_OPEN|LINE_REPLY_|LINE_SEND_|OPENAI_OUTPUT_|OPENAI_400|AI_RUNTIME_CONTROL_/i.test(String('error' in result ? result.error : ''))) {
      await this.state.storage.put('pending', { ...pending, retries: pending.retries + 1 })
      await this.state.storage.setAlarm(Date.now() + 5000)
      return
    }

    await this.state.storage.delete('pending')
  }
}
