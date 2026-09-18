import type { APIRoute } from 'astro'
import { absoluteUrl } from '../lib/seo'
import { xmlEscape, xmlResponse } from '../lib/xml'

export const GET: APIRoute = () => {
  const sitemaps = [
    absoluteUrl('/sitemap-static.xml'),
    absoluteUrl('/sitemap-categories.xml'),
    absoluteUrl('/sitemap-evergreen.xml'),
    absoluteUrl('/sitemap-products.xml'),
  ]
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemaps.map((url) => `  <sitemap><loc>${xmlEscape(url)}</loc></sitemap>`).join('\n')}\n</sitemapindex>\n`
  return xmlResponse(body)
}
