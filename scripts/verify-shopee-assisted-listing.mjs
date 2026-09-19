import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFile(resolve(root, path), 'utf8')

const [pricing, listing, assistant, app, content, sales, migration, channels, shopeeRuntime] = await Promise.all([
  read('src/lib/shopeePricing.ts'),
  read('src/lib/shopeeManualListing.ts'),
  read('src/components/ShopeeListingAssistant.tsx'),
  read('src/App.tsx'),
  read('src/lib/contentTemplates.ts'),
  read('src/lib/sales.ts'),
  read('supabase/migrations/20260919204500_shopee_assisted_listing.sql'),
  read('src/lib/channels.ts'),
  read('workers/r2-upload/src/shopee.ts'),
])

const checks = [
  ['Markup options are exactly 18/19/20 with 20 default', pricing.includes('[18, 19, 20]') && pricing.includes('DEFAULT_SHOPEE_MANUAL_MARKUP_PERCENT') && pricing.includes('= 20')],
  ['Shopee price never rounds below buffer', pricing.includes('Math.ceil') && pricing.includes('/ 10) * 10')],
  ['Assistant shows Hub price, Shopee price and markup selector', assistant.includes('ราคาปกติหน้า Hub') && assistant.includes('ราคาโพสต์ Shopee') && assistant.includes('SHOPEE_MANUAL_MARKUP_OPTIONS')],
  ['Assistant exposes Seller SKU and stock guidance', assistant.includes('Seller SKU') && assistant.includes('สต๊อก') && listing.includes("source.status === 'ready_to_list' || source.status === 'published' ? 1 : 0")],
  ['Manual projection excludes private ProductDraft fields', listing.includes("Pick<") && listing.includes("'category' | 'specs' | 'status' | 'images' | 'conditionPercent'") && !listing.includes("draft.cost") && !listing.includes("draft.serialNumber") && !listing.includes("draft.notes")],
  ['Shopee description avoids external Shop URL/contact projection', listing.includes('buildShopeeManualDescription') && !listing.includes('canonicalShopUrl') && !listing.includes('LINE')],
  ['Sales Toolkit launches Shopee assistant', app.includes('ShopeeListingAssistant') && app.includes('ผู้ช่วยลง Shopee') && app.includes('setShopeeAssistantOpen(true)')],
  ['Content template and ZIP include Shopee', content.includes("id: 'shopee'") && content.includes("channel === 'shopee'") && sales.includes("content-shopee.txt")],
  ['Channel registry enables assisted Shopee but keeps auto publish off', migration.includes("adapter_mode = 'assisted'") && migration.includes('enabled = true') && migration.includes('auto_publish = false') && migration.includes("'manual_markup_percent', 20")],
  ['Source channel contract exposes Shopee assisted mode', channels.includes("key: 'shopee'") && channels.includes("mode: 'assisted'") && channels.includes('+18–20%')],
  ['Legacy direct API remains disabled by default', shopeeRuntime.includes("env.CHANNEL_SHOPEE_MODE || 'disabled'") && migration.includes('auto_publish_enabled = false')],
  ['Seller Centre fallback is Thailand seller domain', listing.includes("https://seller.shopee.co.th/") && listing.includes("seller.shopee.co.th")],
]

const failed = checks.filter((entry) => !entry[1])
for (const entry of checks) console.log((entry[1] ? 'PASS' : 'FAIL') + ' - ' + entry[0])
if (failed.length) {
  console.error('SHOPEE ASSISTED LISTING verification failed: ' + failed.map((entry) => entry[0]).join(', '))
  process.exit(1)
}
console.log('SHOPEE ASSISTED LISTING verification PASS — staff package, +18–20% pricing, privacy boundary and direct-API fail-closed policy are source-locked')
