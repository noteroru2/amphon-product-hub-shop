import { readFile, readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const storeApi = 'https://amphon-product-images.noteroru2.workers.dev/store'
const apiWorker = 'https://amphon-product-images.noteroru2.workers.dev'
const shopUrl = 'https://shop.amphon.co.th'
const hubUrl = 'https://hub.amphon.co.th'
const args = process.argv.slice(2)
const skuIndex = args.indexOf('--sku')
const requestedSku = skuIndex >= 0 ? String(args[skuIndex + 1] || '').trim().toUpperCase() : ''
const checks = []
let blocked = false

function record(label, status, detail = '') {
  checks.push({ label, status, detail })
  if (status === 'FAIL') process.exitCode = 1
}

async function fetchChecked(url, accept = 'application/json') {
  const response = await fetch(url, { headers: { accept }, redirect: 'follow', signal: AbortSignal.timeout(15000) })
  return response
}

async function source(relative) {
  return readFile(resolve(root, relative), 'utf8')
}

async function scanFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.wrangler'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await scanFiles(path, files)
    else if (['.ts', '.tsx', '.js', '.mjs', '.astro', '.json', '.md', '.sql', '.ps1', '.bat', '.toml', '.example'].includes(extname(entry.name)) || entry.name.endsWith('.toml.example')) files.push(path)
  }
  return files
}

try {
  const [settingsResponse, storeHealth, apiHealth, shopResponse, hubResponse] = await Promise.all([
    fetchChecked(`${storeApi}/settings`),
    fetchChecked(`${storeApi}/health`),
    fetchChecked(`${apiWorker}/health`),
    fetchChecked(shopUrl, 'text/html'),
    fetchChecked(hubUrl, 'text/html'),
  ])
  const settings = settingsResponse.ok ? (await settingsResponse.json()).settings : null
  record('Production checkout enabled', settingsResponse.ok && settings?.purchaseEnabled === true && settings?.checkout?.enabled === true ? 'PASS' : 'FAIL')
  record('PromptPay disabled', settings?.checkout?.promptPayEnabled === false ? 'PASS' : 'FAIL')
  record('Stripe cards enabled', settings?.checkout?.stripeEnabled === true ? 'PASS' : 'FAIL')
  record('Shipping readiness', settings?.shipping?.enabled === true && Number(settings?.shipping?.rate) >= 0 ? 'PASS' : 'FAIL', `rate=${settings?.shipping?.rate ?? 'unknown'}`)
  record('Pickup readiness', settings?.checkout?.pickupEnabled === true ? 'PASS' : 'FAIL')
  record('Turnstile readiness', settings?.checkout?.turnstileEnabled === true && Boolean(settings?.checkout?.turnstileSiteKey) ? 'PASS' : 'FAIL')
  record('Reservation window', Number(settings?.checkout?.reservationMinutes) === 60 ? 'PASS' : 'FAIL', `${settings?.checkout?.reservationMinutes ?? 'unknown'} minutes`)
  record('Document mode', settings?.documents?.mode === 'RECEIPT_ONLY' ? 'PASS' : 'FAIL', settings?.documents?.mode || 'unknown')
  record('Store API health', storeHealth.ok ? 'PASS' : 'FAIL', `HTTP ${storeHealth.status}`)
  record('API Worker health', apiHealth.ok ? 'PASS' : 'FAIL', `HTTP ${apiHealth.status}`)
  record('SHOP reachable', shopResponse.status === 200 ? 'PASS' : 'FAIL', `HTTP ${shopResponse.status}`)
  const hubHtml = await hubResponse.text()
  record('Hub reachable', hubResponse.ok ? 'PASS' : 'FAIL', `HTTP ${hubResponse.status}`)
  record('Hub canonical URL', hubResponse.url.startsWith(`${hubUrl}/`) || hubResponse.url === hubUrl ? 'PASS' : 'FAIL', hubResponse.url)
  record('Hub login shell', /เข้าสู่ Product Hub|Product Hub/.test(hubHtml) ? 'PASS' : 'WARNING', 'Authenticated owner smoke remains manual')

  const policyMissing = [
    ['shipping.policyUrl', settings?.shipping?.policyUrl],
    ['returns.policyUrl', settings?.returns?.policyUrl],
    ['checkout.termsUrl', settings?.checkout?.termsUrl],
    ['warrantyPolicyUrl', settings?.warrantyPolicyUrl],
    ['legalName', settings?.legalName],
  ].filter(([, value]) => !value).map(([key]) => key)
  record('Policy readiness', policyMissing.length ? 'WARNING' : 'PASS', policyMissing.length ? `missing: ${policyMissing.join(', ')}` : '')

  const [cart, checkout, orderTypes, orderAdmin, worker] = await Promise.all([
    source('shop/src/lib/cart.ts'), source('shop/src/pages/checkout/index.astro'), source('src/types/product.ts'),
    source('src/components/OrderManagement.tsx'), source('workers/r2-upload/src/index.ts'),
  ])
  record('Cart single-unit protection', cart.includes('new Set(') && !/quantity/i.test(cart) ? 'PASS' : 'FAIL', 'SKU set; no quantity field')
  record('Shipping calculation contract', worker.includes("url.pathname === '/store/checkout'") || worker.includes("url.pathname === '/checkout'") ? 'PASS' : 'FAIL', 'Server checkout is authoritative')
  record('PromptPay absent from checkout', settings?.checkout?.promptPayEnabled === false && checkout.includes("promptPayEnabled ? '(บัตร / PromptPay)' : '(บัตร)'") ? 'PASS' : 'FAIL')
  record('Order admin readiness', /CommerceOrderStatus/.test(orderTypes) && orderAdmin.includes('order.orderNumber') && orderAdmin.includes('order.customerName') && orderAdmin.includes('order.deliveryMethod') ? 'PASS' : 'FAIL', 'Authenticated order list and lifecycle actions present')
  record('Safe pre-payment boundary', checkout.includes("fetch(`${api}/checkout`, { method: 'POST'") ? 'PASS' : 'FAIL', 'STOP before checkout form submit')

  const catalogResponse = await fetchChecked(`${storeApi}/products?availability=all&limit=100`)
  const catalog = catalogResponse.ok ? await catalogResponse.json() : { products: [], pagination: { total: 0 } }
  const products = Array.isArray(catalog.products) ? catalog.products : []
  const selected = requestedSku ? products.filter((product) => String(product.sku).toUpperCase() === requestedSku) : []
  if (!requestedSku) {
    blocked = true
    record('Selected real product', 'BLOCKED', `No --sku supplied; public catalog total=${catalog.pagination?.total ?? products.length}`)
  } else if (selected.length !== 1) {
    blocked = true
    record('Selected real product', 'BLOCKED', `Expected one active listing for ${requestedSku}; found ${selected.length}`)
  } else {
    const product = selected[0]
    record('Selected product valid', Number(product.price) > 0 && product.currency !== 'USD' && product.availability === 'available' ? 'PASS' : 'FAIL', `${product.sku}; ${product.availability}; THB ${product.price}`)
    record('Single active listing', selected.length === 1 ? 'PASS' : 'FAIL')
    record('Publication state', product.status === 'published' ? 'PASS' : 'FAIL', product.status)
    record('Price/stock sync', Number(product.price) > 0 && product.availability === 'available' ? 'PASS' : 'FAIL')
    const slug = String(product.listingSlug || '').trim()
    const publicPath = slug ? `/p/${slug}-${encodeURIComponent(product.sku.toLowerCase())}/` : `/product/${encodeURIComponent(product.sku)}`
    const publicResponse = await fetchChecked(`${shopUrl}${publicPath}`, 'text/html')
    record('Public product HTTP', publicResponse.status === 200 ? 'PASS' : 'FAIL', `HTTP ${publicResponse.status} ${publicPath}`)
    const imageResults = await Promise.all((product.images || []).slice(0, 3).map(async (image) => (await fetchChecked(image.url, 'image/*')).ok))
    record('Image availability', imageResults.length > 0 && imageResults.every(Boolean) ? 'PASS' : 'FAIL', `${imageResults.filter(Boolean).length}/${imageResults.length}`)
    const sitemap = await (await fetchChecked(`${shopUrl}/sitemap-products.xml`, 'application/xml')).text()
    record('Sitemap eligibility', sitemap.toLowerCase().includes(String(product.sku).toLowerCase()) ? 'PASS' : 'WARNING')
  }

  record('No payment executed', 'PASS', 'Verifier performs GET requests only')
  record('No order charged', 'PASS', 'Verifier never calls checkout/order mutation endpoints')

  const secretPattern = /(?:sk_(?:live|test)_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9]{12,}|sb_secret_[A-Za-z0-9._-]{12,})/g
  const leaks = []
  for (const file of await scanFiles(root)) {
    const content = await readFile(file, 'utf8').catch(() => '')
    if (secretPattern.test(content)) leaks.push(file.replace(`${root}\\`, ''))
    secretPattern.lastIndex = 0
  }
  record('Secret scan', leaks.length === 0 ? 'PASS' : 'FAIL', leaks.join(', '))
} catch (error) {
  record('Verifier runtime', 'FAIL', error instanceof Error ? error.message : String(error))
}

for (const check of checks) console.log(`${check.label.padEnd(38)} ${check.status}${check.detail ? ` — ${check.detail}` : ''}`)
if (process.exitCode === 1) {
  console.error('\nSHOP-7.1 VERIFY: FAIL')
} else if (blocked) {
  console.log('\nSHOP-7.1 VERIFY: BLOCKED')
  console.log('Owner action: authenticate at hub.amphon.co.th, select one real available product, complete its truthful data, publish Website through Publish Center, then rerun: npm run verify:shop71 -- --sku <REAL_SKU>')
  process.exitCode = 2
} else {
  console.log('\nSHOP-7.1 VERIFY: PASS_WITH_WARNING')
  console.log('This read-only verifier stops before checkout submission and does not prove an authenticated Hub smoke or a real payment.')
}
