import fs from 'node:fs'

const required = [
  'supabase/migrations/20260919163000_ai_buyer_v1_foundation.sql',
  'supabase/migrations/20260919170000_ai_buyer_checkpoint2_vision.sql',
  'supabase/migrations/20260919173000_ai_buyer_checkpoint2_indexes.sql',
  'supabase/migrations/20260919180000_ai_buyer_checkpoint3_pricing.sql',
  'supabase/migrations/20260920085454_ai_buyer_checkpoint35_spec_pricing.sql',
  'supabase/migrations/20260920093721_ai_buyer_checkpoint4_offer_negotiation.sql',
  'workers/ai-buyer/src/index.ts',
  'workers/ai-buyer/src/batcher.ts',
  'workers/ai-buyer/src/conversation-engine.ts',
  'workers/ai-buyer/src/pricing-engine.ts',
  'workers/ai-buyer/src/spec-pricing-engine.ts',
  'workers/ai-buyer/src/pricing-router.ts',
  'workers/ai-buyer/src/negotiation-engine.ts',
  'workers/ai-buyer/wrangler.jsonc',
  'workers/ai-buyer/package.json',
  'workers/ai-buyer/tsconfig.json',
  'workers/ai-buyer/data/optimization-policy-v1.json',
  'docs/ai-buyer/A_IMPLEMENTATION_SPEC.md',
  'docs/ai-buyer/B_CATEGORY_RULES.md',
  'scripts/verify-ai-buyer-optimization-policy.mjs',
  'supabase/migrations/20260922121500_ai_buyer_p0_offline_replay.sql',
  'workers/ai-buyer/data/p0-regression-fixtures-v1.json',
  'scripts/run-ai-buyer-p0-offline-replay.mjs',
  'docs/ai-buyer/P0_REGRESSION_OFFLINE_REPLAY_REPORT.md',
  'workers/ai-buyer/src/hub-admin.ts',
  'supabase/migrations/20260922195000_ai_buyer_p0_deal_outcome_manual_reply.sql',
  'supabase/migrations/20260922200500_ai_buyer_manual_reply_line_id.sql',
  'supabase/migrations/20260922201500_ai_buyer_learning_dataset_views.sql',
  'docs/ai-buyer/P0_DEAL_OUTCOME_LEDGER.md',
]

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`AI Buyer missing required file: ${file}`)
}

const worker = fs.readFileSync('workers/ai-buyer/src/index.ts', 'utf8')
const batcher = fs.readFileSync('workers/ai-buyer/src/batcher.ts', 'utf8')
const engine = fs.readFileSync('workers/ai-buyer/src/conversation-engine.ts', 'utf8')
const sql1 = fs.readFileSync('supabase/migrations/20260919163000_ai_buyer_v1_foundation.sql', 'utf8')
const sql2 = fs.readFileSync('supabase/migrations/20260919170000_ai_buyer_checkpoint2_vision.sql', 'utf8')
const sql3 = fs.readFileSync('supabase/migrations/20260919173000_ai_buyer_checkpoint2_indexes.sql', 'utf8')
const sql4 = fs.readFileSync('supabase/migrations/20260919180000_ai_buyer_checkpoint3_pricing.sql', 'utf8')
const sql5 = fs.readFileSync('supabase/migrations/20260920085454_ai_buyer_checkpoint35_spec_pricing.sql', 'utf8')
const sql6 = fs.readFileSync('supabase/migrations/20260920093721_ai_buyer_checkpoint4_offer_negotiation.sql', 'utf8')
const pricing = fs.readFileSync('workers/ai-buyer/src/pricing-engine.ts', 'utf8')
const specPricing = fs.readFileSync('workers/ai-buyer/src/spec-pricing-engine.ts', 'utf8')
const pricingRouter = fs.readFileSync('workers/ai-buyer/src/pricing-router.ts', 'utf8')
const negotiation = fs.readFileSync('workers/ai-buyer/src/negotiation-engine.ts', 'utf8')
const wrangler = fs.readFileSync('workers/ai-buyer/wrangler.jsonc', 'utf8')
const hubAdmin = fs.readFileSync('workers/ai-buyer/src/hub-admin.ts', 'utf8')
const outcomeSql = fs.readFileSync('supabase/migrations/20260922195000_ai_buyer_p0_deal_outcome_manual_reply.sql', 'utf8')
const datasetSql = fs.readFileSync('supabase/migrations/20260922201500_ai_buyer_learning_dataset_views.sql', 'utf8')

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
  "from './pricing-router'",
  'canonical keys whenever known',
  'KEYBOARD_DEFECT',
  'outboundAutomationGate',
  "rollout.mode !== 'AUTO'",
  'AI BUYER outbound suppressed by automation gate',
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
  'ai_buyer_conversations_customer_idx',
  'ai_buyer_cases_customer_idx',
  'ai_buyer_messages_webhook_event_idx',
  'ai_buyer_images_message_idx',
  'ai_buyer_images_analysis_run_idx',
  'ai_buyer_analysis_conversation_idx',
  'ai_buyer_pricing_version_idx',
  'ai_buyer_pricing_entry_idx',
  'ai_buyer_offers_case_idx',
  'ai_buyer_tasks_case_idx',
  'ai_buyer_overrides_case_idx',
]) {
  if (!sql3.includes(token)) throw new Error(`AI Buyer performance index missing: ${token}`)
}

for (const token of [
  'ai_buyer_price_book_imports',
  'ai_buyer_category_pricing_rules',
  'ai_buyer_market_comparables',
  'ai_buyer_activate_price_book',
  'ai_buyer_guard_offer_insert',
  'AI_BUYER_HARD_MAX_EXCEEDED',
  'market_enabled boolean not null default false',
  'revoke all on table',
]) {
  if (!sql4.includes(token)) throw new Error(`AI Buyer checkpoint 3 schema invariant missing: ${token}`)
}

for (const token of [
  'normalizeLookup',
  'importPriceBook',
  'bestPriceBookEntry',
  'MARKET_FALLBACK_DISABLED',
  'web_search',
  'web_search_call.action.sources',
  'source_verified',
  'min_market_comparables',
  'max_market_dispersion',
  'createDecision',
  'guardOffer',
  'createGuardedOffer',
  'HARD_MAX_EXCEEDED',
]) {
  if (!pricing.includes(token)) throw new Error(`AI Buyer checkpoint 3 pricing invariant missing: ${token}`)
}


for (const token of [
  'ai_buyer_spec_price_entries',
  'ai_buyer_spec_price_settings',
  'ai_buyer_price_calibrations',
  'enable row level security',
  'grant select, insert, update, delete on table',
]) {
  if (!sql5.includes(token)) throw new Error(`AI Buyer checkpoint 3.5 schema invariant missing: ${token}`)
}

for (const token of [
  'runSpecPricingForCase',
  'SPEC_REQUIRED_COMPONENT_MISSING',
  'SPEC_COMPLEX_CONDITION_REQUIRES_ADMIN',
  'SPEC_PRICING_CONFIDENCE_LOW',
  'SPEC_COMPONENTS_V1',
  'price_book_version_id',
  'current_authorized_offer',
]) {
  if (!specPricing.includes(token)) throw new Error(`AI Buyer checkpoint 3.5 spec pricing invariant missing: ${token}`)
}

for (const token of [
  'runSpecPricingForCase',
  'runLegacyPricingForCase',
]) {
  if (!pricingRouter.includes(token)) throw new Error(`AI Buyer pricing router invariant missing: ${token}`)
}


for (const token of [
  'ai_buyer_category_automation_modes',
  'ai_buyer_negotiation_events',
  'ai_buyer_outbound_actions',
  'ai_buyer_fulfillment_details',
  'ai_buyer_create_guarded_offer',
  'AI_BUYER_OFFER_MUST_BE_MONOTONIC',
  'ai_buyer_accept_offer',
  "mode text not null default 'SHADOW'",
  'enable row level security',
]) {
  if (!sql6.includes(token)) throw new Error(`AI Buyer checkpoint 4 schema invariant missing: ${token}`)
}

for (const token of [
  'startOfferAfterPricing',
  'handleOfferFlow',
  'approvePreparedOffer',
  'parseCounterAmount',
  'isExplicitAcceptance',
  'computeConcession',
  'COLLECTING_FULFILLMENT',
  'PURCHASE_PICKUP',
  'SHADOW',
  'APPROVAL',
  'AUTO',
]) {
  if (!negotiation.includes(token)) throw new Error(`AI Buyer checkpoint 4 negotiation invariant missing: ${token}`)
}

for (const token of [
  "from './negotiation-engine'",
  'markOfferFlowDelivery',
  'offerFlowStates',
  'startOfferAfterPricing',
]) {
  if (!engine.includes(token)) throw new Error(`AI Buyer checkpoint 4 conversation wiring missing: ${token}`)
}

for (const token of [
  '/v1/admin/automation-mode',
  '/v1/admin/offer/approve',
  'approvePreparedOffer',
]) {
  if (!worker.includes(token)) throw new Error(`AI Buyer checkpoint 4 admin invariant missing: ${token}`)
}

for (const token of [
  '/v1/hub/admin/manual-reply',
  '/v1/hub/admin/final-outcome',
  '/v1/hub/admin/deal-ledger',
  'handleHubAdminManualReply',
  'handleHubAdminFinalOutcome',
  'handleHubAdminDealLedger',
]) {
  if (!worker.includes(token)) throw new Error(`AI Buyer P0 Hub route missing: ${token}`)
}

for (const token of [
  'ai_buyer_prepare_manual_reply',
  'ai_buyer_finalize_manual_reply',
  'ai_buyer_case_outcomes',
  'ai_buyer_deal_ledger',
  'needsFinalLabel',
  'X-Line-Retry-Key',
]) {
  if (!hubAdmin.includes(token)) throw new Error(`AI Buyer P0 Hub learning invariant missing: ${token}`)
}

for (const token of [
  'ai_buyer_case_outcomes',
  'ai_buyer_deal_ledger',
  'AGREED_PENDING_HANDOVER',
  'PURCHASED',
  'CUSTOMER_DECLINED_PRICE',
  'OWNER_MANUAL',
  'MANUAL_REPLY',
  'ai_buyer_prepare_manual_reply',
  'ai_buyer_finalize_manual_reply',
  'ai_buyer_sync_deal_ledger',
  'CUSTOMER_ACCEPTED',
  'CUSTOMER_DECLINED',
  'PRICE_QUOTE',
]) {
  if (!outcomeSql.includes(token)) throw new Error(`AI Buyer P0 outcome/ledger invariant missing: ${token}`)
}

for (const token of [
  'ai_buyer_learning_deal_dataset_v',
  'ai_buyer_final_label_queue_v',
  'gross_profit',
  'inventory_days',
  'gross_margin_percent',
  'roi_percent',
]) {
  if (!datasetSql.includes(token)) throw new Error(`AI Buyer P0 learning dataset invariant missing: ${token}`)
}

for (const token of [
  '"CONVERSATION_BATCHER"',
  '"new_sqlite_classes"',
  '"AI_BUYER_BATCH_DEBOUNCE_MS"',
  '"OPENAI_VISION_MODEL"',
  '"OPENAI_PRICING_MODEL"',
  '"AI_BUYER_PAUSED": "true"',
]) {
  if (!wrangler.includes(token)) throw new Error(`AI Buyer runtime config missing: ${token}`)
}

for (const forbidden of [
  'LINE_CHANNEL_SECRET"',
  'LINE_CHANNEL_ACCESS_TOKEN"',
  'SUPABASE_SECRET_KEY"',
  'OPENAI_API_KEY"',
  'AI_BUYER_ADMIN_TOKEN"',
]) {
  if (wrangler.includes(forbidden)) throw new Error(`AI Buyer secret must not be committed in wrangler config: ${forbidden}`)
}

console.log('AI BUYER V1 CHECKPOINT 1+2+3+3.5: PASS')
