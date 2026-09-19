import fs from 'node:fs'

const required = [
  'supabase/migrations/20260919163000_ai_buyer_v1_foundation.sql',
  'workers/ai-buyer/src/index.ts',
  'workers/ai-buyer/wrangler.jsonc',
  'workers/ai-buyer/package.json',
  'workers/ai-buyer/tsconfig.json',
]

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`AI Buyer missing required file: ${file}`)
}

const worker = fs.readFileSync('workers/ai-buyer/src/index.ts', 'utf8')
const sql = fs.readFileSync('supabase/migrations/20260919163000_ai_buyer_v1_foundation.sql', 'utf8')
const wrangler = fs.readFileSync('workers/ai-buyer/wrangler.jsonc', 'utf8')

const workerRequirements = [
  "request.headers.get('x-line-signature')",
  'verifyLineSignature',
  'webhookEventId',
  'ctx.waitUntil',
  'api-data.line.me/v2/bot/message/',
  "ai_buyer_case_images",
  "ai-buyer",
]

for (const token of workerRequirements) {
  if (!worker.includes(token)) throw new Error(`AI Buyer worker invariant missing: ${token}`)
}

const sqlRequirements = [
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
]

for (const token of sqlRequirements) {
  if (!sql.includes(token)) throw new Error(`AI Buyer schema invariant missing: ${token}`)
}

for (const forbidden of ['LINE_CHANNEL_SECRET"', 'LINE_CHANNEL_ACCESS_TOKEN"', 'SUPABASE_SECRET_KEY"']) {
  if (wrangler.includes(forbidden)) throw new Error(`AI Buyer secret must not be committed in wrangler config: ${forbidden}`)
}

console.log('AI BUYER V1 FOUNDATION: PASS')
