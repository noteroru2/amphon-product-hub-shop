import { runtimeControl, type RuntimeControlEnv } from './runtime-control'

interface LineEnv extends RuntimeControlEnv {
  LINE_CHANNEL_ACCESS_TOKEN: string
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
}

export function usableReplyToken(token: unknown, receivedAt: number, now = Date.now()) {
  return typeof token === 'string' && token.length > 0 && Number.isFinite(receivedAt)
    && receivedAt <= now && now - receivedAt < 45000
}

export async function preferredLineSend(env: LineEnv, input: {
  lineUserId: string; text: string; replyToken?: string | null; receivedAt?: number;
  // Only authenticated, explicit human sends may supply this reason.
  humanPushReason?: 'MANUAL_CUSTOMER_RESPONSE' | 'OWNER_APPROVED_OFFER'; retryKey?: string;
}) {
  let token = input.replyToken
  let receivedAt = input.receivedAt || 0
  if (!token && input.humanPushReason) {
    const events = await runtimeControl(env).fetch('https://control/reply/latest?user=' + encodeURIComponent(input.lineUserId))
    if (!events.ok) throw new Error('LINE_REPLY_LOOKUP_FAILED')
    const latest = await events.json() as { token?: string; receivedAt?: number }
    token = latest.token
    receivedAt = latest.receivedAt || 0
  }
  let canReply = usableReplyToken(token, receivedAt)
  if (canReply) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token!))))
      .map(x => x.toString(16).padStart(2, '0')).join('')
    const claim = await runtimeControl(env).fetch('https://control/reply/claim', {
      method: 'POST', body: JSON.stringify({ hash }),
    })
    if (!claim.ok) throw new Error('LINE_REPLY_CLAIM_FAILED')
    canReply = (await claim.json() as { claimed: boolean }).claimed
    // A claimed token may have been sent successfully or have an unknown delivery result.
    // Never replace that attempt with an automatic push.
    if (!canReply) throw new Error('LINE_REPLY_ALREADY_CLAIMED')
  }
  if (!canReply && !input.humanPushReason) throw new Error('LINE_REPLY_UNAVAILABLE')
  const transport = canReply ? 'reply' : 'push'
  if (transport === 'push' && !input.retryKey) throw new Error('LINE_PUSH_RETRY_KEY_REQUIRED')
  const response = await fetch('https://api.line.me/v2/bot/message/' + transport, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: {
      authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN, 'content-type': 'application/json',
      ...(transport === 'push' ? { 'X-Line-Retry-Key': input.retryKey! } : {}),
    },
    body: JSON.stringify({ ...(canReply ? { replyToken: token } : { to: input.lineUserId }),
      messages: [{ type: 'text', text: input.text }] }),
  })
  // LINE's retry-key conflict confirms a prior push was accepted.
  if (transport === 'push' && response.status === 409 && response.headers.get('x-line-accepted-request-id')) {
    return new Response('{}', { status: 200 })
  }
  // Returning a reply error never triggers a push.
  return response
}
