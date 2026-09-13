import type { APIRoute } from 'astro'
import { SITE_URL } from '../lib/seo'

export const GET: APIRoute = () => {
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    '# Faceted/search parameters are UX-only. SEO landing pages use clean paths.',
    'Disallow: /*?*brand=',
    'Disallow: /*?*cpu=',
    'Disallow: /*?*gpu=',
    'Disallow: /*?*ram=',
    'Disallow: /*?*storage=',
    'Disallow: /*?*price=',
    'Disallow: /*?*condition=',
    'Disallow: /*?*sort=',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n')
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
