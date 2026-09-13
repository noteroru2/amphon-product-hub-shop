import type { APIRoute } from 'astro'
import { indexCategories } from '../config/catalog'
import { absoluteUrl } from '../lib/seo'
import { xmlEscape, xmlResponse } from '../lib/xml'

export const GET: APIRoute = () => {
  const urls = [absoluteUrl('/'), ...indexCategories.map((category) => absoluteUrl(`/${category.slug}/`))]
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join('\n')}\n</urlset>\n`
  return xmlResponse(body)
}
