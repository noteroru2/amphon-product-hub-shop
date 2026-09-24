import type { APIRoute } from 'astro'
import { buildGoogleMerchantFeed } from '../lib/google-merchant-feed'
import { getAllStoreProducts, getStoreSettings } from '../lib/store-api'

export const GET: APIRoute = async () => {
  try {
    const [products, settings] = await Promise.all([
      getAllStoreProducts(),
      getStoreSettings(),
    ])
    const body = buildGoogleMerchantFeed(products, settings)
    return new Response(body, {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=300, stale-while-revalidate=900',
        'x-robots-tag': 'noindex',
      },
    })
  } catch (error) {
    console.error('SHOP_MERCHANT_FEED', error)
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>AMPHON TRADING - Google Merchant Feed</title></channel></rss>',
      {
        status: 503,
        headers: {
          'content-type': 'application/xml; charset=utf-8',
          'cache-control': 'no-store',
          'x-robots-tag': 'noindex',
        },
      },
    )
  }
}
