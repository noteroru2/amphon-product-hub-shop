import { readFile } from 'node:fs/promises'

const files = {
  one4d: 'config/one4d-production-acceptance.json',
  config: 'config/one4e-production-observation.json',
  observer: 'scripts/inspect-one4e-hub-health.mjs',
  wrangler: 'workers/r2-upload/wrangler.jsonc',
  docs: 'docs/ONE_4E_SHOP_MONITORING.md',
}

const source = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([key,path]) => [key, await readFile(path,'utf8')]),
))
const one4d = JSON.parse(source.one4d)
const config = JSON.parse(source.config)
const wrangler = JSON.parse(source.wrangler)
const failures = []
const assert = (condition,message) => { if (!condition) failures.push(message) }
const need = (key,token,label) => { if (!source[key].includes(token)) failures.push(`${label}: missing ${token}`) }
const forbid = (key,token,label) => { if (source[key].includes(token)) failures.push(`${label}: forbidden ${token}`) }

assert(one4d.productionAccepted === true && one4d.cutoverComplete === true && one4d.activationAllowed === true,
  'ONE-4E Hub monitoring requires completed ONE-4D production cutover')
assert(Array.isArray(one4d.blockers) && one4d.blockers.length === 0,
  'ONE-4E Hub monitoring requires zero ONE-4D blockers')
assert(config.contractVersion === 'ONE-4E-PROD.1','unexpected ONE-4E Hub contract version')
assert(config.authority?.systemCanonicalStock === true,'System must remain canonical stock authority')
assert(config.authority?.hubProjectionOnly === true,'Hub must remain projection-only')
assert(config.observation?.targetRealOrders >= 10,'Hub ONE-4E must retain the 10 real-order observation gate')

assert(wrangler.vars?.ONE4_SYSTEM_STOCK_ENABLED === 'true','Store Worker System stock flag must remain enabled')
assert(Array.isArray(wrangler.triggers?.crons) && wrangler.triggers.crons.includes('*/5 * * * *'),
  'Store Worker 5-minute scheduled drain must remain configured')
assert(wrangler.secrets?.required?.includes('SHOP_INTEGRATION_SECRET'),
  'Shop HMAC secret must remain a required remote secret')

for (const token of [
  "one4d_activation_readiness",
  "one_stock_authority",
  "integration_event_inbox",
  "SHOP_COMMAND_DEAD",
  "ONE_PRODUCT_PROJECTION_INCOMPLETE",
  "HUB_INBOX_DEAD",
  "EXPIRED_ONE_ORDER_NOT_TERMINAL",
]) need('observer',token,'ONE-4E Hub observer')

forbid('observer','customer_name','Hub observer must not select customer PII')
forbid('observer','customer_phone','Hub observer must not select customer PII')
forbid('observer','customer_email','Hub observer must not select customer PII')
forbid('observer','address_line','Hub observer must not select customer PII')

for (const token of [
  'ONE-4E Shop Monitoring',
  'System remains canonical',
  '10 real Shop orders',
  'purchase_enabled=false',
  'ONE4_SYSTEM_STOCK_ENABLED',
]) need('docs',token,'ONE-4E Hub monitoring runbook')

if (failures.length) {
  console.error('AMPHON ONE-4E SHOP: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('AMPHON ONE-4E SHOP: PASS — Shop monitoring preserves System authority, Worker drain, PII boundaries and the real-order maturity gate')
