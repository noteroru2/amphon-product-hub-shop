import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const worker = await readFile(resolve(root, 'workers/r2-upload/src/index.ts'), 'utf8')
const e2e = await readFile(resolve(root, 'deployment/SHOP62-PROVIDER-E2E.mjs'), 'utf8')
const ps1 = await readFile(resolve(root, 'deployment/SHOP62-PROVIDER-E2E.ps1'), 'utf8')
const productionWrangler = await readFile(resolve(root, 'workers/r2-upload/wrangler.jsonc'), 'utf8')
const productionConfig = JSON.parse(productionWrangler)
const source = ts.createSourceFile('index.ts', worker, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

function findFunction(name) {
  let found = null
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    if (!found) ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function findRouteIf(functionNode, method, pathname) {
  let found = null
  function visit(node) {
    if (ts.isIfStatement(node)) {
      const condition = node.expression.getText(source)
      if (condition.includes('request.method') && condition.includes(`'${method}'`) &&
          condition.includes('url.pathname') && condition.includes(`'${pathname}'`)) found = node
    }
    if (!found) ts.forEachChild(node, visit)
  }
  if (functionNode) visit(functionNode)
  return found
}

function hasReturn(node) {
  let found = false
  function visit(child) {
    if (ts.isReturnStatement(child)) found = true
    if (!found) ts.forEachChild(child, visit)
  }
  if (node) visit(node)
  return found
}

const handler = findFunction('handleShop62TestRoutes')
const modeGuard = findFunction('shop62TestModeEnabled')
const readinessIf = findRouteIf(handler, 'GET', '/__shop62/readiness')
const checkoutIf = findRouteIf(handler, 'POST', '/__shop62/checkout')
const readinessBody = readinessIf?.thenStatement.getText(source) || ''
const handlerPrefix = handler && readinessIf ? worker.slice(handler.pos, readinessIf.pos) : ''

const forbiddenReadinessCalls = [
  'createStripeCheckoutSession', 'createStripeFullRefund', 'create_commerce_test_order',
  'process_gateway_payment_event', 'record_shop62_provider_acceptance', 'serviceRest(',
]
const readinessUsesMutation = forbiddenReadinessCalls.some((name) => readinessBody.includes(name)) ||
  /method\s*:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/i.test(readinessBody)
const readinessContract = readinessBody.includes("capability: 'SHOP62_PROVIDER_E2E'") &&
  readinessBody.includes("mode: 'isolated-e2e'") && readinessBody.includes('createsOrder: false') &&
  readinessBody.includes("checkout: 'POST /__shop62/checkout'")

const probeStart = e2e.indexOf('async function verifyWorkerRouteContract()')
const probeEnd = e2e.indexOf('\nasync function workerCheckout', probeStart)
const probeBody = probeStart >= 0 && probeEnd > probeStart ? e2e.slice(probeStart, probeEnd) : ''

const checks = [
  [Boolean(modeGuard) && modeGuard.getText(source).includes("SHOP62_TEST_MODE === 'isolated-e2e'"), 'isolated Worker mode guard'],
  [Boolean(handler) && handlerPrefix.includes('shop62TestModeEnabled(env)') && handlerPrefix.includes('shop62TokenAllowed(request, env)'), 'mode + token required before test route dispatch'],
  [Boolean(readinessIf) && Boolean(checkoutIf) && readinessIf.pos < checkoutIf.pos && hasReturn(readinessIf.thenStatement) && readinessContract && !readinessUsesMutation, 'side-effect-free readiness route'],
  [probeBody.includes("const readinessPath = '/__shop62/readiness'") && probeBody.includes("workerFetch('/health'") && probeBody.includes('workerFetch(readinessPath'), 'runtime route contract probe'],
  [probeBody.includes('token: null') && probeBody.includes('wrongToken') && probeBody.includes('status !== 404'), 'negative token probes'],
  [probeBody.includes('shop62SideEffectSnapshot()') && probeBody.includes('JSON.stringify(after) !== JSON.stringify(before)'), 'runtime DB side-effect assertion'],
  [e2e.includes('method=${method} path=${pathname}') && e2e.includes('contentType=${result.contentType') && e2e.includes("replaceAll(TEST_TOKEN, '[redacted]')"), 'safe worker failure diagnostics'],
  [ps1.includes("name = $WorkerName") && ps1.includes("$WorkerName = 'amphon-shop62-e2e'") && ps1.includes("main = 'src/index.ts'"), 'isolated deploy uses canonical Worker entrypoint'],
  [ps1.includes("SHOP62_TEST_MODE = 'isolated-e2e'") && ps1.includes("ToString('x2')"), 'isolated Wrangler mode + transport-safe token'],
  [!Object.hasOwn(productionConfig.vars || {}, 'SHOP62_TEST_MODE') && !Object.hasOwn(productionConfig.vars || {}, 'SHOP62_TEST_TOKEN') && productionConfig.name === 'amphon-product-images', 'production Worker isolation'],
  [!e2e.includes('authorization: `Bearer ${SUPABASE_SECRET}`'), 'server key is not used as bearer token'],
  [!worker.includes('purchase_enabled = true') && !e2e.includes('purchase_enabled = true') && !ps1.includes('purchase_enabled = true'), 'purchase guard remains closed'],
]

const failures = []
for (const [ok, label] of checks) if (!ok) failures.push(label)
const secretLike = /(sk_(?:test|live)_[A-Za-z0-9]{12,}|sb_secret_[A-Za-z0-9_-]{12,}|whsec_[A-Za-z0-9]{12,})/
if (secretLike.test(worker + e2e + ps1)) failures.push('secret-like literal')

if (failures.length) {
  console.error('SHOP-6.2 ROUTE FIX VERIFY: FAIL')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('SHOP-6.2 ROUTE FIX VERIFY: PASS')
checks.forEach(([, label]) => console.log(`- ${label}: PASS`))
