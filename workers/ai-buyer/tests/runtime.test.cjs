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
    assert.equal(result.source, 'CONTEXTUAL_TEMPLATE'); assert.equal(result.sent, true)
  } finally { global.fetch = original }
})

test('fresh complete text takes table-only pricing path without vision or market calls', async () => {
  const f = intakeFixture(); f.row.state = 'READY_TO_PRICE'
  f.messages[0].text_content = 'ขายโน๊ตบุ๊ค สเปคครบตามที่ส่งครับ'
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

function policyFixture(category = 'CAMERA') {
  return { recent: [], incoming: [], metadata: { lastRequestedInputs: ['MODEL'] }, observations: [], category, state: 'IDENTIFYING_PRODUCT', readyImages: 0 }
}
function turn(f, text, type = 'TEXT') {
  const { contextualReplyPlan } = load('conversation-policy')
  const message = { id: 'msg-' + (f.recent.length + 1), direction: 'INBOUND', message_type: type, text_content: text, created_at: new Date(1700000000000 + f.recent.length * 1000).toISOString() }
  f.incoming = [message]; f.recent.push(message)
  const plan = contextualReplyPlan(f)
  f.metadata.conversationMemory = { ...plan.memory,
    lastRequestKey: plan.requestKey || plan.memory.lastRequestKey, lastReply: plan.reply || plan.memory.lastReply }
  if (plan.reply) f.recent.push({ ...message, id: 'out-' + message.id, direction: 'OUTBOUND', text_content: plan.reply })
  return plan
}

test('camera replay retains SF-1SD, asks for label once, never repeats MODEL or rejects unknown model', () => {
  const f = policyFixture()
  const first = turn(f, 'รับชื้อกล้องถ่านรูปเก่าใช่ไหมคะรับ')
  assert.equal(first.route, 'REPLY')
  const second = turn(f, 'กล้อง canan SF -1SD')
  assert.equal(second.memory.modelCandidate, 'SF-1SD')
  assert.match(second.reply, /SF-1SD/); assert.match(second.reply, /ป้ายรุ่น/)
  assert.equal(second.memory.knownModel, '')
  const third = turn(f, 'รับชื้อไหมครับ')
  assert.equal(third.route, 'HANDOFF'); assert.doesNotMatch(third.reply, /ไม่ได้รับ|ขอรุ่น/)
  const fourth = turn(f, 'SF-1SD')
  assert.equal(fourth.memory.modelCandidate, 'SF-1SD'); assert.doesNotMatch(fourth.reply, /ขอรุ่นที/)
})

test('iPad replay identifies helping intent, gives settings instructions and does not ask storage', () => {
  const f = policyFixture('TABLET'); f.metadata.lastRequestedInputs = ['MODEL', 'STORAGE_VARIANT']
  const first = turn(f, 'อยากทราบรุ่นไอแพดจำไม่ได้ว่ารุ่นอะไร')
  assert.equal(first.memory.intent, 'IDENTIFY_MODEL'); assert.match(first.reply, /การตั้งค่า/)
  assert.doesNotMatch(first.reply, /ขอรุ่น|ความจุ/)
  const second = turn(f, 'จะซื้อเคสมาใส่')
  assert.equal(second.reason, 'CASE_COMPATIBILITY_CONTEXT')
  const third = turn(f, 'หมายเลขเครื่อง มีGD')
  assert.match(third.reply, /หมายเลขรุ่นแทนเลขเครื่อง/); assert.match(third.reply, /A/)
  const fourth = turn(f, 'จำรุ่นไม่แน่ใจ')
  assert.equal(fourth.route, 'HANDOFF'); assert.doesNotMatch(fourth.reply, /ขอรุ่น|ขอ.*ความจุ/)
})

test('supplied storage is retained and removed from stale missing-field requests', () => {
  const f = policyFixture('TABLET'); f.metadata.lastRequestedInputs = ['STORAGE_VARIANT']
  const p = turn(f, 'จุ128')
  assert.equal(p.memory.storage, '128 GB'); assert.notEqual(p.reason, 'MISSING_INFORMATION')
  assert.doesNotMatch(p.reply, /ขอ.*ความจุ/)
})

test('model and storage survive bounded history and customer corrections trigger review', () => {
  const f = policyFixture('SMARTPHONE')
  f.metadata.conversationMemory = { version: 2, intent: 'SELL_ITEM', modelCandidate: 'A1234', knownModel: 'Test phone', storage: '128 GB' }
  f.observations = [{ model_name: 'Test phone', model_code: 'A1234', confirmed: { storage: '128 GB' }, identity_confidence: 0.99 }]
  const p = turn(f, 'ขอแก้ครับ ความจุ256 GB')
  assert.equal(p.memory.storage, '256 GB'); assert.equal(p.route, 'HANDOFF')
})

test('buying question does not enter sell/pricing flow', () => {
  const f = policyFixture('NOTEBOOK')
  const p = turn(f, 'อยากซื้อโน๊ตบุ๊ค มีขายไหมครับ')
  assert.equal(p.memory.intent, 'BUY_ITEM'); assert.equal(p.route, 'HANDOFF')
})

test('generic repair query bypasses stale model template', () => {
  const p = turn(policyFixture('NOTEBOOK'), 'ร้านรับซ่อมไหมครับ')
  assert.equal(p.memory.intent, 'GENERAL'); assert.equal(p.route, 'AI'); assert.equal(p.reply, '')
})

test('repeat request becomes human handoff instead of repeated template', () => {
  const f = policyFixture('NOTEBOOK'); f.metadata.lastRequestedInputs = ['CORE_SPEC']
  const a = turn(f, 'ขายโน๊ตบุ๊คครับ')
  assert.equal(a.route, 'REPLY')
  const b = turn(f, 'รับซื้อไหมครับ')
  assert.equal(b.route, 'HANDOFF'); assert.notEqual(b.reply, a.reply)
})

test('context policy does not infer an exact model from a generic image', () => {
  const f = policyFixture('TABLET'); turn(f, 'อยากทราบรุ่นไอแพดจำไม่ได้')
  f.readyImages = 1
  const p = turn(f, null, 'IMAGE')
  assert.equal(p.route, 'AI'); assert.equal(p.memory.knownModel, '')
})

test('AI customer reply rejects prices and unsupported purchase guarantees', () => {
  const { safeCustomerReply } = load('conversation-policy')
  assert.equal(safeCustomerReply('รับซื้อให้ 5,000 บาทครับ'), '')
  assert.equal(safeCustomerReply('ราคา 5000 ครับ'), '')
  assert.equal(safeCustomerReply('รับซื้อแน่นอนครับ'), '')
  assert.equal(safeCustomerReply('ขอรูปป้ายรุ่นใกล้ ๆ ครับ'), 'ขอรูปป้ายรุ่นใกล้ ๆ ครับ')
})

test('legacy repeated MODEL prompt migrates to a model-finding method', () => {
  const f = policyFixture('NOTEBOOK')
  f.recent = [{ id: 'old', direction: 'OUTBOUND', message_type: 'TEXT', text_content: 'ขอรุ่นทีครับ', created_at: '2020-01-01T00:00:00Z' }]
  const p = turn(f, 'ไม่แน่ใจครับ')
  assert.match(p.reply, /ป้ายรุ่น/); assert.doesNotMatch(p.reply, /^ขอรุ่น/)
})

test('human handoff creates task before replying and transfers control with no AI or push', async () => {
  const f = intakeFixture(); f.messages[0].text_content = 'อยากซื้อคอม มีขายไหมครับ'
  const original = global.fetch; const writes = []; let taskCreated = false
  global.fetch = async (url, init) => {
    if (url.includes('api.openai.com') || url.endsWith('/push')) throw new Error('unexpected AI/push')
    if (url.includes('ai_buyer_admin_tasks') && init?.method === 'POST') { taskCreated = true; writes.push(JSON.parse(init.body)); return Response.json([]) }
    if (url.includes('api.line.me')) { assert.equal(taskCreated, true); return Response.json({}) }
    if (init?.method === 'PATCH') writes.push(JSON.parse(init.body))
    return f.fetch(url, init)
  }
  try {
    const { runConversationIntake } = load('conversation-engine')
    const p = await runConversationIntake({ ...f.c.env, AI_BUYER_INFORMATION_REPLIES: 'true', SUPABASE_URL: 'https://db', SUPABASE_SECRET_KEY: 'test' }, f.batch)
    assert.equal(p.source, 'CONTEXT_HANDOFF'); assert.equal(p.sent, true)
    assert.ok(writes.some(w => w.task_type === 'CONVERSATION_REVIEW'))
    assert.ok(writes.some(w => w.control_mode === 'HUMAN_REQUIRED'))
  } finally { global.fetch = original }
})

test('acknowledgement during offered flow still reaches negotiation handler', async () => {
  const f = intakeFixture(); f.row.state = 'OFFERED'; f.messages[0].text_content = 'ครับ'
  let handled = false; const original = global.fetch; global.fetch = f.fetch
  try {
    const { runConversationIntake } = load('conversation-engine', { 'negotiation-engine': { handleOfferFlow: async () => { handled = true; return { handled: true } } } })
    await runConversationIntake({ ...f.c.env, SUPABASE_URL: 'https://db', SUPABASE_SECRET_KEY: 'test' }, f.batch)
    assert.equal(handled, true)
  } finally { global.fetch = original }
})


test('supplied iPad A-number is handed off for lookup instead of asking that number again', () => {
  const f = policyFixture('TABLET'); turn(f, 'อยากทราบรุ่นไอแพดจำไม่ได้')
  const p = turn(f, 'A2757')
  assert.equal(p.route, 'HANDOFF'); assert.match(p.reply, /ได้รับหมายเลขรุ่น A2757/)
  assert.doesNotMatch(p.reply, /ขอหมายเลข|แตะหมายเลข/)
})

test('image model-help with exhausted credit hands off with zero provider calls', async () => {
  const f = intakeFixture(); f.row.category = 'TABLET'
  f.row.metadata.conversationMemory = { version: 2, intent: 'IDENTIFY_MODEL', modelUnknown: true }
  f.messages[0].message_type = 'IMAGE'; f.messages[0].text_content = null
  await f.c.stub.fetch('https://control/circuit/trip', { method: 'POST' })
  const original = global.fetch; let task = false
  global.fetch = async (url, init) => {
    if (url.includes('api.openai.com')) throw new Error('unexpected provider call')
    if (url.includes('ai_buyer_case_images')) return Response.json([{ id: 'image', analysis_status: 'READY', created_at: new Date().toISOString() }])
    if (url.includes('ai_buyer_admin_tasks') && init?.method === 'POST') task = true
    return f.fetch(url, init)
  }
  try {
    const { runConversationIntake } = load('conversation-engine')
    const p = await runConversationIntake({ ...f.c.env, AI_BUYER_INFORMATION_REPLIES: 'true', SUPABASE_URL: 'https://db', SUPABASE_SECRET_KEY: 'test' }, f.batch)
    assert.equal(p.source, 'CONTEXT_HANDOFF'); assert.equal(p.reason, 'AI_CREDIT_CIRCUIT_OPEN'); assert.equal(task, true)
  } finally { global.fetch = original }
})

test('ambiguous general inquiry sends a bounded contextual AI reply through reply API in APPROVAL', async () => {
  const f = intakeFixture(); f.messages[0].text_content = 'ร้านรับซ่อมไหมครับ'
  const original = global.fetch; const sent = []; let providerCalls = 0
  global.fetch = async (url, init) => {
    if (url.includes('api.openai.com')) {
      providerCalls++; const body = JSON.parse(init.body)
      assert.equal(body.max_output_tokens, 1600)
      assert.ok(body.text.format.schema.required.includes('customer_reply'))
      assert.match(body.input[1].content[0].text, /GENERAL/)
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        intent: 'GENERAL', customer_reply: 'ขอรายละเอียดอาการเครื่องก่อนครับ จะส่งให้พนักงานตรวจว่าดำเนินการได้ไหมครับ',
        category: 'NOTEBOOK', product_title: '', model_name: '', model_code: '', confirmed: [], inferred: [], unknown_fields: [],
        requested_inputs: [], identity_confidence: 0, spec_completeness: 0, condition_completeness: 0, pricing_readiness: 0,
        action: 'ASK_MORE_INFO', asked_if_ai: false, handoff_requested: false, pricing_tags: [], flags: [],
      }) }] }], usage: { input_tokens: 100, output_tokens: 100 } })
    }
    if (url.includes('ai_buyer_analysis_runs') && init?.method === 'POST') return Response.json([{ id: 'analysis' }])
    if (url.includes('api.line.me')) { sent.push(JSON.parse(init.body)); assert.ok(url.endsWith('/reply')); return Response.json({}) }
    return f.fetch(url, init)
  }
  try {
    const { runConversationIntake } = load('conversation-engine')
    const p = await runConversationIntake({ ...f.c.env, AI_BUYER_INFORMATION_REPLIES: 'true', OPENAI_API_KEY: 'test', SUPABASE_URL: 'https://db', SUPABASE_SECRET_KEY: 'test' }, f.batch)
    assert.equal(p.ok, true); assert.equal(p.sent, true); assert.equal(providerCalls, 1)
    assert.match(sent[0].messages[0].text, /รายละเอียดอาการ/); assert.doesNotMatch(sent[0].messages[0].text, /ขอรุ่น/)
  } finally { global.fetch = original }
})
