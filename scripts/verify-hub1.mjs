import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Resolver } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'

const root = resolve(import.meta.dirname, '..')
const live = process.argv.includes('--live')
const failures = []
const warnings = []
const publicResolver = new Resolver()
publicResolver.setServers(['1.1.1.1', '1.0.0.1'])

async function text(file) {
  return readFile(resolve(root, file), 'utf8')
}

function check(ok, label) {
  if (!ok) failures.push(label)
}

async function publicDnsHttpsGet(rawUrl) {
  const url = new URL(rawUrl)
  const addresses = await publicResolver.resolve4(url.hostname)
  if (!addresses.length) throw new Error(`Public DNS has no A record for ${url.hostname}`)
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpsRequest({
      hostname: addresses[0],
      servername: url.hostname,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { Host: url.host, 'User-Agent': 'AMPHON-HUB1-Verify/1.0' },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolveRequest({
        ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 400,
        status: Number(response.statusCode),
        text: async () => Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.on('error', rejectRequest)
    request.end()
  })
}

for (const file of ['wrangler.jsonc', 'index.html', 'public/robots.txt', 'src/lib/qr.ts', 'workers/r2-upload/wrangler.jsonc']) {
  try { await access(resolve(root, file)) } catch { failures.push(`missing ${file}`) }
}

const [env, envExample, hubWrangler, workerWrangler, index, robots, qr, app, shopWrangler, shopAstro] = await Promise.all([
  text('.env'), text('.env.example'), text('wrangler.jsonc'), text('workers/r2-upload/wrangler.jsonc'),
  text('index.html'), text('public/robots.txt'), text('src/lib/qr.ts'), text('src/App.tsx'),
  text('shop/wrangler.jsonc'), text('shop/astro.config.mjs'),
])

check(/^VITE_PUBLIC_APP_URL=https:\/\/hub\.amphon\.co\.th$/m.test(env), 'Hub production env is not canonical')
check(/^VITE_PUBLIC_APP_URL=https:\/\/hub\.amphon\.co\.th$/m.test(envExample), 'Hub example env is not canonical')
check(hubWrangler.includes('"name": "amphon-product-hub"'), 'Product Hub Worker service name missing')
check(hubWrangler.includes('"directory": "./dist"') && hubWrangler.includes('"not_found_handling": "single-page-application"'), 'Workers Static Assets SPA config missing')
check(hubWrangler.includes('"pattern": "hub.amphon.co.th"') && hubWrangler.includes('"custom_domain": true'), 'Hub custom domain config missing')
for (const origin of ['https://hub.amphon.co.th', 'https://app.amphon.co.th', 'https://shop.amphon.co.th']) {
  check(workerWrangler.includes(origin), `API CORS origin missing: ${origin}`)
}
check(!/"ALLOWED_ORIGINS"\s*:\s*"\*"/.test(workerWrangler), 'Authenticated API CORS must not be wildcarded')
check(qr.includes('import.meta.env.VITE_PUBLIC_APP_URL') && qr.includes("url.searchParams.set('sku', sku)"), 'QR canonical URL contract missing')
check(index.includes('<meta name="robots" content="noindex,nofollow"'), 'Hub noindex meta missing')
check(/User-agent:\s*\*[\s\S]*Disallow:\s*\//i.test(robots), 'Hub robots.txt does not disallow crawling')
check(app.includes('if (!session) return <LoginScreen />'), 'Hub authentication shell guard missing')
check(app.includes('signInWithPassword'), 'Hub password authentication flow missing')
check(shopWrangler.includes('shop.amphon.co.th') && !shopWrangler.includes('hub.amphon.co.th'), 'SHOP Worker domain was changed')
check(shopAstro.includes("site: 'https://shop.amphon.co.th'"), 'SHOP canonical URL was changed')

const secretPattern = /(?:sb_secret_|sk_(?:live|test)_|whsec_)[A-Za-z0-9_-]{12,}/
for (const file of ['wrangler.jsonc', 'index.html', 'public/robots.txt', 'scripts/verify-hub1.mjs']) {
  check(!secretPattern.test(await text(file)), `secret-like value found: ${file}`)
}

let liveState = null
if (live) {
  let hubResponse
  try { hubResponse = await fetch('https://hub.amphon.co.th/', { redirect: 'follow' }) }
  catch (error) {
    if (error?.cause?.code !== 'ENOTFOUND') throw error
    hubResponse = await publicDnsHttpsGet('https://hub.amphon.co.th/')
    warnings.push('Windows resolver still had pre-cutover negative DNS state; Hub HTTPS was verified through Cloudflare public DNS')
  }
  const hubHtml = await hubResponse.text()
  check(hubResponse.ok, `Hub HTTPS failed: HTTP ${hubResponse.status}`)
  check(hubHtml.includes('AMPHON Product Hub'), 'Hub root is not the Product Hub build')
  check(hubHtml.includes('noindex,nofollow'), 'Deployed Hub noindex missing')

  const apiBase = env.match(/^VITE_R2_UPLOAD_API=(https:\/\/[^\s]+)$/m)?.[1]?.replace(/\/$/, '')
  check(Boolean(apiBase), 'VITE_R2_UPLOAD_API is missing')
  if (apiBase) {
    const apiResponse = await fetch(`${apiBase}/health`, { headers: { Origin: 'https://hub.amphon.co.th' } })
    const api = await apiResponse.json()
    check(apiResponse.ok && api.ok === true, `Production API health failed: HTTP ${apiResponse.status}`)
    check(apiResponse.headers.get('access-control-allow-origin') === 'https://hub.amphon.co.th', 'API GET CORS does not allow Hub origin')
    for (const method of ['POST', 'PATCH']) {
      const preflight = await fetch(`${apiBase}/upload`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://hub.amphon.co.th', 'Access-Control-Request-Method': method },
      })
      check(preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === 'https://hub.amphon.co.th', `${method} CORS preflight failed`)
    }
    const storeHealthResponse = await fetch(`${apiBase}/store/health`)
    const storeHealth = await storeHealthResponse.json()
    check(storeHealthResponse.ok && storeHealth.ok === true, 'Production Store health failed')
    const storeSettingsResponse = await fetch(`${apiBase}/store/settings?hub1=${Date.now()}`)
    const storeSettings = await storeSettingsResponse.json()
    check(storeSettings.settings?.purchaseEnabled === true, 'SHOP purchase_enabled is not true')
    check(storeSettings.settings?.checkout?.stripeEnabled === true, 'SHOP Stripe cards are not enabled')
    check(storeSettings.settings?.checkout?.promptPayEnabled === false, 'SHOP PromptPay is not disabled')
    liveState = { storeHealth, storeSettings }
  }

  const shopResponse = await fetch('https://shop.amphon.co.th/', { redirect: 'follow' })
  check(shopResponse.ok, `SHOP HTTP failed: ${shopResponse.status}`)

  let legacyDns = false
  try { legacyDns = (await publicResolver.resolve4('app.amphon.co.th')).length > 0 } catch {}
  if (!legacyDns) try { legacyDns = (await publicResolver.resolve6('app.amphon.co.th')).length > 0 } catch {}
  if (legacyDns) {
    const legacyResponse = await fetch('https://app.amphon.co.th/', { redirect: 'follow' })
    check(legacyResponse.ok, `Legacy Hub hostname failed: HTTP ${legacyResponse.status}`)
  } else {
    warnings.push('Legacy app.amphon.co.th had no DNS before HUB-1; compatibility check is N/A')
  }
}

if (failures.length) {
  console.error('HUB-1 VERIFY: FAIL')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('HUB-1 VERIFY: PASS')
console.log('Hub canonical URL: PASS')
console.log('Legacy Hub origin retained in API CORS: PASS')
console.log('API CORS hub origin: PASS')
console.log('QR canonical host: PASS')
console.log('Hub noindex: PASS')
console.log('Shop URL untouched: PASS')
console.log(`Live verification: ${live ? 'PASS' : 'NOT RUN'}`)
if (liveState) {
  console.log('SHOP purchase_enabled: TRUE')
  console.log('Stripe cards: ENABLED')
  console.log('PromptPay: DISABLED')
  console.log('Production API health: PASS')
  console.log('Hub HTTPS: PASS')
}
warnings.forEach((warning) => console.log(`WARNING: ${warning}`))
console.log('No secret exposure: PASS')
