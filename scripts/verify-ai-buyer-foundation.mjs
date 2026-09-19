import fs from 'node:fs'

const required = [
  'supabase/migrations/20260919163000_ai_buyer_v1_foundation.sql',
  'supabase/migrations/20260919170000_ai_buyer_checkpoint2_vision.sql',
  'workers/ai-buyer/src/index.ts',
  'workers/ai-buyer/src/batcher.ts',
  'workers/ai-buyer/src/conversation-engine.ts',
  'workers/ai-buyer/wrangler.jsonc',
  'workers/ai-buyer/package.json',
  'workers/ai-buyer/tsconfig.json',
]

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`AI Buyer missing required file: ${file}`)
}

const worker = fs.readFileSync('workers/ai-buyer/src/index.ts', 'utf8')
const batcher = fs.readFileSync('workers/ai-buyer/src/batcher.ts', 'utf8')
const engine = fs.readFileSync('workers/ai-buyer/src/conversation-engine.ts', 'utf8')
const sql1 = fs.readFileSync('supabase/migrations/20260919163000_ai_buyer_v1_foundation.sql', 'utf8')
const sql2 = fs.readFileSync('supabase/migrations/20260919170000_ai_buyer_checkpoint2_vision.sql', 'utf8')
const wrangler = fs.readFileSync('workers/ai-buyer/wrangler.jsonc', 'utf8')

for (const token of [
  "request.headers.get('x-line-signature')",
  'verifyLineSignature',
  'webhookEventId',
  'ctx.waitUntil',
  'api-data.line.me/v2/bot/message/',
  'scheduleConversationIntake',
  'CONVERSATION_BATCHER',
]) {
  if (!worker.includes(token)) throw new Error(`AI Buyer worker invariant missing: ${token}`)
}

for (const token of [
  'setAlarm',
  'runConversationIntake',
  'AI_BUYER_BATCH_DEBOUNCE_MS',
]) {
  if (!batcher.includes(token)) throw new Error(`AI Buyer batching invariant missing: ${token}`)
}

for (const token of [
  'CONFIRMED',
  'INFERRED',
  'UNKNOWN',
  'READY_TO_PRICE',
  'HUMAN_REVIEW',
  'OPENAI_API_KEY',
  'https://api.openai.com/v1/responses',
  "type: 'input_image'",
  "type: 'json_schema'",
  'requested_inputs',
  'condition_completeness >= 0.75',
  'identity_confidence >= 0.9',
  'HUMAN_ACTIVE',
  'Never quote, estimate, infer, mention, or suggest a purchase price',
]) {
  if (!engine.includes(token)) throw new Error(`AI Buyer conversation/vision invariant missing: ${token}`)
}

for (const token of [
  'ai_buyer_webhook_events',
  'ai_buyer_valuation_cases',
  'ai_buyer_case_images',
  'ai_buyer_product_observations',
  'ai_buyer_price_book_entries',
  'ai_buyer_pricing_decisions',
  'ai_buyer_admin_tasks',
  'hard_max',
  'current_authorized_offer <= hard_max',
  'enable row level security',
]) {
  if (!sql1.includes(token)) throw new Error(`AI Buyer foundation schema invariant missing: ${token}`)
}

for (const token of [
  'ai_buyer_analysis_runs',
  'analysis_consumed_at',
  'last_analysis_run_id',
  'enable row level security',
]) {
  if (!sql2.includes(token)) throw new Error(`AI Buyer checkpoint 2 schema invariant missing: ${token}`)
}

for (const token of [
  '"CONVERSATION_BATCHER"',
  '"new_sqlite_classes"',
  '"AI_BUYER_BATCH_DEBOUNCE_MS"',
  '"OPENAI_VISION_MODEL"',
]) {
  if (!wrangler.includes(token)) throw new Error(`AI Buyer runtime config missing: ${token}`)
}

for (const forbidden of [
  'LINE_CHANNEL_SECRET"',
  'LINE_CHANNEL_ACCESS_TOKEN"',
  'SUPABASE_SECRET_KEY"',
  'OPENAI_API_KEY"',
]) {
  if (wrangler.includes(forbidden)) throw new Error(`AI Buyer secret must not be committed in wrangler config: ${forbidden}`)
}

console.log('AI BUYER V1 CHECKPOINT 1+2: PASS')
