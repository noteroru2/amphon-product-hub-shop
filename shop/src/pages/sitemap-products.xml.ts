import type { APIRoute } from 'astro'
import { getAllStoreProducts, type StoreProduct } from '../lib/store-api'
import { absoluteUrl, productPath } from '../lib/seo'
import { xmlEscape, xmlResponse } from '../lib/xml'

export const GET: APIRoute = async () => {
  let products: StoreProduct[] = []
  try {
    products = await getAllStoreProducts()
  } catch (error) {
    console.error('SHOP_PRODUCT_SITEMAP_STORE_API', error)
    return new Response('Store API unavailable', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  const rows = products
    .filter((product) => !['NOINDEX', 'HOLD', 'RETIRED'].includes(product.indexPolicy || 'INDEX'))
    .map((product) => {
      const loc = xmlEscape(absoluteUrl(productPath(product)))
      const lastmod = product.updatedAt ? `<lastmod>${xmlEscape(new Date(product.updatedAt).toISOString())}</lastmod>` : ''
      return `  <url><loc>${loc}</loc>${lastmod}</url>`
    })

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`
  return xmlResponse(body)
}
