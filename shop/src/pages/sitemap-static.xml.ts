import type { APIRoute } from 'astro'
import { absoluteUrl } from '../lib/seo'
import { xmlEscape, xmlResponse } from '../lib/xml'

export const GET: APIRoute = () => {
  const paths = ['/', '/new-arrivals/', '/about/', '/how-to-buy/', '/shipping/', '/warranty/', '/returns/']
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((path) => `  <url><loc>${xmlEscape(absoluteUrl(path))}</loc></url>`).join('\n')}\n</urlset>\n`
  return xmlResponse(body)
}
