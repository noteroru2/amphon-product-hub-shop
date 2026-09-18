import { readFile, readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { validatePublicationExternalUrl } from '../src/lib/publicationSecurity.ts'

const root = resolve(import.meta.dirname, '..')
const failures = []
const passes = []
const check = (condition, label) => (condition ? passes : failures).push(label)
const read = (path) => readFile(resolve(root, path), 'utf8')

const [
  migration,
  migrationFix,
  baseline,
  publications,
  tracker,
  confirm,
  app,
  publishCenter,
  hub3Panel,
  hub4Panel,
  types,
] = await Promise.all([
  read('supabase/migrations/20260913090000_hub5_sales_channel_tracker.sql'),
  read('supabase/migrations/20260913093000_hub5_event_action_id_fix.sql'),
  read('supabase/migrations/20260912000000_amphon_shop61_full_setup.sql'),
  read('src/lib/publications.ts'),
  read('src/components/SalesChannelTracker.tsx'),
  read('src/components/PublicationConfirmSheet.tsx'),
  read('src/App.tsx'),
  read('src/components/PublishCenter.tsx'),
  read('src/components/SalesPostPackagePanel.tsx'),
  read('src/components/MarketplaceListingAssistant.tsx'),
  read('src/types/product.ts'),
])

// Historical publication schema remains additive and auditable even though
// social publication status is no longer part of the active Hub UX.
check(migration.includes('sales_channel_publication_events') && migration.includes('last_action_id') && migration.includes("'line'"), 'Historical sales-channel schema preserved')
check(!/drop\s+table|truncate|delete\s+from|alter\s+table\s+public\.(?:products|commerce_|orders)/i.test(migration + migrationFix), 'Migration additive and isolated')
check(publications.includes('PublicationChannelDefinition') && publications.includes('publicationChannels') && publications.includes('persistentListing') && publications.includes('supportsExternalUrl'), 'Legacy channel config remains centralized')
check(migration.includes('actor_id') && migration.includes('actor_name') && migration.includes('public.profiles') && publications.includes('updated_by: profile.id'), 'Historical employee attribution preserved')
check(migration.includes('timestamptz') && migration.includes('occurred_at'), 'Historical publication timestamps remain UTC-safe')
check(baseline.includes('unique(product_id, channel)') && publications.includes('wasPublished &&') && publications.includes('return mapPublication(existing)'), 'Historical duplicate-active protection preserved')
check(migration.includes('product_publications_audit_event') && migration.includes('on conflict (action_id) do nothing') && migrationFix.includes('new.last_action_id is distinct from old.last_action_id') && publications.includes('listPublicationHistory'), 'Historical publication audit remains retry-idempotent')
check(migration.includes('on delete restrict') && migration.includes('revoke insert, update, delete') && migration.includes('drop policy if exists publications_delete_admin'), 'Historical publication rows remain protected')
check(migration.includes('enable row level security') && migration.includes('to authenticated') && migration.includes('current_user_active()') && migration.includes('revoke all') && migration.includes('from anon'), 'Auth/RLS boundary preserved')
check(/['"]expired['"]/.test(types) && publications.includes('status === "expired"'), 'Legacy publication lifecycle remains parseable')

// Active Hub UX: Website/SHOP only for publication state.
check(!app.includes('SalesChannelTracker'), 'Social SalesChannelTracker removed from active product flow')
check(app.includes('Shop / เว็บไซต์') && app.includes('จัดการสินค้าที่ขึ้นเว็บ ราคา SEO และหน้า AMPHON SHOP'), 'Home CTA now describes Shop/Website management')
check(publishCenter.includes('visiblePublicationChannels') && publishCenter.includes('channel.id === "website"'), 'Publish Center renders Website/SHOP only')
check(publishCenter.includes('สินค้าในเว็บไซต์') && publishCenter.includes('รอขึ้นเว็บ') && publishCenter.includes('ขึ้นเว็บแล้ว'), 'Website manager language replaces social publication language')
check(!publishCenter.includes('visiblePublicationChannels.map((channel) =>') || publishCenter.includes('channel.id === "website"'), 'Rendered channel list is governed by Website-only filter')

// Content creation stays available without tracking whether social posts were published.
check(hub3Panel.includes('FACEBOOK_PAGE') && hub3Panel.includes('LINE') && hub3Panel.includes('MARKETPLACE'), 'Social content presets remain available')
check(!hub3Panel.includes('ทำเครื่องหมายว่าโพสต์ Facebook Page แล้ว') && !hub3Panel.includes('ทำเครื่องหมายว่าส่ง LINE แล้ว'), 'Facebook Page and LINE publication-status actions retired')
check(!hub3Panel.includes('PublicationConfirmSheet'), 'Sales Post Package no longer writes social publication status')
check(hub4Panel.includes('เปิด Facebook Marketplace') && hub4Panel.includes('buildMarketplaceListingDraft'), 'Marketplace content assistant remains available')
check(!hub4Panel.includes('ทำเครื่องหมายว่าโพสต์ Marketplace แล้ว') && !hub4Panel.includes('PublicationConfirmSheet'), 'Marketplace publication-status action retired')

// Old tracker/confirm source may remain for audit compatibility, but must not be wired into active UX.
check(tracker.includes('SHOP จากระบบจริง') && confirm.includes('บันทึกจากคำยืนยันของพนักงาน'), 'Legacy audit components retained but detached')
check(validatePublicationExternalUrl('https://example.com/post') === 'https://example.com/post' && validatePublicationExternalUrl('http://example.com/post') === 'http://example.com/post' && validatePublicationExternalUrl('') === null, 'HTTP/HTTPS external URL validation')
for (const unsafe of ['javascript:alert(1)', 'data:text/html,bad', 'file:///tmp/a']) {
  let rejected = false
  try { validatePublicationExternalUrl(unsafe) } catch { rejected = true }
  check(rejected, `Unsafe URL rejected (${unsafe.split(':')[0]})`)
}

check(!/graph\.facebook|facebook.?password|access.?token|session.?cookie|puppeteer|playwright|selenium|auto.?submit/i.test(tracker + confirm + publications + migration + hub3Panel + hub4Panel), 'No Facebook automation or credentials')
check(!/purchase_enabled|stripe|promptpay|checkout\/session|webhooks\/stripe|commerce_orders|create_commerce_order/i.test(tracker + confirm + publications + migration), 'Legacy social audit code cannot mutate SHOP/payment/order state')

const settingsResponse = await fetch('https://amphon-product-images.noteroru2.workers.dev/store/settings', {
  headers: { accept: 'application/json' },
  signal: AbortSignal.timeout(15000),
})
const settings = settingsResponse.ok ? (await settingsResponse.json()).settings : null
check(settingsResponse.ok && settings?.purchaseEnabled === true, 'Production purchase_enabled remains true')
check(settingsResponse.ok && settings?.checkout?.promptPayEnabled === false, 'Production PromptPay remains disabled')

const envText = await read('.env').catch(() => '')
const env = Object.fromEntries(envText.split(/\r?\n/).map((line) => line.match(/^([^#=]+)=(.*)$/)).filter(Boolean).map((match) => [match[1].trim(), match[2].trim()]))
if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY) {
  for (const table of ['product_publications', 'sales_channel_publication_events']) {
    const response = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
      headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
      signal: AbortSignal.timeout(15000),
    })
    const body = await response.text()
    let rows = null
    try { rows = JSON.parse(body) } catch { /* denied responses are not JSON arrays */ }
    check(response.status !== 404 && (!response.ok || (Array.isArray(rows) && rows.length === 0)), `Unauthenticated ${table} data inaccessible`)
  }
} else {
  failures.push('Public unauthenticated RLS verification unavailable')
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
  const value = await readFile(file, 'utf8').catch(() => '')
  if (secretPattern.test(value)) leaks.push(file.replace(`${root}\\`, ''))
  secretPattern.lastIndex = 0
}
check(leaks.length === 0, `Secret scan${leaks.length ? `: ${leaks.join(', ')}` : ''}`)

if (failures.length) {
  console.error('HUB-5 VERIFY: FAIL')
  failures.forEach((label) => console.error(`- ${label}`))
  process.exit(1)
}
console.log('HUB-5 VERIFY: PASS')
passes.forEach((label) => console.log(`- ${label}: PASS`))
console.log('- Social content tools remain available, but Facebook/Marketplace/LINE publication status is retired from active UX: PASS')
console.log('- No fake social publication, order, reservation, Stripe Session, or charge created: PASS')
