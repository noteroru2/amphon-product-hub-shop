import { readFile, writeFile } from 'node:fs/promises'

const path = 'workers/r2-upload/src/index.ts'
let source = await readFile(path, 'utf8')

const importLine = "import { one4SystemStockEnabled, releaseOne4SystemStock, reserveOne4SystemStock, type One4SystemStockEnv } from './one4-system-stock'\n\n"
if (!source.includes(importLine.trim())) source = importLine + source

const envNeedle = 'interface Env {'
const envReplacement = 'interface Env extends One4SystemStockEnv {'
if (source.includes(envNeedle)) source = source.replace(envNeedle, envReplacement)
if (!source.includes(envReplacement)) throw new Error('ONE4_PATCH_ENV_INTERFACE_NOT_FOUND')

const legacyOrderCall = `  const result = await serviceRest<any>(env, 'rpc/create_commerce_order', {
    method: 'POST',
    body: JSON.stringify({ checkout: payload }),
  })

  if (payload.paymentMethod === 'STRIPE') {`

const one4OrderCall = `  if (!one4SystemStockEnabled(env)) {
    return storeJson({ error: 'ระบบสำรองสินค้ากลางยังไม่เปิดใช้งาน', code: 'ONE4_SYSTEM_STOCK_DISABLED' }, 503, 'no-store')
  }

  const reservationMinutes = Math.min(240, Math.max(1, Number(settings.reservation_minutes || 60)))
  const reservationExpiresAt = new Date(Date.now() + reservationMinutes * 60_000).toISOString()
  let systemReservation
  try {
    systemReservation = await reserveOne4SystemStock(env, {
      checkoutIdempotencyKey: String(payload.idempotencyKey),
      skus,
      expiresAt: reservationExpiresAt,
    })
  } catch (error) {
    console.error('ONE4_SYSTEM_RESERVE_ERROR:', error instanceof Error ? error.message : error)
    return storeJson({ error: 'ระบบสำรองสินค้าไม่พร้อม กรุณาลองใหม่', code: 'ONE4_SYSTEM_STOCK_UNAVAILABLE' }, 503, 'no-store')
  }
  if (!systemReservation.ok || systemReservation.outcome !== 'RESERVED') {
    const unavailable = systemReservation.errorCode === 'ONE4_STOCK_UNAVAILABLE'
      || systemReservation.outcome === 'REJECTED'
      || systemReservation.outcome === 'CONFLICT'
    return storeJson({
      error: unavailable ? 'สินค้าบางรายการถูกจองหรือขายแล้ว กรุณารีเฟรชตะกร้า' : 'ระบบสำรองสินค้าไม่พร้อม กรุณาลองใหม่',
      code: systemReservation.errorCode || 'ONE4_RESERVATION_REJECTED',
    }, unavailable ? 409 : 503, 'no-store')
  }

  let result: any
  try {
    result = await serviceRest<any>(env, 'rpc/one4_create_commerce_order', {
      method: 'POST',
      body: JSON.stringify({ checkout: payload, system_reservation: systemReservation }),
    })
  } catch (error) {
    await releaseOne4SystemStock(env, {
      checkoutIdempotencyKey: String(payload.idempotencyKey),
      skus,
      reason: 'SHOP_ORDER_CREATE_FAILED',
    }).catch((releaseError) => console.error('ONE4_SYSTEM_RELEASE_AFTER_ORDER_ERROR:', releaseError))
    throw error
  }

  if (payload.paymentMethod === 'STRIPE') {`

if (source.includes(legacyOrderCall)) source = source.replace(legacyOrderCall, one4OrderCall)
if (!source.includes("rpc/one4_create_commerce_order")) throw new Error('ONE4_PATCH_CHECKOUT_ORDER_CALL_NOT_APPLIED')
if (source.includes("rpc/create_commerce_order', {\n    method: 'POST',\n    body: JSON.stringify({ checkout: payload })")) {
  throw new Error('ONE4_PATCH_LEGACY_PUBLIC_CHECKOUT_CALL_REMAINS')
}

const stripeCatchNeedle = `      if (orderId) {
        await serviceRest(env, 'rpc/cancel_commerce_gateway_order', {
          method: 'POST',
          body: JSON.stringify({
            target_order_id: orderId,
            reason: error instanceof Error ? error.message.slice(0, 280) : 'Stripe Checkout create failed',
          }),
        }).catch(() => undefined)
      }
      throw error`

const stripeCatchReplacement = `      if (orderId) {
        await serviceRest(env, 'rpc/cancel_commerce_gateway_order', {
          method: 'POST',
          body: JSON.stringify({
            target_order_id: orderId,
            reason: error instanceof Error ? error.message.slice(0, 280) : 'Stripe Checkout create failed',
          }),
        }).catch(() => undefined)
      }
      await releaseOne4SystemStock(env, {
        checkoutIdempotencyKey: String(payload.idempotencyKey),
        skus,
        reason: 'STRIPE_SESSION_CREATE_FAILED',
      }).catch((releaseError) => console.error('ONE4_SYSTEM_RELEASE_AFTER_STRIPE_ERROR:', releaseError))
      throw error`

if (source.includes(stripeCatchNeedle)) source = source.replace(stripeCatchNeedle, stripeCatchReplacement)
if (!source.includes('STRIPE_SESSION_CREATE_FAILED')) throw new Error('ONE4_PATCH_STRIPE_RELEASE_NOT_APPLIED')

await writeFile(path, source)
console.log('AMPHON ONE-4B R2 PATCH: PASS — public checkout now reserves System stock before order/payment and compensates with release on failures')
