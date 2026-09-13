import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const required = [
  'supabase/shop_6_2.sql',
  'supabase/migrations/20260912090000_amphon_shop62_payment_e2e_gate.sql',
  'supabase/migrations/20260912103000_amphon_shop62_token_hash_portability.sql',
  'supabase/migrations/20260912113000_amphon_shop62_test_settings_completeness.sql',
  'supabase/migrations/20260912123000_amphon_shop62_gateway_event_ambiguity_fix.sql',
  'supabase/shop_6_2_contract_test.sql',
  'supabase/shop_6_2_verify.sql',
  'deployment/SHOP62-DB-UPGRADE-TEST.ps1',
  'deployment/SHOP62-PROVIDER-E2E.ps1',
  'deployment/SHOP62-PROVIDER-E2E.mjs',
  'deployment/SHOP62-FINAL-ACTIVATION-CHECK.ps1',
  'SHOP62-FINAL-ACTIVATION-CHECK.bat',
  'deployment/SHOP63-CONFIGURE-PRODUCTION.ps1',
  'SHOP63-CONFIGURE-PRODUCTION.bat',
  'SHOP6_2_PROVIDER_E2E_REPORT.md',
  'docs/SHOP62_PAYMENT_E2E_ACCEPTANCE.md',
]

const failures = []
for (const file of required) {
  try { await access(resolve(root, file)) } catch { failures.push(`missing ${file}`) }
}

const sql = await readFile(resolve(root, 'supabase/shop_6_2.sql'), 'utf8')
const shop6Sql = await readFile(resolve(root, 'supabase/shop_6.sql'), 'utf8')
const worker = await readFile(resolve(root, 'workers/r2-upload/src/index.ts'), 'utf8')
const tokenHashFix = await readFile(resolve(root, 'supabase/migrations/20260912103000_amphon_shop62_token_hash_portability.sql'), 'utf8')
const settingsCompletenessFix = await readFile(resolve(root, 'supabase/migrations/20260912113000_amphon_shop62_test_settings_completeness.sql'), 'utf8')
const gatewayAmbiguityFix = await readFile(resolve(root, 'supabase/migrations/20260912123000_amphon_shop62_gateway_event_ambiguity_fix.sql'), 'utf8')
const contractTest = await readFile(resolve(root, 'supabase/shop_6_2_contract_test.sql'), 'utf8')
const providerE2E = await readFile(resolve(root, 'deployment/SHOP62-PROVIDER-E2E.mjs'), 'utf8')
const activationCheck = await readFile(resolve(root, 'deployment/SHOP62-FINAL-ACTIVATION-CHECK.ps1'), 'utf8')
const productionConfig = await readFile(resolve(root, 'deployment/SHOP63-CONFIGURE-PRODUCTION.ps1'), 'utf8')

for (const invariant of [
  'commerce_store_settings_shop62_purchase_ready_check',
  'create_commerce_test_order',
  'record_shop62_provider_acceptance',
  'cleanup_shop62_test_fixtures',
  'shop62_void_warranty_after_refund',
  "update public.commerce_store_settings set purchase_enabled=false where id=1",
]) {
  if (!sql.toLowerCase().includes(invariant.toLowerCase())) failures.push(`SQL invariant missing: ${invariant}`)
}

for (const invariant of ['SHOP62_TEST_TOKEN', '/__shop62/readiness', '/__shop62/checkout', 'refundMatch = url.pathname.match', 'createStripeCheckoutSession', "turnstile: 'BYPASSED_BY_ISOLATED_TEST_ROUTE'"]) {
  if (!worker.includes(invariant)) failures.push(`Worker invariant missing: ${invariant}`)
}

for (const invariant of [
  'create or replace function public.process_gateway_payment_event',
  'v_provider_event_id text := provider_event_id',
  'v_provider_payment_id text := provider_payment_id',
  'on conflict on constraint commerce_payment_events_provider_provider_event_id_key',
  'create or replace function public.mark_commerce_gateway_refund_pending',
  'v_provider_refund_id text := provider_refund_id',
]) {
  if (!gatewayAmbiguityFix.toLowerCase().includes(invariant.toLowerCase())) failures.push(`gateway ambiguity forward fix missing: ${invariant}`)
}
if (!shop6Sql.includes('on conflict on constraint commerce_payment_events_provider_provider_event_id_key')) failures.push('canonical SHOP-6 gateway event definition is not ambiguity-safe')
if (!sql.includes('v_provider_refund_id text := provider_refund_id')) failures.push('canonical SHOP-6.2 refund definition is not ambiguity-safe')
if (/on\s+conflict\s*\(\s*provider\s*,\s*provider_event_id\s*\)/i.test(gatewayAmbiguityFix)) failures.push('gateway event idempotency must target the named unique constraint')
if (/\bdigest\s*\(/i.test(sql)) failures.push('SHOP-6.2 token hashing must not depend on extension-schema digest()')
if (!sql.includes('pg_catalog.sha256') || !tokenHashFix.includes('pg_catalog.sha256')) failures.push('portable built-in SHA-256 token hash fix missing')
for (const invariant of [
  "shipping_country = 'TH'",
  'handling_min_days = 0',
  'handling_max_days = 1',
  'transit_min_days = 1',
  'transit_max_days = 3',
  "return_policy_category = 'FINITE'",
  'return_days = 7',
  "return_method = 'MAIL_AND_IN_STORE'",
  "return_fees = 'CUSTOMER_RESPONSIBILITY'",
  'shipping_country = original.shipping_country',
  'return_policy_category = original.return_policy_category',
]) {
  if (!settingsCompletenessFix.includes(invariant)) failures.push(`SHOP-6.2 test settings completeness fix missing: ${invariant}`)
}
if (/sk_(?:test|live)_[A-Za-z0-9]{12,}/.test(sql + worker)) failures.push('secret-like Stripe key literal found')
if (/sb_secret_[A-Za-z0-9_-]{12,}/.test(sql + worker)) failures.push('secret-like Supabase key literal found')
if (/insert\s+into\s+public\.commerce_listings\s*\(/i.test(contractTest)) failures.push('contract test must reuse the listing created by website publication, not insert a duplicate')
if (/rest\(['"]commerce_listings['"],\s*\{[\s\S]{0,120}?method:\s*['"]POST['"]/m.test(providerE2E)) failures.push('provider E2E must PATCH the publication-created listing, not POST a duplicate')
if (!contractTest.includes('website publication did not create commerce listing')) failures.push('contract listing-trigger assertion missing')
if (!providerE2E.includes('Website publication did not create exactly one commerce listing')) failures.push('provider listing-trigger assertion missing')
if (providerE2E.includes('process.exit(')) failures.push('provider E2E must allow Node fetch handles to close naturally on Windows')
if (!providerE2E.includes('cleanupMatchingWebhooks') || !providerE2E.includes("mode === 'cleanup-webhooks'")) failures.push('stale isolated Stripe webhook cleanup missing')
if (!providerE2E.includes('SHOP62_CLEANUP_FAILED') || !providerE2E.includes('shop62_test_token_hash: null')) failures.push('strict fixture/token cleanup verification missing')
if (!providerE2E.includes('async function verifyWorkerRouteContract') || !providerE2E.includes('readiness without token must be hidden') || !providerE2E.includes('readiness with wrong token must be hidden')) failures.push('isolated Worker route readiness/auth contract checks missing')
if (!providerE2E.includes('contentType=${result.contentType') || !providerE2E.includes('worker=${WORKER_URL}') || !providerE2E.includes('method=${method} path=${pathname}')) failures.push('isolated Worker checkout diagnostics are incomplete')
if (/authorization:\s*`Bearer \$\{SUPABASE_SECRET\}`/i.test(providerE2E)) failures.push('sb_secret_ must not be sent as an Authorization bearer token')
if (!activationCheck.includes('FINAL ACTIVATION READ-ONLY READINESS CHECK') || !activationCheck.includes('SHOP-6.3 FINAL ACTIVATION READINESS: PASS')) failures.push('read-only SHOP-6.3 final activation readiness guard missing')
if (/Method\s+(?:Post|Patch|Put|Delete)\b/i.test(activationCheck) || /purchase_enabled\s*=\s*true/i.test(activationCheck)) failures.push('final activation check must remain read-only')
if (!activationCheck.includes('Invoke-WebRequest -UseBasicParsing') || /Invoke-WebRequest(?!\s+-UseBasicParsing)/i.test(activationCheck)) failures.push('activation HTTP checks must be non-interactive on Windows PowerShell 5.1')
if (!activationCheck.includes('published website relations') || !activationCheck.includes('historical orderItems')) failures.push('activation check must distinguish active fixtures from immutable audit history')
if (!activationCheck.includes('function Resolve-EvidenceObject') || !activationCheck.includes('function Get-ObjectPropertyValue') || !activationCheck.includes("return 'MISSING'")) failures.push('activation evidence checks must be StrictMode-safe and report missing keys')
if (/\$evidence\.\$key/.test(activationCheck) || /\$evidence\.promptPay/.test(activationCheck)) failures.push('activation check uses unsafe dynamic evidence property access')
if (!productionConfig.includes("$confirmation -cne 'APPLY SHOP-6.3'") || !productionConfig.includes("$stripeConfirmation -cne 'PRODUCTION STRIPE'")) failures.push('SHOP-6.3 owner and Stripe production confirmations missing')
if (!productionConfig.includes('purchase_enabled=$false') || /purchase_enabled\s*=\s*\$true/i.test(productionConfig)) failures.push('SHOP-6.3 config must force purchase_enabled=false')
if (!productionConfig.includes('stripe_promptpay_enabled=$false') || !productionConfig.includes("document_mode='RECEIPT_ONLY'") || !productionConfig.includes('pickup_enabled=$true')) failures.push('SHOP-6.3 preservation guards missing')
if (/TURNSTILE_SECRET_KEY\s*=/.test(productionConfig)) failures.push('Turnstile secret must never be assigned in DB/source')
for (const invariant of [
  "reason: 'TURNSTILE_REQUIRED'",
  "reason: Array.isArray(result?.['error-codes'])",
  "url.pathname.startsWith('/__shop62/')",
  'if (!shop62TestModeEnabled(env) || !env.SHOP62_TEST_TOKEN || !shop62TokenAllowed(request, env))',
]) {
  if (!worker.includes(invariant)) failures.push(`Turnstile/bypass rejection invariant missing: ${invariant}`)
}

if (failures.length) {
  console.error('SHOP-6.2 VERIFY: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('SHOP-6.2 VERIFY: PASS')
console.log(`Required files: ${required.length}/${required.length}`)
console.log('Temporary shipping/return settings completeness: PASS')
console.log('Provider activation gate: PASS')
console.log('Rollback-safe DB contract coverage: PASS')
console.log('Isolated AT-TST-* checkout harness: PASS')
console.log('Refund -> returned + warranty void guardrail: PASS')
console.log('Public purchase remains closed by migration: PASS')
