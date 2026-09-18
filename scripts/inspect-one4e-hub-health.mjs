import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'

const config = JSON.parse(await readFile(new URL('../config/one4e-production-observation.json', import.meta.url), 'utf8'))
const supabaseUrl = process.env.SUPABASE_URL || 'https://mfpdtlxwdbxitgfzdape.supabase.co'
const serviceKey = process.env.SUPABASE_SECRET_KEY

if (!serviceKey) {
  console.error('AMPHON ONE-4E HUB OBSERVER: FAIL')
  console.error('SUPABASE_SECRET_KEY_REQUIRED')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function readinessObject(value) {
  if (Array.isArray(value)) return value[0] || {}
  return value || {}
}

function countBy(rows, key) {
  const result = {}
  for (const row of rows || []) {
    const value = String(row?.[key] ?? 'UNKNOWN')
    result[value] = (result[value] || 0) + 1
  }
  return result
}

const cutoverAt = new Date(config.cutoverAt)
if (!Number.isFinite(cutoverAt.getTime())) throw new Error('ONE4E_CUTOVER_AT_INVALID')

try {
  const [readinessResult, productResult, orderResult, inboxResult] = await Promise.all([
    supabase.rpc('one4d_activation_readiness'),
    supabase
      .from('products')
      .select('sku,status,one_managed,one_availability,one_availability_version,one_availability_last_reason')
      .eq('one_managed', true)
      .order('sku'),
    supabase
      .from('commerce_orders')
      .select('id,order_status,payment_status,fulfillment_status,one_stock_authority,reservation_expires_at,paid_at,created_at')
      .eq('one_stock_authority', true)
      .gte('created_at', cutoverAt.toISOString())
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('integration_event_inbox')
      .select('event_type,entity_sku,status,attempts,received_at,processed_at,last_error')
      .gte('received_at', cutoverAt.toISOString())
      .order('received_at', { ascending: false })
      .limit(100),
  ])

  for (const [name,result] of [
    ['readiness',readinessResult],
    ['products',productResult],
    ['orders',orderResult],
    ['inbox',inboxResult],
  ]) {
    if (result.error) throw new Error(`ONE4E_HUB_${name.toUpperCase()}:${result.error.message}`)
  }

  const readiness = readinessObject(readinessResult.data)
  const products = productResult.data || []
  const orders = orderResult.data || []
  const inbox = inboxResult.data || []

  const critical = []
  const warnings = []

  if (readiness.status !== 'ACCEPTED') critical.push('ACTIVATION_NOT_ACCEPTED')
  if (readiness.purchaseEnabled !== true) critical.push('PURCHASE_DISABLED_UNEXPECTEDLY')
  if (readiness.activationAllowed !== true) critical.push('ACTIVATION_NOT_ALLOWED')
  if (Number(readiness.deadCommands || 0) > 0) critical.push('SHOP_COMMAND_DEAD')
  if (Number(readiness.nonterminalCommands || 0) > 0) warnings.push('SHOP_COMMAND_NONTERMINAL')

  const invalidProducts = products.filter((row) =>
    row.one_availability == null
    || row.one_availability_version == null
  )
  if (invalidProducts.length) critical.push('ONE_PRODUCT_PROJECTION_INCOMPLETE')

  const inboxDead = inbox.filter((row) => row.status === 'DEAD')
  const inboxFailed = inbox.filter((row) => row.status === 'FAILED')
  if (inboxDead.length) critical.push('HUB_INBOX_DEAD')
  if (inboxFailed.length) warnings.push('HUB_INBOX_FAILED')

  const now = Date.now()
  const expiryGraceMs = Number(config.monitoring?.expiredOrderGraceMinutes || 10) * 60_000
  const staleOrders = orders.filter((row) =>
    ['AWAITING_PAYMENT','PAYMENT_REVIEW'].includes(row.order_status)
    && row.reservation_expires_at
    && now > new Date(row.reservation_expires_at).getTime() + expiryGraceMs
  )
  if (staleOrders.length) warnings.push('EXPIRED_ONE_ORDER_NOT_TERMINAL')

  const runtimeHealth = critical.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS'

  console.log('AMPHON ONE-4E HUB OBSERVATION')
  console.log(JSON.stringify({
    contractVersion: config.contractVersion,
    generatedAt: new Date().toISOString(),
    cutoverAt: cutoverAt.toISOString(),
    runtimeHealth,
    critical,
    warnings,
    readiness: {
      status: readiness.status,
      purchaseEnabled: readiness.purchaseEnabled,
      activationAllowed: readiness.activationAllowed,
      nonterminalCommands: Number(readiness.nonterminalCommands || 0),
      deadCommands: Number(readiness.deadCommands || 0),
      oneOrders: Number(readiness.oneOrders || 0),
      workerRevision: readiness.workerRevision || null,
    },
    oneManagedProducts: products.length,
    projectionAvailabilityCounts: countBy(products, 'one_availability'),
    orderStatusCounts: countBy(orders, 'order_status'),
    paymentStatusCounts: countBy(orders, 'payment_status'),
    inboxStatusCounts: countBy(inbox, 'status'),
    staleExpiredOrders: staleOrders.map((row) => ({
      id: row.id,
      orderStatus: row.order_status,
      paymentStatus: row.payment_status,
      reservationExpiresAt: row.reservation_expires_at,
      createdAt: row.created_at,
    })),
  }, null, 2))

  if (runtimeHealth === 'FAIL') process.exitCode = 1
} catch (error) {
  console.error('AMPHON ONE-4E HUB OBSERVER: FAIL')
  console.error(error?.message || error)
  process.exitCode = 1
}
