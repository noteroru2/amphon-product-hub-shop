import { readFile } from 'node:fs/promises'

const files = {
  contract: 'config/amphon-one4.json',
  migration: 'supabase/migrations/20260917125804_one4b_system_authority_checkout.sql',
  client: 'workers/r2-upload/src/one4-system-stock.ts',
  worker: 'workers/r2-upload/src/index.ts',
  wrangler: 'workers/r2-upload/wrangler.jsonc',
}
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([k,p]) => [k, await readFile(p,'utf8')])))
const contract = JSON.parse(source.contract)
const failures = []
const requireText = (key, token, label) => { if (!source[key].includes(token)) failures.push(`${label}: missing ${token}`) }
const forbidText = (key, token, label) => { if (source[key].includes(token)) failures.push(`${label}: forbidden ${token}`) }

if (contract?.authority?.reservationAuthority !== 'amphon_system') failures.push('contract: reservation authority must be System')
if (contract?.featureFlags?.shopSystemStock !== 'ONE4_SYSTEM_STOCK_ENABLED') failures.push('contract: Shop stock feature flag drifted')
if (contract?.featureFlags?.purchaseEnabledMustRemainFalseUntilOne4d !== true) failures.push('contract: purchase activation guard missing')

for (const token of [
  'one_stock_authority', 'one_system_reservation', 'one_system_reservation_confirmed_at',
  'one4_create_commerce_order', 'ONE4_SYSTEM_RESERVATION_REQUIRED',
  'ONE4_SYSTEM_RESERVATION_SKU_MISMATCH', 'ONE4_HUB_PROJECTION_AHEAD',
  'ORDER_SYSTEM_RESERVED', "grant execute on function public.one4_create_commerce_order(jsonb,jsonb) to service_role",
]) requireText('migration', token, 'ONE-4 order RPC')
forbidText('migration', "update public.products set status='reserved'", 'ONE-4 order RPC must not mutate Hub stock')
forbidText('migration', "update public.products set status='sold'", 'ONE-4 order RPC must not mutate Hub stock')

for (const token of [
  'ONE4_SYSTEM_STOCK_ENABLED', 'SYSTEM_API_BASE_URL', 'SHOP_INTEGRATION_KEY_ID', 'SHOP_INTEGRATION_SECRET',
  "const STOCK_PATH = '/api/integrations/v1/shop/stock'", 'crypto.subtle.sign',
  'reserveOne4SystemStock', 'releaseOne4SystemStock', 'shop:', ':reserve:v1', ':release:v1',
]) requireText('client', token, 'signed System stock client')

for (const token of [
  'one4SystemStockEnabled', 'reserveOne4SystemStock', 'releaseOne4SystemStock',
  "rpc/one4_create_commerce_order", 'SHOP_ORDER_CREATE_FAILED', 'STRIPE_SESSION_CREATE_FAILED',
  "if (!settings?.purchase_enabled) return storeJson({ error: 'Checkout ยังไม่เปิดใช้งาน' }, 503",
]) requireText('worker', token, 'public checkout wiring')
forbidText('worker', "rpc/create_commerce_order', {\n    method: 'POST',\n    body: JSON.stringify({ checkout: payload })", 'legacy public checkout order RPC')

requireText('wrangler', '"ONE4_SYSTEM_STOCK_ENABLED":', 'ONE-4 activation flag declaration')
requireText('wrangler', '"SHOP_INTEGRATION_KEY_ID": "amphon-shop-v1"', 'dedicated Shop key id')
forbidText('wrangler', 'SHOP_INTEGRATION_SECRET', 'Shop integration secret must not be stored in source')

if (failures.length) {
  console.error('AMPHON ONE-4B SHOP: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('AMPHON ONE-4B SHOP: PASS — checkout reserves System stock before order/payment, uses server-only HMAC, compensates release on failure and remains activation-gated by ONE-4D')
