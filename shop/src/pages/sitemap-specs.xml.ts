import type { APIRoute } from 'astro'
import { getAllIndexSpecPages } from '../lib/store-api'
import { absoluteUrl } from '../lib/seo'
import { xmlEscape, xmlResponse } from '../lib/xml'

export const GET: APIRoute = async () => {
  try {
    const pages = await getAllIndexSpecPages()
    const rows: Array<{ path: string; updatedAt?: string | null }> = []
    if (pages.length >= 3) rows.push({ path: '/specs/' })

    const dimensionCounts = new Map<string, number>()
    for (const page of pages) dimensionCounts.set(page.dimension, (dimensionCounts.get(page.dimension) || 0) + 1)
    for (const [dimension, count] of dimensionCounts) {
      if (count >= 2) rows.push({ path: `/specs/${dimension.toLowerCase()}/` })
    }
    for (const page of pages) rows.push({ path: page.canonicalPath, updatedAt: page.updatedAt })

    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.map(({ path, updatedAt }) => {
      const lastmod = updatedAt ? `<lastmod>${xmlEscape(new Date(updatedAt).toISOString())}</lastmod>` : ''
      return `  <url><loc>${xmlEscape(absoluteUrl(path))}</loc>${lastmod}</url>`
    }).join('\n')}\n</urlset>\n`
    return xmlResponse(body)
  } catch (error) {
    console.error('SHOP_SPEC_SITEMAP', error)
    return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', {
      status: 503,
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}
