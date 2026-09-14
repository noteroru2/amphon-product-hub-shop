import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const shopRoot = resolve(import.meta.dirname, '..')
const projectRoot = resolve(shopRoot, '..')

const [worker, checkout, storeApi, migration] = await Promise.all([
  readFile(resolve(projectRoot, 'workers/r2-upload/src/index.ts'), 'utf8'),
  readFile(resolve(shopRoot, 'src/pages/checkout/index.astro'), 'utf8'),
  readFile(resolve(shopRoot, 'src/lib/store-api.ts'), 'utf8'),
  readFile(resolve(projectRoot, 'supabase/migrations/20260914133000_shop9_promptpay_activation.sql'), 'utf8'),
])

const checks = [
  ['worker reads PromptPay feature flag', worker.includes('stripe_promptpay_enabled')],
  ['worker maps PromptPay into public checkout settings', worker.includes('promptPayEnabled: Boolean(row.stripe_promptpay_enabled)')],
  ['worker supports PromptPay as an explicit Stripe payment method', worker.includes("form.set('payment_method_types[0]', 'promptpay')")],
  ['worker guards PromptPay to THB', worker.includes('STRIPE_PROMPTPAY_REQUIRES_THB')],
  ['normal Stripe checkout adds PromptPay only when production flag is enabled', worker.includes('settings.stripe_promptpay_enabled') && worker.includes("form.set('payment_method_types[1]', 'promptpay')")],
  ['Stripe webhook handles asynchronous PromptPay success', worker.includes('checkout.session.async_payment_succeeded')],
  ['Stripe webhook handles PaymentIntent success', worker.includes('payment_intent.succeeded')],
  ['Stripe webhook verifies signatures', worker.includes('verifyStripeSignature') && worker.includes('STRIPE_WEBHOOK_SECRET')],
  ['checkout visibly advertises PromptPay only when enabled', checkout.includes("settings?.checkout?.promptPayEnabled ? '(บัตร / PromptPay)' : '(บัตร)'")],
  ['store API client exposes PromptPay setting', storeApi.includes('promptPayEnabled')],
  ['activation migration enables PromptPay', migration.includes('stripe_promptpay_enabled = true')],
  ['activation migration requires purchase enabled', migration.includes('SHOP9_PURCHASE_MUST_BE_ENABLED')],
  ['activation migration requires member checkout enabled', migration.includes('SHOP9_MEMBER_CHECKOUT_MUST_BE_ENABLED')],
  ['activation migration requires Stripe enabled', migration.includes('SHOP9_STRIPE_MUST_BE_ENABLED')],
  ['activation migration requires THB', migration.includes('SHOP9_PROMPTPAY_REQUIRES_THB')],
  ['activation migration requires Thailand store', migration.includes('SHOP9_PROMPTPAY_REQUIRES_TH_STORE')],
]

const failures = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failures.length) {
  console.error(`SHOP-9 verification failed: ${failures.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('SHOP-9 verification PASS — PromptPay QR checkout, webhook confirmation, and activation safeguards are intact')
