import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFile(resolve(root, path), 'utf8')

const [
  pricing,
  listing,
  assistant,
  app,
  content,
  sales,
  assistedMigration,
  fixedPriceMigration,
  channels,
  shopeeRuntime,
] = await Promise.all([
  read('src/lib/shopeePricing.ts'),
  read('src/lib/shopeeManualListing.ts'),
  read('src/components/ShopeeListingAssistant.tsx'),
  read('src/App.tsx'),
  read('src/lib/contentTemplates.ts'),
  read('src/lib/sales.ts'),
  read('supabase/migrations/20260919204500_shopee_assisted_listing.sql'),
  read('supabase/migrations/20260919211500_shopee_fixed_18_pricing.sql'),
  read('src/lib/channels.ts'),
  read('workers/r2-upload/src/shopee.ts'),
])

const checks = [
  ['Shopee markup is fixed at 18 percent', pricing.includes('SHOPEE_MANUAL_MARKUP_PERCENT = 18') && !pricing.includes('[18, 19, 20]') && !pricing.includes('normalizeShopeeMarkup')],
  ['Shopee price never rounds below the 18 percent buffer', pricing.includes('base * 1.18') && pricing.includes('Math.ceil') && pricing.includes('/ 10) * 10')],
  ['Assistant shows fixed 18 percent pricing without selector', assistant.includes('ราคาปกติหน้า Hub') && assistant.includes('ราคาโพสต์ Shopee') && assistant.includes('+18%') && !assistant.includes('SHOPEE_MANUAL_MARKUP_OPTIONS')],
  ['Content Template splits Shopee title price and body', app.includes('shopee-content-part') && app.includes('หัวข้อ') && app.includes('เนื้อหาหลัก') && app.includes('shopeeParts.price')],
  ['Shopee content builder exposes separate title price body and all fields', content.includes('export interface ShopeeContentParts') && content.includes('title: string') && content.includes('price: string') && content.includes('body: string') && content.includes('buildShopeeContentParts')],
  ['Assistant exposes Seller SKU and stock guidance', assistant.includes('Seller SKU') && assistant.includes('สต๊อก') && listing.includes("source.status === 'ready_to_list' || source.status === 'published' ? 1 : 0")],
  ['Manual projection excludes private ProductDraft fields', listing.includes("Pick<") && listing.includes("'category' | 'specs' | 'status' | 'images' | 'conditionPercent'") && !listing.includes('draft.cost') && !listing.includes('draft.serialNumber') && !listing.includes('draft.notes')],
  ['Shopee description keeps title and price separate from body', listing.includes('buildShopeeManualDescription(pkg: SalesPostPackage)') && !listing.includes("'ราคาใน Shopee '")],
  ['Sales Toolkit launches Shopee assistant', app.includes('ShopeeListingAssistant') && app.includes('ผู้ช่วยลง Shopee') && app.includes('setShopeeAssistantOpen(true)')],
  ['Content template and ZIP include Shopee', content.includes("id: 'shopee'") && content.includes("channel === 'shopee'") && sales.includes('content-shopee.txt')],
  ['Channel registry enables assisted Shopee but keeps direct auto publish off', assistedMigration.includes("adapter_mode = 'assisted'") && assistedMigration.includes('auto_publish = false') && assistedMigration.includes('auto_publish_enabled = false')],
  ['Latest channel config persists fixed 18 percent only', fixedPriceMigration.includes("'manual_markup_percent', 18") && fixedPriceMigration.includes("'manual_markup_min_percent', 18") && fixedPriceMigration.includes("'manual_markup_max_percent', 18")],
  ['Source channel contract exposes fixed 18 percent assisted mode', channels.includes("key: 'shopee'") && channels.includes("mode: 'assisted'") && channels.includes('fixed +18%')],
  ['Legacy direct API remains disabled by default', shopeeRuntime.includes("env.CHANNEL_SHOPEE_MODE || 'disabled'") && assistedMigration.includes('auto_publish_enabled = false')],
  ['Seller Centre fallback is Thailand seller domain', listing.includes('https://seller.shopee.co.th/') && listing.includes('seller.shopee.co.th')],
]

const failed = checks.filter((entry) => !entry[1])
for (const entry of checks) console.log((entry[1] ? 'PASS' : 'FAIL') + ' - ' + entry[0])
if (failed.length) {
  console.error('SHOPEE ASSISTED LISTING verification failed: ' + failed.map((entry) => entry[0]).join(', '))
  process.exit(1)
}
console.log('SHOPEE ASSISTED LISTING verification PASS — fixed +18% pricing, split Content Template, privacy boundary and direct-API fail-closed policy are source-locked')
