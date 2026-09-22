const required = ['SUPABASE_URL','SUPABASE_SECRET_KEY','LINE_CHANNEL_ACCESS_TOKEN']
for (const key of required) {
  if (!process.env[key]) throw new Error('Missing env ' + key)
}

const base = process.env.SUPABASE_URL.replace(/\/$/, '')
const key = process.env.SUPABASE_SECRET_KEY
const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN

const headers = {
  apikey: key,
  authorization: 'Bearer ' + key,
  'content-type': 'application/json',
}

function bangkokDate(offsetDays = -1) {
  const now = new Date()
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000 + offsetDays * 86400000)
  return bkk.toISOString().slice(0, 10)
}

const statDate = process.env.STAT_DATE || bangkokDate(-1)
if (!/^\d{4}-\d{2}-\d{2}$/.test(statDate)) throw new Error('STAT_DATE invalid')
const compact = statDate.replace(/-/g, '')

const lineResp = await fetch(
  'https://api.line.me/v2/bot/insight/message/delivery?date=' + compact,
  { headers: { authorization: 'Bearer ' + lineToken } },
)
if (!lineResp.ok) {
  throw new Error('LINE insight ' + lineResp.status + ': ' + (await lineResp.text()).slice(0, 500))
}
const payload = await lineResp.json()

const winResp = await fetch(
  base + '/rest/v1/ai_buyer_learning_windows'
    + '?status=in.(CAPTURING,CLOSED,PROCESSING)'
    + '&select=id,name,starts_at,ends_at,status'
    + '&order=created_at.desc',
  { headers },
)
if (!winResp.ok) throw new Error('Window read failed: ' + await winResp.text())
const windows = await winResp.json()

const dayStart = new Date(statDate + 'T00:00:00+07:00')
const dayEnd = new Date(dayStart.getTime() + 86400000)
const relevant = windows.filter((w) =>
  new Date(w.starts_at).getTime() < dayEnd.getTime()
  && new Date(w.ends_at).getTime() > dayStart.getTime()
)

for (const window of relevant) {
  const row = {
    window_id: window.id,
    stat_date: statDate,
    chat_messages: Number(payload.chat || 0),
    api_reply: Number(payload.apiReply || 0),
    api_push: Number(payload.apiPush || 0),
    api_multicast: Number(payload.apiMulticast || 0),
    api_broadcast: Number(payload.apiBroadcast || 0),
    auto_response: Number(payload.autoResponse || 0),
    welcome_response: Number(payload.welcomeResponse || 0),
    raw_payload: payload,
    collected_at: new Date().toISOString(),
  }

  const store = await fetch(
    base + '/rest/v1/ai_buyer_learning_line_delivery_stats?on_conflict=window_id,stat_date',
    {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    },
  )
  if (!store.ok) throw new Error('Stat store failed: ' + await store.text())
}

const close = await fetch(
  base + '/rest/v1/ai_buyer_learning_windows'
    + '?status=eq.CAPTURING&ends_at=lt.' + encodeURIComponent(new Date().toISOString()),
  {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'CLOSED', updated_at: new Date().toISOString() }),
  },
)
if (!close.ok) throw new Error('Window close failed: ' + await close.text())

console.log(JSON.stringify({
  ok: true,
  date: statDate,
  windows: relevant.map((w) => w.id),
  lineManagerChatMessages: Number(payload.chat || 0),
  apiReply: Number(payload.apiReply || 0),
  apiPush: Number(payload.apiPush || 0),
}, null, 2))
