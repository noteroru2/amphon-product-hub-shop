import type { APIRoute } from 'astro'
import { getAllStoreProducts } from '../lib/store-api'
import { absoluteUrl, productPath } from '../lib/seo'
import { xmlEscape } from '../lib/xml'

function condition(value?: string | null) {
  const normalized = String(value || 'USED').toUpperCase()
  if (normalized === 'NEW') return 'new'
  if (normalized === 'REFURBISHED') return 'refurbished'
  return 'used'
}

export const GET: APIRoute = async () => {
  try {
    const products = (await getAllStoreProducts()).filter((product) =>
      product.availability === 'available' &&
      product.indexPolicy === 'INDEX' &&
      product.merchantEnabled &&
      product.price > 0 &&
      product.images.some((image) => Boolean(image.url)),
    )
    const items = products.map((product) => {
      const cover = [...product.images].sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.sortOrder - b.sortOrder)[0]
      const brand = product.catalogBrand?.name || product.brand || ''
      const identifiers = [
        product.gtin ? `<g:gtin>${xmlEscape(product.gtin)}</g:gtin>` : '',
        product.mpn ? `<g:mpn>${xmlEscape(product.mpn)}</g:mpn>` : '',
        !product.gtin && !product.mpn ? '<g:identifier_exists>false</g:identifier_exists>' : '',
      ].join('')
      return `<item><g:id>${xmlEscape(product.sku)}</g:id><title>${xmlEscape(product.title)}</title><description>${xmlEscape(`${product.title} สินค้าไอทีมือสอง พร้อมรูปและข้อมูลสินค้าจริง`)}</description><link>${xmlEscape(absoluteUrl(productPath(product)))}</link><g:image_link>${xmlEscape(cover.url)}</g:image_link><g:availability>in_stock</g:availability><g:price>${Number(product.price).toFixed(2)} THB</g:price><g:condition>${condition(product.merchantItemCondition)}</g:condition>${brand ? `<g:brand>${xmlEscape(brand)}</g:brand>` : ''}${identifiers}</item>`
    }).join('\n')
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>AMPHON SHOP</title><link>${xmlEscape(absoluteUrl('/'))}</link><description>สินค้าไอทีมือสองพร้อมขายจาก AMPHON TRADING</description>${items}</channel></rss>\n`
    return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=900' } })
  } catch (error) {
    console.error('SHOP_MERCHANT_FEED', error)
    return new Response('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>AMPHON SHOP</title></channel></rss>', { status: 503, headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' } })
  }
}
