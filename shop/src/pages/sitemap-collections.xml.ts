import type { APIRoute } from 'astro'
import { buyingCollections } from '../config/buying-guides'
import { collectionStock } from '../lib/buying-collections'
import { getAllStoreProducts } from '../lib/store-api'
import { absoluteUrl } from '../lib/seo'
import { xmlEscape, xmlResponse } from '../lib/xml'

export const GET: APIRoute = async () => {
  try {
    const products = await getAllStoreProducts()
    const paths = buyingCollections.filter((collection) => collectionStock(products, collection).indexable).map((collection) => `/collections/${collection.slug}/`)
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${xmlEscape(absoluteUrl(path))}</loc></url>`).join('')}</urlset>`)
  } catch (error) {
    console.error('SHOP_COLLECTION_SITEMAP', error)
    return new Response('Sitemap temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
