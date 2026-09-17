import { readFile, writeFile } from 'node:fs/promises'

const file = 'workers/r2-upload/src/index.ts'
let source = await readFile(file, 'utf8')

const stockImport = "import { one4SystemStockEnabled, releaseOne4SystemStock, reserveOne4SystemStock, type One4SystemStockEnv } from './one4-system-stock'"
const coordinatorImport = "import { drainOne4StockTasks, ensureOne4SaleConfirmed, loadOne4OrderState } from './one4-stock-coordinator'"
if (!source.includes(coordinatorImport)) {
  if (!source.includes(stockImport)) throw new Error('ONE4C_STORE_IMPORT_ANCHOR_MISSING')
  source = source.replace(stockImport, `${stockImport}\n${coordinatorImport}`)
}

const combinedFailure = `  } else if (type === 'checkout.session.async_payment_failed' || type === 'payment_intent.payment_failed') {\n    normalized = 'PAYMENT_FAILED'\n    providerPaymentId = type.startsWith('payment_intent') ? String(object.id || '') : stripeObjectId(object.payment_intent)\n`
const splitFailure = `  } else if (type === 'checkout.session.async_payment_failed') {\n    normalized = 'PAYMENT_FAILED_TERMINAL'\n    providerPaymentId = stripeObjectId(object.payment_intent)\n  } else if (type === 'payment_intent.payment_failed') {\n    normalized = 'PAYMENT_FAILED'\n    providerPaymentId = String(object.id || '')\n`
if (source.includes(combinedFailure)) source = source.replace(combinedFailure, splitFailure)
if (!source.includes("normalized = 'PAYMENT_FAILED_TERMINAL'")) throw new Error('ONE4C_TERMINAL_FAILURE_PATCH_MISSING')

const webhookStart = source.indexOf('async function processStripeWebhook')
if (webhookStart < 0) throw new Error('ONE4C_WEBHOOK_MISSING')
const webhookReturn = source.indexOf("\n  return new Response('ok', { status: 200 })\n}", webhookStart)
if (webhookReturn < 0) throw new Error('ONE4C_WEBHOOK_RETURN_ANCHOR_MISSING')
const webhookBarrier = `\n\n  if (targetOrderId && normalized === 'PAYMENT_SUCCEEDED') {\n    const one4State = await loadOne4OrderState(env, targetOrderId)\n    if (one4State?.one_stock_authority) {\n      if (!one4SystemStockEnabled(env)) throw new Error('ONE4_SYSTEM_STOCK_DISABLED_AFTER_PAYMENT')\n      await ensureOne4SaleConfirmed(env, targetOrderId)\n    }\n  } else if (targetOrderId && ['CHECKOUT_EXPIRED','PAYMENT_FAILED_TERMINAL'].includes(normalized)) {\n    const one4State = await loadOne4OrderState(env, targetOrderId)\n    if (one4State?.one_stock_authority) {\n      await drainOne4StockTasks(env, { orderId: targetOrderId, maxTasks: 10 })\n        .catch((error) => console.error('ONE4 release coordination deferred', error))\n    }\n  }`
if (!source.includes('ONE4_SYSTEM_STOCK_DISABLED_AFTER_PAYMENT')) {
  source = `${source.slice(0, webhookReturn)}${webhookBarrier}${source.slice(webhookReturn)}`
}

const adminReturn = "    return json(request, env, { result })"
const adminActionStart = source.indexOf("  const orderActionMatch = url.pathname.match(/^\\/commerce\\/orders")
const adminReturnAt = source.indexOf(adminReturn, adminActionStart)
if (adminActionStart < 0 || adminReturnAt < 0) throw new Error('ONE4C_ADMIN_ACTION_ANCHOR_MISSING')
const adminCoordination = `    const one4State = await loadOne4OrderState(env, orderActionMatch[1])\n    if (one4State?.one_stock_authority && action === 'CONFIRM_PAYMENT') {\n      await ensureOne4SaleConfirmed(env, orderActionMatch[1])\n    } else if (one4State?.one_stock_authority && action === 'CANCEL') {\n      await drainOne4StockTasks(env, { orderId: orderActionMatch[1], maxTasks: 10 })\n        .catch((error) => console.error('ONE4 admin release coordination deferred', error))\n    }\n`
if (!source.includes("action === 'CONFIRM_PAYMENT') {\n      await ensureOne4SaleConfirmed")) {
  source = `${source.slice(0, adminReturnAt)}${adminCoordination}${source.slice(adminReturnAt)}`
}

const oldScheduled = `  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {\n    try {\n      const result = await serviceRest<any>(env, 'rpc/expire_commerce_reservations', {\n        method: 'POST',\n        body: JSON.stringify({ max_orders: 200 }),\n      })\n      console.log('SHOP6 reservation expiry sweep', result)\n    } catch (error) {\n      console.error('SHOP6 reservation expiry sweep failed', error)\n    }\n  },`
const newScheduled = `  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {\n    try {\n      const result = await serviceRest<any>(env, 'rpc/expire_commerce_reservations', {\n        method: 'POST',\n        body: JSON.stringify({ max_orders: 200 }),\n      })\n      console.log('SHOP6 reservation expiry sweep', result)\n    } catch (error) {\n      console.error('SHOP6 reservation expiry sweep failed', error)\n    }\n    try {\n      const coordination = await drainOne4StockTasks(env, { maxTasks: 50 })\n      console.log('ONE4 durable stock coordination sweep', coordination)\n    } catch (error) {\n      console.error('ONE4 durable stock coordination sweep failed', error)\n    }\n  },`
if (source.includes(oldScheduled)) source = source.replace(oldScheduled, newScheduled)
if (!source.includes('ONE4 durable stock coordination sweep')) throw new Error('ONE4C_SCHEDULED_PATCH_MISSING')

for (const token of [
  coordinatorImport,
  "normalized = 'PAYMENT_FAILED_TERMINAL'",
  'await ensureOne4SaleConfirmed(env, targetOrderId)',
  "action === 'CONFIRM_PAYMENT'",
  'ONE4 durable stock coordination sweep',
]) {
  if (!source.includes(token)) throw new Error(`ONE4C_STORE_PATCH_POSTCONDITION_MISSING:${token}`)
}

await writeFile(file, source)
console.log('AMPHON ONE-4C Store Worker coordination patch: PASS')
