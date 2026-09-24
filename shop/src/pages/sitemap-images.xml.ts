import type { APIRoute } from 'astro'
import { getAllStoreProducts } from '../lib/store-api'
import { absoluteUrl, productPath } from '../lib/seo'
import { productImageSeoText } from '../lib/product-trust'
import { xmlEscape, xmlResponse } from '../lib/xml'

export const GET: APIRoute = async () => {
  try {
    const products = (await getAllStoreProducts())
      .filter((product) => !['NOINDEX','HOLD','RETIRED'].includes(product.indexPolicy || 'INDEX'))
      .filter((product) => product.images.length > 0)

    const rows = products.map((product) => {
      const images = [...product.images]
        .sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.sortOrder - b.sortOrder)
        .slice(0, 10)

      const imageXml = images.map((image, index) => {
        const seo = productImageSeoText(product, image, index)
        return `<image:image><image:loc>${xmlEscape(image.url)}</image:loc><image:title>${xmlEscape(seo.title)}</image:title><image:caption>${xmlEscape(seo.caption)}</image:caption></image:image>`
      }).join('')

      return `  <url><loc>${xmlEscape(absoluteUrl(productPath(product)))}</loc>${imageXml}</url>`
    })

    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${rows.join('\n')}\n</urlset>\n`
    return xmlResponse(body)
  } catch (error) {
    console.error('SHOP_IMAGE_SITEMAP', error)
    return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"></urlset>', {
      status: 503,
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}
