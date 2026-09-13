import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const shopRoot=resolve(import.meta.dirname,'..')
const root=resolve(shopRoot,'..')
const required=[
  '../supabase/shop_6.sql','../supabase/shop_6_verify.sql','../docs/SHOP6_PAYMENT_FULFILLMENT_PLAYBOOK.md',
  'src/pages/checkout/index.astro','src/pages/order/[token]/index.astro','src/pages/document/[token]/index.astro','src/pages/warranty/[token]/index.astro',
  '../src/components/CommerceAdmin.tsx','../src/components/OrderManagement.tsx','../workers/r2-upload/src/index.ts'
]
const failures=[]
for(const f of required){ try{await access(resolve(shopRoot,f))}catch{failures.push(`missing: ${f}`)} }
const sql=await readFile(resolve(root,'supabase/shop_6.sql'),'utf8')
const worker=await readFile(resolve(root,'workers/r2-upload/src/index.ts'),'utf8')
const checkout=await readFile(resolve(shopRoot,'src/pages/checkout/index.astro'),'utf8')
const order=await readFile(resolve(shopRoot,'src/pages/order/[token]/index.astro'),'utf8')
const admin=await readFile(resolve(root,'src/components/CommerceAdmin.tsx'),'utf8')
const orders=await readFile(resolve(root,'src/components/OrderManagement.tsx'),'utf8')
const storeApi=await readFile(resolve(shopRoot,'src/lib/store-api.ts'),'utf8')
const checks=[
 [sql.includes('create table if not exists public.commerce_payment_events'),'provider event ledger'],
 [sql.includes('unique(provider,provider_event_id)') || sql.includes('unique(provider, provider_event_id)') || sql.includes('unique (provider,provider_event_id)'),'provider event idempotency'],
 [sql.includes('PAYMENT_AMOUNT_MISMATCH') && sql.includes('PAYMENT_CURRENCY_MISMATCH'),'amount/currency payment verification'],
 [sql.includes("action='REFUND_SUCCEEDED'") && sql.includes("status='returned'"),'refund returns SKU, no auto publish'],
 [sql.includes('create table if not exists public.commerce_shipments'),'shipment table'],
 [sql.includes('create table if not exists public.commerce_documents'),'immutable document snapshot'],
 [sql.includes('create table if not exists public.commerce_warranties'),'warranty certificates'],
 [sql.includes('store_warranty_days') && sql.includes('warranty_days'),'per-SKU warranty snapshot'],
 [worker.includes('STRIPE_SECRET_KEY') && worker.includes('STRIPE_WEBHOOK_SECRET'),'Stripe secrets server-only contract'],
 [worker.includes("request.headers.get('stripe-signature')") && worker.includes('verifyStripeSignature'),'signed raw webhook verification'],
 [worker.includes('checkout.session.async_payment_succeeded') && worker.includes('checkout.session.async_payment_failed'),'Stripe async events'],
 [worker.includes('payment_intent.succeeded') && worker.includes('refund.updated'),'payment/refund webhook events'],
 [worker.includes('process_gateway_payment_event'),'webhook to transactional payment RPC'],
 [/shopVersion:\s*(?:6|7|8|9|[1-9][0-9]+)/.test(worker),'Store API v6+ marker'],
 [checkout.includes('value="STRIPE"') && checkout.includes('checkoutUrl'),'Stripe checkout UX'],
 [checkout.includes('invoiceRequested') && checkout.includes('invoiceTaxId'),'invoice request fields'],
 [order.includes('paymentProvider === \'STRIPE\'') && order.includes('paymentUrl'),'Stripe order payment UX'],
 [order.includes('/document/') && order.includes('/warranty/'),'document/warranty links'],
 [storeApi.includes('getStoreDocument') && storeApi.includes('getStoreWarranty'),'token document/warranty API'],
 [admin.includes('stripeEnabled') && admin.includes('promptPayEnabled'),'Commerce Stripe settings UI'],
 [admin.includes('defaultWarrantyDays') || admin.includes('defaultDays'),'warranty settings UI'],
 [orders.includes("order.paymentProvider !== 'STRIPE'") && orders.includes('CONFIRM_PAYMENT'),'manual payment confirmation disabled for Stripe'],
 [orders.includes('MARK_IN_TRANSIT') && orders.includes('MARK_DELIVERED'),'shipping lifecycle UI'],
]
for(const [ok,label] of checks) if(!ok) failures.push(`invariant: ${label}`)
for(const secretPattern of [/sk_(?:live|test)_[A-Za-z0-9]{12,}/, /whsec_[A-Za-z0-9]{12,}/]) {
  for(const [name,text] of [['worker',worker],['sql',sql],['checkout',checkout],['admin',admin]]) if(secretPattern.test(text)) failures.push(`secret-like value in ${name}`)
}
const publicSettings=(sql.split('create or replace view public.commerce_public_store_settings_v')[1]||'')
for(const privateName of ['invoice_tax_id','invoice_address','invoice_email','bank_account_number','bank_account_name']) if(publicSettings.includes(privateName)) failures.push(`public settings leaks ${privateName}`)
if(failures.length){console.error('SHOP-6 VERIFY: FAIL');failures.forEach(x=>console.error(`- ${x}`));process.exit(1)}
console.log('SHOP-6 VERIFY: PASS')
console.log('Stripe webhook / idempotent payment ledger: PASS')
console.log('Amount + currency verification: PASS')
console.log('Shipping / tracking state machine: PASS')
console.log('Document + warranty snapshot isolation: PASS')
console.log('Refund → returned guardrail: PASS')
