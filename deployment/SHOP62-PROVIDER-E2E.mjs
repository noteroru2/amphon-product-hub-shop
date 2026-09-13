import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const mode = process.argv[2] || 'run'
const env = process.env

function required(name) {
  const value = String(env[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const stripeSecret = () => required('SHOP62_STRIPE_TEST_SECRET')

async function stripe(path, { method = 'GET', form } = {}) {
  const init = { method, headers: { authorization: `Bearer ${stripeSecret()}` } }
  if (form) {
    init.headers['content-type'] = 'application/x-www-form-urlencoded'
    init.body = form.toString()
  }
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\/+/, '')}`, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Stripe ${method} ${path}: ${response.status} ${body?.error?.message || JSON.stringify(body)}`)
  return body
}

async function createWebhook() {
  const workerUrl = process.argv[3]
  if (!workerUrl) throw new Error('worker URL required')
  const form = new URLSearchParams()
  form.set('url', `${workerUrl.replace(/\/$/, '')}/webhooks/stripe`)
  const events = [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'refund.updated',
    'charge.refunded',
  ]
  events.forEach((event, index) => form.set(`enabled_events[${index}]`, event))
  form.set('description', 'AMPHON SHOP-6.2 isolated E2E webhook')
  const endpoint = await stripe('webhook_endpoints', { method: 'POST', form })
  console.log(JSON.stringify({ id: endpoint.id, secret: endpoint.secret }))
}

async function deleteWebhook() {
  const id = process.argv[3]
  if (!id) return
  await stripe(`webhook_endpoints/${encodeURIComponent(id)}`, { method: 'DELETE' })
  console.log(JSON.stringify({ deleted: id }))
}

async function cleanupMatchingWebhooks() {
  const workerUrl = process.argv[3]
  if (!workerUrl) throw new Error('worker URL required')
  const expectedUrl = `${workerUrl.replace(/\/$/, '')}/webhooks/stripe`
  const endpoints = await stripe('webhook_endpoints?limit=100')
  const matches = Array.isArray(endpoints?.data)
    ? endpoints.data.filter((endpoint) =>
        endpoint?.description === 'AMPHON SHOP-6.2 isolated E2E webhook' &&
        endpoint?.url === expectedUrl)
    : []
  for (const endpoint of matches) {
    await stripe(`webhook_endpoints/${encodeURIComponent(endpoint.id)}`, { method: 'DELETE' })
  }
  console.log(JSON.stringify({ deleted: matches.length }))
}

let SUPABASE_URL
let SUPABASE_SECRET
let WORKER_URL
let TEST_TOKEN
let WEBHOOK_SECRET

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: SUPABASE_SECRET,
    accept: 'application/json',
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (prefer) headers.prefer = prefer
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const raw = await response.text()
  const parsed = raw ? (() => { try { return JSON.parse(raw) } catch { return raw } })() : null
  if (!response.ok) throw new Error(`Supabase ${method} ${path}: ${response.status} ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`)
  return parsed
}

async function rpc(name, body) {
  return rest(`rpc/${name}`, { method: 'POST', body })
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function poll(label, fn, predicate, timeoutMs = 180000, intervalMs = 2500) {
  const end = Date.now() + timeoutMs
  let last
  while (Date.now() < end) {
    last = await fn()
    if (predicate(last)) return last
    await delay(intervalMs)
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(last)}`)
}

async function getSettings() {
  const rows = await rest('commerce_store_settings?id=eq.1&select=*')
  return rows?.[0]
}

async function seedProduct(label, price = 19) {
  const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase()
  const sku = `AT-TST-${label}-${suffix}`.slice(0, 80)
  const productRows = await rest('products?select=id,sku', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      sku,
      category: 'notebook',
      subtype: 'other',
      brand: 'SHOP62',
      model: label,
      title: `SHOP-6.2 E2E ${label}`,
      status: 'published',
      condition_percent: 99,
      price,
      specs: { shop62Test: true },
    },
  })
  const product = productRows?.[0]
  if (!product?.id) throw new Error(`Failed to seed ${label}`)
  await rest('product_publications', {
    method: 'POST',
    body: { product_id: product.id, channel: 'website', status: 'published', published_at: new Date().toISOString() },
  })
  // Website publication synchronously creates the canonical one-to-one listing.
  // Patch that row for the isolated E2E fixture; a second POST would violate
  // commerce_listings_product_id_key.
  const listingRows = await rest(`commerce_listings?product_id=eq.${encodeURIComponent(product.id)}&select=product_id,slug`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: {
      slug: `shop62-${label.toLowerCase()}-${suffix.toLowerCase()}`.replace(/[^a-z0-9-]/g, '-'),
      index_policy: 'NOINDEX',
      merchant_enabled: false,
      merchant_item_condition: 'USED',
      store_warranty_days: 30,
      store_warranty_terms: 'SHOP-6.2 E2E TEST ONLY',
    },
  })
  if (!Array.isArray(listingRows) || listingRows.length !== 1) {
    throw new Error(`Website publication did not create exactly one commerce listing for ${sku}`)
  }
  return { ...product, sku }
}

async function createDirectOrder(product, deliveryMethod = 'SHIPPING') {
  return rpc('create_commerce_test_order', {
    test_token: TEST_TOKEN,
    checkout: {
      idempotencyKey: randomUUID(),
      skus: [product.sku],
      customerName: 'SHOP-6.2 E2E',
      customerPhone: '0800000000',
      customerEmail: 'shop62-e2e@example.invalid',
      deliveryMethod,
      paymentMethod: 'STRIPE',
      addressLine: deliveryMethod === 'SHIPPING' ? 'SHOP-6.2 TEST ONLY' : '',
      district: deliveryMethod === 'SHIPPING' ? 'TEST' : '',
      province: deliveryMethod === 'SHIPPING' ? 'Ubon Ratchathani' : '',
      postalCode: deliveryMethod === 'SHIPPING' ? '34000' : '',
    },
  })
}

function sanitizedWorkerBody(raw) {
  const text = String(raw || '').replaceAll(TEST_TOKEN, '[redacted]')
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text
}

async function workerFetch(pathname, { method = 'GET', token = TEST_TOKEN, body } = {}) {
  const headers = {}
  if (token) headers['x-shop62-token'] = token
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${WORKER_URL}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const contentType = response.headers.get('content-type') || ''
  const raw = await response.text().catch(() => '')
  let data = raw
  if (contentType.includes('application/json') && raw) {
    try { data = JSON.parse(raw) } catch { data = raw }
  }
  return { response, contentType, raw, data }
}

function workerFailure(label, pathname, method, result) {
  const body = typeof result.data === 'string' ? sanitizedWorkerBody(result.data) : JSON.stringify(result.data)
  return new Error(
    `${label}: method=${method} path=${pathname} status=${result.response.status} ` +
    `contentType=${result.contentType || '(none)'} worker=${WORKER_URL} body=${body || '(empty)'}`,
  )
}

function uuidInFilter(values) {
  return `in.(${values.map((value) => encodeURIComponent(value)).join(',')})`
}

async function shop62SideEffectSnapshot() {
  const [products, orderItems, settings] = await Promise.all([
    rest('products?sku=like.AT-TST-%25&select=id'),
    rest('commerce_order_items?sku=like.AT-TST-%25&select=id,order_id,product_id'),
    getSettings(),
  ])
  const productIds = [...new Set((products || []).map((row) => row.id).filter(Boolean))]
  const orderIds = [...new Set((orderItems || []).map((row) => row.order_id).filter(Boolean))]
  const [publications, listings, orders, reservations, events, transactions, documents, warranties] = await Promise.all([
    productIds.length ? rest(`product_publications?product_id=${uuidInFilter(productIds)}&select=id`) : [],
    productIds.length ? rest(`commerce_listings?product_id=${uuidInFilter(productIds)}&select=id`) : [],
    orderIds.length ? rest(`commerce_orders?id=${uuidInFilter(orderIds)}&select=id`) : [],
    orderIds.length ? rest(`commerce_reservations?order_id=${uuidInFilter(orderIds)}&select=id`) : [],
    orderIds.length ? rest(`commerce_payment_events?order_id=${uuidInFilter(orderIds)}&select=id`) : [],
    orderIds.length ? rest(`commerce_payment_transactions?order_id=${uuidInFilter(orderIds)}&select=id`) : [],
    orderIds.length ? rest(`commerce_documents?order_id=${uuidInFilter(orderIds)}&select=id`) : [],
    orderIds.length ? rest(`commerce_warranties?order_id=${uuidInFilter(orderIds)}&select=id`) : [],
  ])
  return {
    products: products?.length || 0,
    publications: publications?.length || 0,
    listings: listings?.length || 0,
    orders: orders?.length || 0,
    orderItems: orderItems?.length || 0,
    reservations: reservations?.length || 0,
    paymentEvents: events?.length || 0,
    paymentTransactions: transactions?.length || 0,
    documents: documents?.length || 0,
    warranties: warranties?.length || 0,
    settingsUpdatedAt: settings?.updated_at || null,
    acceptanceVersion: settings?.shop62_acceptance_version || null,
    acceptedAt: settings?.shop62_accepted_at || null,
    acceptanceEvidence: settings?.shop62_acceptance_evidence || null,
    testTokenActive: Boolean(settings?.shop62_test_token_hash),
    testTokenExpiresAt: settings?.shop62_test_token_expires_at || null,
    lastInvalidatedAt: settings?.shop62_last_invalidated_at || null,
    lastInvalidatedReason: settings?.shop62_last_invalidated_reason || null,
    purchaseEnabled: Boolean(settings?.purchase_enabled),
  }
}

async function verifyWorkerRouteContract() {
  const health = await workerFetch('/health', { token: null })
  if (!health.response.ok || health.data?.ok !== true) {
    throw workerFailure('SHOP62 isolated Worker health failed', '/health', 'GET', health)
  }

  const readinessPath = '/__shop62/readiness'
  const withoutToken = await workerFetch(readinessPath, { token: null })
  if (withoutToken.response.status !== 404) {
    throw workerFailure('SHOP62 readiness without token must be hidden', readinessPath, 'GET', withoutToken)
  }

  const wrongToken = TEST_TOKEN.replace(/^./, (ch) => ch === '0' ? '1' : '0')
  const wrong = await workerFetch(readinessPath, { token: wrongToken })
  if (wrong.response.status !== 404) {
    throw workerFailure('SHOP62 readiness with wrong token must be hidden', readinessPath, 'GET', wrong)
  }

  const before = await shop62SideEffectSnapshot()
  const valid = await poll('isolated Worker route/token propagation', () => workerFetch(readinessPath),
    (result) => result.response.status === 200, 90000, 2000)
  if (!valid.response.ok || typeof valid.data !== 'object' || valid.data?.ok !== true || valid.data?.tokenVerified !== true) {
    throw workerFailure('SHOP62 readiness with valid token failed', readinessPath, 'GET', valid)
  }
  if (valid.data?.mode !== 'isolated-e2e' || valid.data?.capability !== 'SHOP62_PROVIDER_E2E' ||
      valid.data?.checkout !== 'POST /__shop62/checkout' || valid.data?.createsOrder !== false ||
      valid.data?.purchaseEnabled !== false || valid.data?.turnstile !== 'BYPASSED_BY_ISOLATED_TEST_ROUTE') {
    throw workerFailure('SHOP62 readiness contract mismatch', readinessPath, 'GET', valid)
  }
  const after = await shop62SideEffectSnapshot()
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error(`SHOP62 readiness route changed DB state: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
  }
  console.log(`SHOP-6.2 isolated Worker route contract: PASS; side effects: NONE; snapshot=${JSON.stringify(after)}`)
  console.log('Turnstile runtime: SKIPPED_ISOLATED_TEST_ROUTE (production checkout security is unchanged)')
}

async function workerCheckout(product, providerMethod = 'CARD', deliveryMethod = 'SHIPPING') {
  const pathname = '/__shop62/checkout'
  const result = await workerFetch(pathname, {
    method: 'POST',
    body: { sku: product.sku, providerMethod, deliveryMethod },
  })
  if (!result.response.ok) throw workerFailure('SHOP62 Worker checkout failed', pathname, 'POST', result)
  if (!result.data || typeof result.data !== 'object') throw workerFailure('SHOP62 Worker checkout returned invalid body', pathname, 'POST', result)
  return result.data
}

async function getOrder(orderId) {
  const rows = await rest(`commerce_orders?id=eq.${encodeURIComponent(orderId)}&select=*`)
  return rows?.[0]
}

async function getProduct(productId) {
  const rows = await rest(`products?id=eq.${encodeURIComponent(productId)}&select=id,sku,status`)
  return rows?.[0]
}

async function openUrl(url) {
  try {
    if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
  } catch { /* user can copy URL */ }
}

async function waitForInteractivePayment(checkout, label) {
  console.log(`\n${label} CHECKOUT URL:`)
  console.log(checkout.checkoutUrl)
  await openUrl(checkout.checkoutUrl)
  if (label.includes('CARD')) {
    console.log('Use Stripe TEST card 4242 4242 4242 4242, any future expiry, any 3-digit CVC.')
  } else {
    console.log('Select/complete the Stripe TEST PromptPay flow in the browser.')
  }
  const rl = createInterface({ input, output })
  await rl.question('Complete the test payment in the browser, then press Enter here... ')
  rl.close()
  return poll(`${label} payment`, () => getOrder(checkout.orderId), (order) => order?.payment_status === 'PAID', 300000, 2500)
}

async function stripePaymentMethodType(paymentIntentId) {
  if (!paymentIntentId) return null
  const pi = await stripe(`payment_intents/${encodeURIComponent(paymentIntentId)}`)
  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id
  if (!chargeId) return null
  const charge = await stripe(`charges/${encodeURIComponent(chargeId)}`)
  return charge?.payment_method_details?.type || null
}

function stripeSignature(raw) {
  const timestamp = Math.floor(Date.now() / 1000)
  const digest = createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${raw}`).digest('hex')
  return `t=${timestamp},v1=${digest}`
}

async function sendSignedPaymentEvent(order, { eventId, amountMinor, currency, paymentIntentId }) {
  const payload = {
    id: eventId,
    type: 'payment_intent.succeeded',
    data: { object: {
      id: paymentIntentId,
      object: 'payment_intent',
      amount: amountMinor,
      amount_received: amountMinor,
      currency: currency.toLowerCase(),
      metadata: { order_id: order.id },
    } },
  }
  const raw = JSON.stringify(payload)
  return fetch(`${WORKER_URL}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(raw) },
    body: raw,
  })
}

async function adminAction(orderId, actionName, actionData = {}) {
  return rpc('admin_commerce_order_action', {
    target_order_id: orderId,
    action_name: actionName,
    actor_id: null,
    action_data: actionData,
  })
}

async function clearTestToken() {
  await rest('commerce_store_settings?id=eq.1', {
    method: 'PATCH',
    body: { shop62_test_token_hash: null, shop62_test_token_expires_at: null },
  })
}

async function cleanup({ strict = false } = {}) {
  const failures = []
  try {
    const removed = await rpc('cleanup_shop62_test_fixtures', { test_token: TEST_TOKEN })
    console.log(`Fixture cleanup: PASS (${removed ?? 0} orders removed)`)
  } catch (error) {
    failures.push(`fixture cleanup: ${error.message}`)
  }
  try {
    await clearTestToken()
  } catch (error) {
    failures.push(`test token cleanup: ${error.message}`)
  }
  try {
    const [products, orderItems, settings] = await Promise.all([
      rest('products?sku=like.AT-TST-%25&select=sku&limit=1'),
      rest('commerce_order_items?sku=like.AT-TST-%25&select=sku&limit=1'),
      getSettings(),
    ])
    if (products?.length || orderItems?.length) failures.push('AT-TST fixtures remain')
    if (settings?.shop62_test_token_hash || settings?.shop62_test_token_expires_at) failures.push('SHOP62 test token remains active')
    if (settings?.purchase_enabled) failures.push('purchase_enabled became true')
  } catch (error) {
    failures.push(`cleanup verification: ${error.message}`)
  }
  if (failures.length) {
    const message = failures.join('; ')
    if (strict) throw new Error(`SHOP62_CLEANUP_FAILED: ${message}`)
    console.warn(`Fixture cleanup warning: ${message}`)
  } else {
    console.log('Fixture/token/purchase guard cleanup verification: PASS')
  }
}

async function run() {
  SUPABASE_URL = required('SHOP62_SUPABASE_URL').replace(/\/$/, '')
  SUPABASE_SECRET = required('SHOP62_SUPABASE_SECRET')
  WORKER_URL = required('SHOP62_WORKER_URL').replace(/\/$/, '')
  TEST_TOKEN = required('SHOP62_TEST_TOKEN')
  WEBHOOK_SECRET = required('SHOP62_STRIPE_WEBHOOK_SECRET')

  const evidence = {
    provider: 'STRIPE', mode: 'test', card: 'FAIL', promptPay: 'SKIPPED_DISABLED', signedWebhook: 'FAIL',
    duplicateEvent: 'FAIL', amountMismatch: 'FAIL', currencyMismatch: 'FAIL', reservationExpiry: 'FAIL',
    shippingLifecycle: 'FAIL', pickupLifecycle: 'FAIL', documentSnapshot: 'FAIL', warrantySnapshot: 'FAIL',
    refundReturned: 'FAIL', warrantyVoided: 'FAIL', harness: 'isolated-workers-dev',
  }
  let success = false
  try {
    const settings = await getSettings()
    if (!settings) throw new Error('Commerce store settings not found')
    if (settings.purchase_enabled) throw new Error('purchase_enabled must remain false during SHOP-6.2')
    if (!stripeSecret().startsWith('sk_test_')) throw new Error('SHOP-6.2 accepts Stripe sk_test_ only')

    await rpc('set_shop62_test_token', { test_token: TEST_TOKEN, ttl_minutes: 90 })
    console.log('SHOP-6.2 short-lived DB token: PASS')
    await verifyWorkerRouteContract()

    // 1) Real hosted Checkout card + signed Stripe webhook.
    const cardProduct = await seedProduct('CARD')
    const cardCheckout = await workerCheckout(cardProduct, 'CARD', 'SHIPPING')
    const cardOrder = await waitForInteractivePayment(cardCheckout, 'CARD')
    evidence.card = (await stripePaymentMethodType(cardOrder.provider_payment_intent_id)) === 'card' ? 'PASS' : 'FAIL'
    evidence.signedWebhook = cardOrder.provider_payment_status === 'PAID' ? 'PASS' : 'FAIL'
    if (evidence.card !== 'PASS' || evidence.signedWebhook !== 'PASS') throw new Error('Card/provider webhook verification failed')
    console.log('PASS Stripe TEST card + signed webhook')

    // Duplicate idempotency using the exact provider event ID already processed.
    const paymentEvents = await rest(`commerce_payment_events?order_id=eq.${encodeURIComponent(cardOrder.id)}&processed=eq.true&select=provider_event_id,event_type,provider_payment_id,amount_minor,currency&order=created_at.desc&limit=1`)
    const firstEvent = paymentEvents?.[0]
    if (!firstEvent?.provider_event_id) throw new Error('No processed Stripe event found for duplicate test')
    const duplicate = await rpc('process_gateway_payment_event', {
      provider_name: 'STRIPE', provider_event_id: firstEvent.provider_event_id, normalized_event: firstEvent.event_type,
      target_order_id: cardOrder.id, provider_payment_id: firstEvent.provider_payment_id, amount_minor: firstEvent.amount_minor,
      currency_code: firstEvent.currency, event_payload: { shop62DuplicateReplay: true },
    })
    evidence.duplicateEvent = duplicate?.duplicate === true ? 'PASS' : 'FAIL'
    if (evidence.duplicateEvent !== 'PASS') throw new Error('Duplicate event was not idempotent')
    console.log('PASS duplicate provider event idempotency')

    // Shipping lifecycle + snapshots.
    await adminAction(cardOrder.id, 'MARK_SHIPPED', { trackingCarrier: 'SHOP62', trackingNumber: 'SHOP62-TEST-TRACKING' })
    await adminAction(cardOrder.id, 'MARK_DELIVERED')
    const delivered = await getOrder(cardOrder.id)
    evidence.shippingLifecycle = delivered?.fulfillment_status === 'DELIVERED' ? 'PASS' : 'FAIL'
    const documents = await rest(`commerce_documents?order_id=eq.${encodeURIComponent(cardOrder.id)}&select=id,voided_at`)
    const warranties = await rest(`commerce_warranties?order_id=eq.${encodeURIComponent(cardOrder.id)}&select=id,status,warranty_days,terms`)
    evidence.documentSnapshot = documents?.some((doc) => !doc.voided_at) ? 'PASS' : 'FAIL'
    evidence.warrantySnapshot = warranties?.some((w) => w.status === 'ACTIVE' && Number(w.warranty_days) === 30) ? 'PASS' : 'FAIL'
    if ([evidence.shippingLifecycle,evidence.documentSnapshot,evidence.warrantySnapshot].includes('FAIL')) throw new Error('Shipping/document/warranty lifecycle failed')
    console.log('PASS shipping + document + warranty snapshots')

    // Real Stripe test refund; webhook may race with mark-pending and must remain safe.
    const refundPath = `/__shop62/refund/${encodeURIComponent(cardOrder.id)}`
    const refundResult = await workerFetch(refundPath, { method: 'POST' })
    if (!refundResult.response.ok) throw workerFailure('Stripe refund request failed', refundPath, 'POST', refundResult)
    const refunded = await poll('refund webhook', () => getOrder(cardOrder.id), (order) => order?.payment_status === 'REFUNDED', 180000, 2500)
    const returnedProduct = await getProduct(cardProduct.id)
    const voidWarranties = await rest(`commerce_warranties?order_id=eq.${encodeURIComponent(cardOrder.id)}&select=id,status`)
    evidence.refundReturned = refunded?.payment_status === 'REFUNDED' && returnedProduct?.status === 'returned' ? 'PASS' : 'FAIL'
    evidence.warrantyVoided = voidWarranties?.length > 0 && voidWarranties.every((w) => w.status === 'VOID') ? 'PASS' : 'FAIL'
    if (evidence.refundReturned !== 'PASS' || evidence.warrantyVoided !== 'PASS') throw new Error('Refund/returned/warranty void failed')
    console.log('PASS Stripe TEST refund -> RETURNED + warranty VOID')

    // 2) Signed webhook amount mismatch rejection.
    const amountProduct = await seedProduct('AMOUNT')
    const amountResult = await createDirectOrder(amountProduct, 'SHIPPING')
    const amountOrder = await getOrder(amountResult.orderId)
    const amountMinor = Math.round(Number(amountOrder.total) * 100)
    const badAmount = await sendSignedPaymentEvent(amountOrder, {
      eventId: `evt_shop62_amount_${randomBytes(8).toString('hex')}`, amountMinor: amountMinor + 1,
      currency: amountOrder.currency, paymentIntentId: `pi_shop62_amount_${randomBytes(8).toString('hex')}`,
    })
    const amountAfter = await getOrder(amountOrder.id)
    evidence.amountMismatch = badAmount.status === 500 && amountAfter.payment_status === 'UNPAID' ? 'PASS' : 'FAIL'
    if (evidence.amountMismatch !== 'PASS') throw new Error('Amount mismatch rejection failed')
    console.log('PASS signed webhook amount mismatch rejection')

    // 3) Signed webhook currency mismatch rejection.
    const currencyProduct = await seedProduct('CURRENCY')
    const currencyResult = await createDirectOrder(currencyProduct, 'SHIPPING')
    const currencyOrder = await getOrder(currencyResult.orderId)
    const currencyMinor = Math.round(Number(currencyOrder.total) * 100)
    const badCurrency = await sendSignedPaymentEvent(currencyOrder, {
      eventId: `evt_shop62_currency_${randomBytes(8).toString('hex')}`, amountMinor: currencyMinor,
      currency: currencyOrder.currency === 'THB' ? 'USD' : 'THB', paymentIntentId: `pi_shop62_currency_${randomBytes(8).toString('hex')}`,
    })
    const currencyAfter = await getOrder(currencyOrder.id)
    evidence.currencyMismatch = badCurrency.status === 500 && currencyAfter.payment_status === 'UNPAID' ? 'PASS' : 'FAIL'
    if (evidence.currencyMismatch !== 'PASS') throw new Error('Currency mismatch rejection failed')
    console.log('PASS signed webhook currency mismatch rejection')

    // 4) Expiry releases reservation.
    const expiryProduct = await seedProduct('EXPIRY')
    const expiryResult = await createDirectOrder(expiryProduct, 'SHIPPING')
    const expiryOrderId = expiryResult.orderId
    const expiredAt = new Date(Date.now() - 60000).toISOString()
    await rest(`commerce_orders?id=eq.${encodeURIComponent(expiryOrderId)}`, { method: 'PATCH', body: { reservation_expires_at: expiredAt } })
    await rest(`commerce_reservations?order_id=eq.${encodeURIComponent(expiryOrderId)}`, { method: 'PATCH', body: { expires_at: expiredAt } })
    await rpc('expire_commerce_reservations', { max_orders: 200 })
    const expiryOrder = await getOrder(expiryOrderId)
    const expiryProductAfter = await getProduct(expiryProduct.id)
    evidence.reservationExpiry = expiryOrder?.order_status === 'EXPIRED' && expiryProductAfter?.status === 'published' ? 'PASS' : 'FAIL'
    if (evidence.reservationExpiry !== 'PASS') throw new Error('Reservation expiry release failed')
    console.log('PASS reservation expiry release')

    // 5) Pickup state machine using a correctly signed synthetic provider success event.
    const pickupProduct = await seedProduct('PICKUP')
    const pickupResult = await createDirectOrder(pickupProduct, 'PICKUP')
    let pickupOrder = await getOrder(pickupResult.orderId)
    const pickupMinor = Math.round(Number(pickupOrder.total) * 100)
    const pickupSigned = await sendSignedPaymentEvent(pickupOrder, {
      eventId: `evt_shop62_pickup_${randomBytes(8).toString('hex')}`, amountMinor: pickupMinor,
      currency: pickupOrder.currency, paymentIntentId: `pi_shop62_pickup_${randomBytes(8).toString('hex')}`,
    })
    if (pickupSigned.status !== 200) throw new Error(`Pickup signed webhook failed: ${pickupSigned.status}`)
    await adminAction(pickupOrder.id, 'MARK_PICKUP_READY')
    await adminAction(pickupOrder.id, 'COMPLETE')
    pickupOrder = await getOrder(pickupOrder.id)
    evidence.pickupLifecycle = pickupOrder?.fulfillment_status === 'PICKED_UP' ? 'PASS' : 'FAIL'
    if (evidence.pickupLifecycle !== 'PASS') throw new Error('Pickup lifecycle failed')
    console.log('PASS pickup lifecycle')

    // 6) Optional real PromptPay test when intended production config enables it.
    if (settings.stripe_promptpay_enabled) {
      const promptProduct = await seedProduct('PROMPTPAY')
      const promptCheckout = await workerCheckout(promptProduct, 'PROMPTPAY', 'PICKUP')
      const promptOrder = await waitForInteractivePayment(promptCheckout, 'PROMPTPAY')
      evidence.promptPay = (await stripePaymentMethodType(promptOrder.provider_payment_intent_id)) === 'promptpay' ? 'PASS' : 'FAIL'
      if (evidence.promptPay !== 'PASS') throw new Error('PromptPay TEST verification failed')
      console.log('PASS Stripe TEST PromptPay async/provider flow')
    } else {
      console.log('SKIP PromptPay: stripe_promptpay_enabled=false')
    }

    await cleanup({ strict: true })
    const acceptance = await rpc('record_shop62_provider_acceptance', { evidence })
    if (acceptance?.purchaseEnabled !== false) throw new Error('Acceptance unexpectedly enabled public checkout')
    success = true

    console.log('\nSHOP-6.2 PROVIDER E2E: PASS')
    console.log(JSON.stringify(evidence, null, 2))
    console.log('purchase_enabled remains FALSE. Production activation is a separate explicit step.')
  } finally {
    if (!success) await cleanup()
  }
}

if (mode === 'create-webhook') await createWebhook()
else if (mode === 'delete-webhook') await deleteWebhook()
else if (mode === 'cleanup-webhooks') await cleanupMatchingWebhooks()
else if (mode === 'run') await run()
else throw new Error(`Unknown SHOP-6.2 provider E2E mode: ${mode}`)
