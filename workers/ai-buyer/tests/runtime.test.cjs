const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(name, overrides = {}, cache = {}) {
  if (overrides[name]) return overrides[name]
  if (cache[name]) return cache[name].exports
  const file = path.join(__dirname, '../src', name + '.ts')
  const module = { exports: {} }; cache[name] = module
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'module', 'exports', js)(x => load(x.replace('./', ''), overrides, cache), module, module.exports)
  return module.exports
}
function control() {
  const data = new Map()
  const storage = {
    get: async key => data.get(key), put: async (key, value) => data.set(key, value),
    delete: async key => data.delete(key), setAlarm: async () => {},
    list: async ({ prefix }) => new Map([...data].filter(([key]) => key.startsWith(prefix))),
    transaction: async callback => callback(storage),
  }
  const { ConversationBatcher } = load('batcher', { 'conversation-engine': { runConversationIntake: async () => ({ ok: true }) } })
  const instance = new ConversationBatcher({ storage }, {})
  const stub = { fetch: (url, init) => instance.fetch(new Request(url, init)) }
  return { data, stub, env: { CONVERSATION_BATCHER: { idFromName: x => x, get: () => stub } } }
}

test('credit exhaustion trips a persistent shared circuit; next call makes no provider request', async () => {
  const c = control(); const { guardedOpenAIFetch } = load('runtime-control')
  let calls = 0; const original = global.fetch
  global.fetch = async () => { calls++; return Response.json({ error: { code: 'credit_balance_exhausted' } }, { status: 429 }) }
  try {
    assert.equal((await guardedOpenAIFetch(c.env, { method: 'POST' })).status, 429)
    await assert.rejects(guardedOpenAIFetch(c.env, { method: 'POST' }), /AI_CREDIT_CIRCUIT_OPEN/)
    assert.equal(calls, 1)
    assert.equal(c.data.get('creditCircuit').blocked, true)
    await c.stub.fetch('https://control/circuit/reset', { method: 'POST' })
    assert.equal(c.data.has('creditCircuit'), false)
  } finally { global.fetch = original }
})

test('temporary rate limit does not trip the credit circuit', async () => {
  const c = control(); const { guardedOpenAIFetch } = load('runtime-control')
  const original = global.fetch
  global.fetch = async () => Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429 })
  try { await guardedOpenAIFetch(c.env, {}); assert.equal(c.data.has('creditCircuit'), false) }
  finally { global.fetch = original }
})

test('automated reply failure never falls back to push and token cannot be reused', async () => {
  const c = control(); const { preferredLineSend } = load('line-transport')
  const calls = []; const original = global.fetch
  global.fetch = async url => { calls.push(url); return new Response('invalid reply', { status: 400 }) }
  const input = { lineUserId: 'customer', text: 'ขอสเปคทีครับ', replyToken: 'token', receivedAt: Date.now() }
  try {
    assert.equal((await preferredLineSend({ ...c.env, LINE_CHANNEL_ACCESS_TOKEN: 'test' }, input)).status, 400)
    await assert.rejects(preferredLineSend({ ...c.env, LINE_CHANNEL_ACCESS_TOKEN: 'test' }, input), /ALREADY_CLAIMED/)
    assert.deepEqual(calls, ['https://api.line.me/v2/bot/message/reply'])
  } finally { global.fetch = original }
})

test('expired automated token makes zero LINE requests', async () => {
  const c = control(); const { preferredLineSend } = load('line-transport')
  const original = global.fetch; global.fetch = async () => { throw new Error('unexpected network') }
  try { await assert.rejects(preferredLineSend(c.env, { lineUserId: 'customer', text: 'test', replyToken: 'old', receivedAt: Date.now() - 60000 }), /REPLY_UNAVAILABLE/) }
  finally { global.fetch = original }
})

test('human send uses recent reply first; expired token permits one push with retry key', async () => {
  const c = control(); const { preferredLineSend } = load('line-transport')
  await c.stub.fetch('https://control/reply/remember', { method: 'POST', body: JSON.stringify({ user: 'customer', token: 'fresh', receivedAt: Date.now() }) })
  const calls = []; const original = global.fetch
  global.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({}) }
  const env = { ...c.env, LINE_CHANNEL_ACCESS_TOKEN: 'test' }
  try {
    await preferredLineSend(env, { lineUserId: 'customer', text: 'test', humanPushReason: 'MANUAL_CUSTOMER_RESPONSE', retryKey: 'key' })
    assert.ok(calls[0].url.endsWith('/reply'))
    await c.stub.fetch('https://control/reply/remember', { method: 'POST', body: JSON.stringify({ user: 'customer', token: 'old', receivedAt: Date.now() - 60000 }) })
    await preferredLineSend(env, { lineUserId: 'customer', text: 'necessary', humanPushReason: 'MANUAL_CUSTOMER_RESPONSE', retryKey: 'key2' })
    assert.ok(calls[1].url.endsWith('/push'))
    assert.equal(calls[1].init.headers['X-Line-Retry-Key'], 'key2')
  } finally { global.fetch = original }
})

function intakeFixture(overrides = {}) {
  const c = control(); const now = new Date().toISOString()
  const messages = [{ id: 'msg', direction: 'INBOUND', message_type: 'TEXT', text_content: 'สวัสดีครับ', created_at: now }]
  const row = { id: 'case', category: 'NOTEBOOK', state: 'NEW', control_mode: 'AUTO', metadata: {} }
  return { c, row, messages, batch: { caseId: 'case', conversationId: 'conversation', lineUserId: 'customer', replyToken: 'token', touchedAt: Date.now() },
    fetch: async (url, init) => {
      if (url.includes('api.openai.com')) throw new Error('unexpected paid AI call')
      if (url.includes('api.line.me')) return Response.json({})
      if (url.includes('ai_buyer_category_automation_modes')) return Response.json([{ mode: 'APPROVAL', active: true }])
      if (url.includes('ai_buyer_conversations')) return Response.json([{ id: 'conversation', control_mode: 'AUTO' }])
      if (url.includes('ai_buyer_valuation_cases')) return Response.json([row])
      if (url.includes('ai_buyer_messages') && !init?.method) return Response.json(messages)
      return Response.json([])
    }, ...overrides }
}

test('greeting in APPROVAL uses owner template with zero AI calls, even with credit circuit open', async () => {
  const f = intakeFixture(); const original = global.fetch; global.fetch = f.fetch
  await f.c.stub.fetch('https://control/circuit/trip', { method: 'POST' })
  try {
    const { runConversationIntake } = load('conversation-engine')
    const result = await runConversationIntake({ ...f.c.env, AI_BUYER_INFORMATION_REPLIES: 'true', SUPABASE_URL: 'https://db', SUPABASE_SECRET_KEY: 'test' }, f.batch)
    assert.equal(result.source, 'OWNER_TEMPLATE'); assert.equal(result.sent, true)
  } finally { global.fetch = original }
})

test('fresh complete text takes table-only pricing path without vision or market calls', async () => {
  const f = intakeFixture(); f.row.state = 'READY_TO_PRICE'
  f.row.metadata.deterministicTextEvidenceAt = new Date(Date.now() + 1).toISOString()
  let pricingCalls = 0; const original = global.fetch; global.fetch = f.fetch
  try {
    const { runConversationIntake } = load('conversation-engine', {
      'pricing-router': { runPricingForCase: async env => { assert.equal(env.AI_BUYER_MARKET_ENABLED, 'false'); pricingCalls++; return { ok: true } } },
      'negotiation-engine': { startOfferAfterPricing: async () => ({ handled: true, state: 'PRICING' }) },
    })
    const result = await runConversationIntake({ ...f.c.env, SUPABASE_URL: 'https://db', SUPABASE_SECRET_KEY: 'test' }, f.batch)
    assert.equal(result.source, 'TABLE_ONLY'); assert.equal(pricingCalls, 1)
  } finally { global.fetch = original }
})

test('SHADOW does not send even deterministic information', async () => {
  const f = intakeFixture(); const original = global.fetch
  global.fetch = async (url, init) => url.includes('ai_buyer_category_automation_modes')
    ? Response.json([{ mode: 'SHADOW', active: true }]) : f.fetch(url, init)
  try {
    const { runConversationIntake } = load('conversation-engine')
    const result = await runConversationIntake({ ...f.c.env, AI_BUYER_INFORMATION_REPLIES: 'true', SUPABASE_URL: 'https://db', SUPABASE_SECRET_KEY: 'test' }, f.batch)
    assert.equal(result.sent, false)
  } finally { global.fetch = original }
})
