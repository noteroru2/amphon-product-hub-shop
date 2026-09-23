import type { APIRoute } from 'astro'
import { catalogCategories } from '../config/catalog'
import { categoryIsEffectivelyIndexable, categoryStockStateFromProducts } from '../config/category-governance'
import { getAllStoreProducts } from '../lib/store-api'
import { absoluteUrl } from '../lib/seo'
import { xmlEscape, xmlResponse } from '../lib/xml'

export const GET: APIRoute = async () => {
  try {
    const products = await getAllStoreProducts()
    const effectiveCategories = catalogCategories.filter((category) =>
      categoryIsEffectivelyIndexable(category, categoryStockStateFromProducts(category.slug, products)),
    )
    const urls = [absoluteUrl('/'), ...effectiveCategories.map((category) => absoluteUrl(`/${category.slug}/`))]
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join('\n')}\n</urlset>\n`
    return xmlResponse(body)
  } catch (error) {
    console.error('SHOP_CATEGORY_SITEMAP_GOVERNANCE', error)
    return new Response('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' + xmlEscape(absoluteUrl('/')) + '</loc></url></urlset>\n', {
      status: 503,
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}
