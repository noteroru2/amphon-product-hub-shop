import type { APIRoute } from 'astro'
import { getAllIndexEvergreenPages } from '../lib/store-api'
import { absoluteUrl } from '../lib/seo'
import { xmlEscape, xmlResponse } from '../lib/xml'

export const GET: APIRoute = async () => {
  try {
    const pages = await getAllIndexEvergreenPages()
    const urls = pages.map((page) => ({ url: absoluteUrl(page.canonicalPath), updatedAt: page.updatedAt }))
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(({ url, updatedAt }) => `  <url><loc>${xmlEscape(url)}</loc>${updatedAt ? `<lastmod>${xmlEscape(new Date(updatedAt).toISOString())}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`
    return xmlResponse(body)
  } catch (error) {
    console.error('SHOP2_SITEMAP_EVERGREEN', error)
    return new Response('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n', { status: 503, headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' } })
  }
}
