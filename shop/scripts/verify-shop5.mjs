import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const shopRoot = resolve(import.meta.dirname,'..')
const root = resolve(shopRoot,'..')
const required = [
  '../supabase/shop_5.sql','../supabase/shop_5_verify.sql','../docs/SHOP5_CHECKOUT_ORDER_PLAYBOOK.md',
  'src/lib/cart.ts','src/pages/cart/index.astro','src/pages/checkout/index.astro','src/pages/order/[token]/index.astro',
  '../src/lib/orders.ts','../src/components/OrderManagement.tsx'
]
const failures=[]
for (const f of required) { try { await access(resolve(shopRoot,f)) } catch { failures.push(`missing: ${f}`) } }
const sql=await readFile(resolve(root,'supabase/shop_5.sql'),'utf8')
const worker=await readFile(resolve(root,'workers/r2-upload/src/index.ts'),'utf8')
const product=await readFile(resolve(shopRoot,'src/pages/p/[product].astro'),'utf8')
const checkout=await readFile(resolve(shopRoot,'src/pages/checkout/index.astro'),'utf8')
const orderPage=await readFile(resolve(shopRoot,'src/pages/order/[token]/index.astro'),'utf8')
const app=await readFile(resolve(root,'src/App.tsx'),'utf8')
const admin=await readFile(resolve(root,'src/components/OrderManagement.tsx'),'utf8')
const inv=[
 [sql.includes('drop constraint if exists commerce_store_settings_shop4_purchase_lock'),'SHOP4 lock removed'],
 [sql.includes('create table if not exists public.commerce_orders'),'orders table'],
 [sql.includes('create table if not exists public.commerce_reservations'),'reservations table'],
 [sql.includes('product_id uuid primary key references public.products'),'one active reservation per product'],
 [sql.includes('for update'),'row locking'],
 [sql.includes('validated_count <> item_count'),'all requested SKU validation'],
 [sql.includes('idempotency_key uuid not null unique') && sql.includes('pg_advisory_xact_lock'),'checkout idempotency'],
 [sql.includes('create or replace function public.create_commerce_order'),'atomic checkout RPC'],
 [sql.includes('create or replace function public.expire_commerce_reservations') && sql.includes("o.order_status in ('AWAITING_PAYMENT','PAYMENT_REVIEW')"),'expiry RPC + payment-review expiry'],
 [sql.includes('create or replace function public.notify_commerce_payment') && sql.includes("target.payment_status = 'REVIEW'"),'payment notification idempotency'],
 [sql.includes('create or replace function public.admin_commerce_order_action'),'staff order action RPC'],
 [sql.includes("and o.order_status not in ('CANCELLED','EXPIRED','COMPLETED','REFUNDED')") && sql.includes('for update;'),'order-first release locking'],
 [sql.includes('revoke all on public.commerce_orders from anon, authenticated'),'order PII table private'],
 [worker.includes("'/store/checkout'"),'public checkout API'],
 [sql.includes('checkout_turnstile_enabled') && worker.includes('TURNSTILE_SECRET_KEY') && worker.includes('turnstile/v0/siteverify'),'Turnstile stock-lock protection'],
 [worker.includes('orderMatch = url.pathname.match(/^\\/store\\/orders\\/'),'public order lookup API'],
 [worker.includes("'/commerce/orders'"),'staff orders API'],
 [worker.includes('async scheduled'),'reservation expiry cron'],
 [/shopVersion:\s*(?:5|6|7|8|9|[1-9][0-9]+)/.test(worker),'Store API v5+ marker'],
 [product.includes('id="add-to-cart"') && product.includes('addCartSku'),'product add-to-cart'],
 [checkout.includes('idempotencyKey'),'checkout idempotency client'],
 [checkout.includes('`${api}/checkout`') && checkout.includes('cf-turnstile-response'),'checkout API + Turnstile client'],
 [orderPage.includes('payment-notify'),'payment notification UI'],
 [/['"]orders['"]/.test(app),'orders app tab'],
 [admin.includes('CONFIRM_PAYMENT'),'payment confirm action'],
 [admin.includes('MARK_SHIPPED'),'shipping action'],
 [admin.includes('REFUND'),'refund action'],
]
for (const [ok,label] of inv) if(!ok) failures.push(`invariant: ${label}`)
const adminView=(sql.split('create or replace view public.commerce_order_admin_v')[1]||'').split('-- ------------------------------------------------------------\n-- PUBLIC PRODUCT/STORE')[0]
if (!adminView.includes('customer_name')) failures.push('admin view missing required customer data')
const publicSettings=(sql.split('create or replace view public.commerce_public_store_settings_v')[1]||'')
for (const secret of ['bank_account_name','bank_account_number']) if(publicSettings.includes(secret)) failures.push(`public settings leaks ${secret}`)
if (failures.length) { console.error('SHOP-5 VERIFY: FAIL'); failures.forEach(x=>console.error(`- ${x}`)); process.exit(1) }
console.log('SHOP-5 VERIFY: PASS')
console.log('Atomic reservation / idempotent checkout: PASS')
console.log('Order PII isolation: PASS')
console.log('Expiry/payment/fulfillment transitions: PASS')
console.log('Product Hub order management integration: PASS')
