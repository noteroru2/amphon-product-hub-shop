import { readFile, readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const passes = []
const check = (condition, label) => (condition ? passes : failures).push(label)
const read = (path) => readFile(resolve(root, path), 'utf8')

const [component, hook, utility, sales, app, publishCenter] = await Promise.all([
  read('src/components/ProductImageExportActions.tsx'),
  read('src/hooks/useProductImageExport.ts'),
  read('src/lib/productImageExport.ts'),
  read('src/lib/sales.ts'),
  read('src/App.tsx'),
  read('src/components/PublishCenter.tsx'),
])

check(component.includes('บันทึกรูปทั้งหมด (${imageExport.count})') && component.includes('data-hub2-primary'), 'Hub bulk-image button exists')
check(component.includes('imageExport.count') && component.includes('กำลังเตรียมรูป ${imageExport.progress.completed}/${imageExport.progress.total}'), 'Product image count and progress displayed')
check(utility.includes('image.publicUrl') && utility.includes("credentials: 'omit'") && utility.includes("accept: 'image/*'"), 'Original/high-quality publicUrl source used')
check(hook.includes('useEffect') && hook.includes('prepareProductImageFiles') && component.includes('imageExport.status !== \'ready\''), 'Files prepared before share click')
check(utility.includes("typeof navigator.canShare === 'function'") && utility.includes('navigator.canShare({ files })'), 'navigator.canShare files guard')
check(utility.includes('return navigator.share({ files })') && !utility.includes('navigator.share({ files, title') && !utility.includes('navigator.share({ files, text'), 'navigator.share files-only implementation')
check(utility.includes("`${sku}-${String(index + 1).padStart(2, '0')}.${extension}`"), 'Stable SKU filenames')
check(utility.includes('.sort((a, b) => a.order - b.order)') && utility.includes('for (let index = 0; index < images.length; index += 1)'), 'Image order preserved')
check(utility.includes("error.name === 'AbortError'") && component.includes('imageExport.isCancellation(error)'), 'User-cancel handling')
check(component.includes('ดาวน์โหลดรูปทั้งหมดเป็น ZIP') && component.includes('downloadProductZip'), 'ZIP fallback available')
check(component.includes('ดาวน์โหลดทีละรูป') && component.includes('downloadSingleProductImage'), 'Individual download fallback retained')
check(hook.includes('controller.abort()') && utility.includes('MAX_NATIVE_SHARE_BYTES') && utility.includes('MAX_SINGLE_IMAGE_BYTES'), 'Memory/stale-preparation safeguards')
check(utility.includes('for (let attempt = 0; attempt < 2; attempt += 1)') && component.includes('imageExport.retry()'), 'Bounded automatic retry and manual retry')
check(/<ProductImageExportControls[\s\S]*?draft=\{draft\}[\s\S]*?imageExport=\{imageExport\}/.test(app) && app.includes('useProductImageExport(draft)') && /<ProductImageExportActions[\s\S]*?draft=\{draft\}[\s\S]*?compact/.test(publishCenter), 'Reusable export component integrated')
check(![component, hook, utility, sales, app, publishCenter].some((text) => /purchase_enabled|stripe_promptpay|webhooks\/stripe|\/store\/checkout/.test(text)), 'No SHOP mutation in HUB-2 implementation')

const settingsResponse = await fetch('https://amphon-product-images.noteroru2.workers.dev/store/settings', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
const settings = settingsResponse.ok ? (await settingsResponse.json()).settings : null
check(settingsResponse.ok && settings?.purchaseEnabled === true, 'Production purchase_enabled remains true')
check(settings?.checkout?.promptPayEnabled === false, 'Production PromptPay remains disabled')

const catalogResponse = await fetch('https://amphon-product-images.noteroru2.workers.dev/store/products?availability=all&limit=1', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
const catalog = catalogResponse.ok ? await catalogResponse.json() : { products: [] }
const imageUrl = catalog.products?.[0]?.images?.[0]?.url
if (imageUrl) {
  const imageResponse = await fetch(imageUrl, { headers: { origin: 'https://hub.amphon.co.th', accept: 'image/*' }, signal: AbortSignal.timeout(15000) })
  const allowOrigin = imageResponse.headers.get('access-control-allow-origin')
  check(imageResponse.ok && String(imageResponse.headers.get('content-type')).startsWith('image/'), 'Production image fetch returns original image response')
  check(allowOrigin === '*' || allowOrigin === 'https://hub.amphon.co.th', 'Production image CORS permits Hub origin')
} else {
  failures.push('Production image CORS check: no public product image available')
}

async function filesUnder(directory, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.wrangler', '.git'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await filesUnder(path, output)
    else if (['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.sql', '.ps1', '.bat', '.toml'].includes(extname(entry.name))) output.push(path)
  }
  return output
}
const secretPattern = /(?:sk_(?:live|test)_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9]{12,}|sb_secret_[A-Za-z0-9._-]{12,})/g
const leaks = []
for (const file of await filesUnder(root)) {
  const text = await readFile(file, 'utf8').catch(() => '')
  if (secretPattern.test(text)) leaks.push(file.replace(`${root}\\`, ''))
  secretPattern.lastIndex = 0
}
check(leaks.length === 0, `Secret scan${leaks.length ? `: ${leaks.join(', ')}` : ''}`)

if (failures.length) {
  console.error('HUB-2 VERIFY: FAIL')
  failures.forEach((label) => console.error(`- ${label}`))
  process.exit(1)
}
console.log('HUB-2 VERIFY: PASS')
passes.forEach((label) => console.log(`- ${label}: PASS`))
console.log('- Native iOS/Android share-sheet integration: OWNER_DEVICE_VERIFICATION_REQUIRED')
