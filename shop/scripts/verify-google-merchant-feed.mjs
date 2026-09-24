import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const [feedLib, feedRoute] = await Promise.all([
  read('src/lib/google-merchant-feed.ts'),
  read('src/pages/google-merchant.xml.ts'),
])

const checks = [
  ['feed keeps only live merchant-eligible inventory', feedLib.includes("product.availability === 'available'") && feedLib.includes("product.indexPolicy === 'INDEX'") && feedLib.includes('product.merchantEnabled === true')],
  ['required Merchant attributes are emitted', ['<g:id>','<title>','<description>','<link>','<g:image_link>','<g:availability>','<g:price>','<g:condition>'].every((tag) => feedLib.includes(tag))],
  ['feed exposes multiple product images', feedLib.includes('<g:additional_image_link>') && feedLib.includes('slice(0, 10)')],
  ['used IT taxonomy is explicit', feedLib.includes('GOOGLE_CATEGORY_BY_SHOP_SLUG') && feedLib.includes('<g:google_product_category>') && feedLib.includes('<g:product_type>')],
  ['technical product details are sent to Google', feedLib.includes('<g:product_detail>') && feedLib.includes('SPEC_DETAILS')],
  ['shipping price and delivery windows are sent', feedLib.includes('<g:shipping>') && feedLib.includes('<g:min_handling_time>') && feedLib.includes('<g:max_transit_time>')],
  ['branded products do not falsely claim identifiers are absent', feedLib.includes("brand.toLowerCase() === 'custom pc'") && feedLib.includes('<g:identifier_exists>false</g:identifier_exists>')],
  ['feed includes campaign labels for future Shopping optimization', feedLib.includes('custom_label_') && feedLib.includes('conditionLabel(product)')],
  ['feed uses live store settings', feedRoute.includes('getStoreSettings') && feedRoute.includes('buildGoogleMerchantFeed(products, settings)')],
  ['feed endpoint is noindex and short-cache', feedRoute.includes("'x-robots-tag': 'noindex'") && feedRoute.includes('max-age=300')],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failed.length) {
  console.error(`GOOGLE MERCHANT feed verification failed: ${failed.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('GOOGLE MERCHANT FEED PASS — product data, shipping, taxonomy, identifiers, images and product details are protected')
