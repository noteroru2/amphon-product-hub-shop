import { runConversationIntake, type ConversationEngineEnv, type IntakeBatch } from './conversation-engine'

interface BatcherEnv extends ConversationEngineEnv {
  AI_BUYER_BATCH_DEBOUNCE_MS?: string
}

type PendingBatch = IntakeBatch & { retries: number }

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
    if (url.pathname !== '/touch' || request.method !== 'POST') {
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
    }

    await this.state.storage.put('pending', pending)
    await this.state.storage.setAlarm(Date.now() + debounceMs(this.env))
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    })
  }

  async alarm() {
    const pending = await this.state.storage.get<PendingBatch>('pending')
    if (!pending) return

    const result = await runConversationIntake(this.env, pending)
    if (!result.ok && pending.retries < 1) {
      await this.state.storage.put('pending', { ...pending, retries: pending.retries + 1 })
      await this.state.storage.setAlarm(Date.now() + 5000)
      return
    }

    await this.state.storage.delete('pending')
  }
}
