import { readFile, writeFile, copyFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const workerPath = resolve(root, 'workers/r2-upload/src/index.ts')
const e2ePath = resolve(root, 'deployment/SHOP62-PROVIDER-E2E.mjs')
const ps1Path = resolve(root, 'deployment/SHOP62-PROVIDER-E2E.ps1')

async function load(path) { return readFile(path, 'utf8') }
async function save(path, text) { await writeFile(path, text.replace(/\r\n/g, '\n'), 'utf8') }
async function backup(path) {
  const backupPath = `${path}.shop62-routefix.bak`
  try { await access(backupPath); return } catch {}
  await copyFile(path, backupPath)
}
function mustReplace(text, oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`${label}: anchor not found`)
  return text.replace(oldText, newText)
}

let worker = await load(workerPath)
let e2e = await load(e2ePath)
let ps1 = await load(ps1Path)
const statuses = []

if (!worker.includes('SHOP62_TEST_MODE?: string')) {
  worker = mustReplace(worker, '  SHOP62_TEST_TOKEN?: string\n', '  SHOP62_TEST_TOKEN?: string\n  SHOP62_TEST_MODE?: string\n', 'Worker Env')
  statuses.push('Worker Env SHOP62_TEST_MODE: patched')
} else statuses.push('Worker Env SHOP62_TEST_MODE: already applied')

if (!worker.includes('function shop62TestModeEnabled(env: Env)')) {
  worker = mustReplace(worker, 'function shop62TokenAllowed(request: Request, env: Env) {\n', "function shop62TestModeEnabled(env: Env) {\n  return env.SHOP62_TEST_MODE === 'isolated-e2e'\n}\n\nfunction shop62TokenAllowed(request: Request, env: Env) {\n", 'Worker isolated-mode guard')
  statuses.push('Worker isolated-mode guard: patched')
} else statuses.push('Worker isolated-mode guard: already applied')

if (!worker.includes("url.pathname === '/__shop62/readiness'")) {
  const rx = /async function handleShop62TestRoutes\(request: Request, env: Env, url: URL\): Promise<Response \| null> \{[\s\S]*?if \(request\.method === 'POST' && url\.pathname === '\/__shop62\/checkout'\) \{\n/
  if (!rx.test(worker)) throw new Error('Worker SHOP62 handler anchor not found')
  worker = worker.replace(rx, "async function handleShop62TestRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {\n  if (!url.pathname.startsWith('/__shop62/')) return null\n  // SHOP-6.2 routes are usable only on the deliberately isolated E2E Worker.\n  // Production has neither SHOP62_TEST_MODE=isolated-e2e nor SHOP62_TEST_TOKEN.\n  if (!shop62TestModeEnabled(env) || !env.SHOP62_TEST_TOKEN || !shop62TokenAllowed(request, env)) {\n    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })\n  }\n  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: storeCorsHeaders() })\n\n  // Side-effect-free runtime contract probe. It proves the deployed entrypoint contains\n  // the test route AND that the exact Wrangler secret matches the harness token.\n  if (request.method === 'GET' && url.pathname === '/__shop62/readiness') {\n    return storeJson({\n      ok: true,\n      capability: 'SHOP62_E2E',\n      mode: 'isolated-e2e',\n      checkout: 'POST /__shop62/checkout',\n      refund: 'POST /__shop62/refund/:orderId',\n      tokenVerified: true,\n    }, 200, 'no-store')\n  }\n\n  if (request.method === 'POST' && url.pathname === '/__shop62/checkout') {\n")
  statuses.push('Worker readiness route: patched')
} else {
  if (!worker.includes('!shop62TestModeEnabled(env)')) {
    worker = worker.replace('if (!env.SHOP62_TEST_TOKEN || !shop62TokenAllowed(request, env))', 'if (!shop62TestModeEnabled(env) || !env.SHOP62_TEST_TOKEN || !shop62TokenAllowed(request, env))')
  }
  statuses.push('Worker readiness route: already applied')
}

if (ps1.includes("[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')")) {
  ps1 = ps1.replace("return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')", "# Hex avoids header/JSON/base64url transport ambiguity across PowerShell, Wrangler and Node.\n  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')")
  statuses.push('PowerShell SHOP62 token encoding: patched to 64-char hex')
} else if (ps1.includes("ToString('x2')")) statuses.push('PowerShell SHOP62 token encoding: already hex')
else throw new Error('PowerShell SHOP62 token generator evolved; refusing blind edit')

if (!ps1.includes("SHOP62_TEST_MODE = 'isolated-e2e'")) {
  ps1 = mustReplace(ps1, "    ALLOWED_ORIGINS = '*'\n", "    ALLOWED_ORIGINS = '*'\n    SHOP62_TEST_MODE = 'isolated-e2e'\n", 'Wrangler vars')
  statuses.push('Isolated Wrangler SHOP62_TEST_MODE: patched')
} else statuses.push('Isolated Wrangler SHOP62_TEST_MODE: already applied')

if (e2e.includes('authorization: `Bearer ${SUPABASE_SECRET}`,')) {
  e2e = e2e.replace('    authorization: `Bearer ${SUPABASE_SECRET}`,\n', '')
  statuses.push('Supabase secret Bearer misuse: removed')
} else statuses.push('Supabase secret Bearer misuse: already absent')

if (!e2e.includes('async function verifyWorkerRouteContract()')) {
  const rx = /async function workerCheckout\(product, providerMethod = 'CARD', deliveryMethod = 'SHIPPING'\) \{[\s\S]*?\n}\n\n(?=async function getOrder)/
  if (!rx.test(e2e)) throw new Error('Provider workerCheckout anchor not found')
  e2e = e2e.replace(rx, "function sanitizedWorkerBody(raw) {\n  const text = String(raw || '').replaceAll(TEST_TOKEN, '[redacted]')\n  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text\n}\n\nasync function workerFetch(pathname, { method = 'GET', token = TEST_TOKEN, body } = {}) {\n  const headers = {}\n  if (token) headers['x-shop62-token'] = token\n  if (body !== undefined) headers['content-type'] = 'application/json'\n  const response = await fetch(`${WORKER_URL}${pathname}`, {\n    method,\n    headers,\n    body: body === undefined ? undefined : JSON.stringify(body),\n  })\n  const contentType = response.headers.get('content-type') || ''\n  const raw = await response.text().catch(() => '')\n  let data = raw\n  if (contentType.includes('application/json') && raw) {\n    try { data = JSON.parse(raw) } catch { data = raw }\n  }\n  return { response, contentType, raw, data }\n}\n\nfunction workerFailure(label, pathname, method, result) {\n  const body = typeof result.data === 'string' ? sanitizedWorkerBody(result.data) : JSON.stringify(result.data)\n  return new Error(\n    `${label}: method=${method} path=${pathname} status=${result.response.status} ` +\n    `contentType=${result.contentType || '(none)'} worker=${WORKER_URL} body=${body || '(empty)'}`,\n  )\n}\n\nasync function verifyWorkerRouteContract() {\n  const health = await fetch(`${WORKER_URL}/health`)\n  if (!health.ok) throw new Error(`SHOP62 isolated Worker health failed: status=${health.status} worker=${WORKER_URL}`)\n\n  const readinessPath = '/__shop62/readiness'\n  const withoutToken = await workerFetch(readinessPath, { token: null })\n  if (withoutToken.response.status !== 404) {\n    throw workerFailure('SHOP62 readiness without token must be hidden', readinessPath, 'GET', withoutToken)\n  }\n\n  const wrongToken = TEST_TOKEN.replace(/^./, (ch) => ch === '0' ? '1' : '0')\n  const wrong = await workerFetch(readinessPath, { token: wrongToken })\n  if (wrong.response.status !== 404) {\n    throw workerFailure('SHOP62 readiness with wrong token must be hidden', readinessPath, 'GET', wrong)\n  }\n\n  const valid = await workerFetch(readinessPath)\n  if (!valid.response.ok || typeof valid.data !== 'object' || valid.data?.ok !== true || valid.data?.tokenVerified !== true) {\n    throw workerFailure('SHOP62 readiness with valid token failed', readinessPath, 'GET', valid)\n  }\n  if (valid.data?.mode !== 'isolated-e2e' || valid.data?.checkout !== 'POST /__shop62/checkout') {\n    throw new Error(`SHOP62 readiness contract mismatch: mode=${String(valid.data?.mode || 'MISSING')} checkout=${String(valid.data?.checkout || 'MISSING')}`)\n  }\n  console.log('SHOP-6.2 isolated Worker route contract: PASS')\n}\n\nasync function workerCheckout(product, providerMethod = 'CARD', deliveryMethod = 'SHIPPING') {\n  const pathname = '/__shop62/checkout'\n  const result = await workerFetch(pathname, {\n    method: 'POST',\n    body: { sku: product.sku, providerMethod, deliveryMethod },\n  })\n  if (!result.response.ok) throw workerFailure('SHOP62 Worker checkout failed', pathname, 'POST', result)\n  if (!result.data || typeof result.data !== 'object') throw workerFailure('SHOP62 Worker checkout returned invalid body', pathname, 'POST', result)\n  return result.data\n}\n\n")
  statuses.push('Provider route readiness + diagnostics: patched')
} else statuses.push('Provider route readiness + diagnostics: already applied')

if (!e2e.includes('await verifyWorkerRouteContract()')) {
  e2e = mustReplace(e2e, "    console.log('SHOP-6.2 short-lived DB token: PASS')\n", "    console.log('SHOP-6.2 short-lived DB token: PASS')\n    await verifyWorkerRouteContract()\n", 'Provider pre-matrix route probe')
  statuses.push('Provider pre-matrix route probe: patched')
} else statuses.push('Provider pre-matrix route probe: already applied')

const refundRx = /    const refundResponse = await fetch\(`\$\{WORKER_URL}\/__shop62\/refund\/\$\{encodeURIComponent\(cardOrder\.id\)}`, \{[\s\S]*?if \(!refundResponse\.ok\) throw new Error\(`Stripe refund request failed:[^\n]*\n/
if (refundRx.test(e2e)) {
  e2e = e2e.replace(refundRx, "    const refundPath = `/__shop62/refund/${encodeURIComponent(cardOrder.id)}`\n    const refundResult = await workerFetch(refundPath, { method: 'POST' })\n    if (!refundResult.response.ok) throw workerFailure('Stripe refund request failed', refundPath, 'POST', refundResult)\n")
  statuses.push('Refund diagnostics: patched')
} else statuses.push('Refund diagnostics: preserved current implementation')

await backup(workerPath); await backup(e2ePath); await backup(ps1Path)
await save(workerPath, worker); await save(e2ePath, e2e); await save(ps1Path, ps1)
console.log('SHOP-6.2 route hotfix applied.')
for (const status of statuses) console.log(`- ${status}`)
console.log('Backups: *.shop62-routefix.bak')
