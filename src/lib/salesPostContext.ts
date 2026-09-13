import { canonicalShopUrl, getCommerceProduct } from './commerce'
import type { SalesPostContext } from './salesPostPackage'
import type { ProductDraft } from '../types/product'

function fulfillmentText(settings: any) {
  const parts: string[] = []
  if (settings?.shipping?.enabled) {
    const details = ['จัดส่งในประเทศไทย']
    if (Number.isFinite(Number(settings.shipping.rate))) details.push(`ค่าจัดส่ง ${new Intl.NumberFormat('th-TH').format(Number(settings.shipping.rate))} บาท`)
    if (settings.shipping.transitMinDays !== null && settings.shipping.transitMaxDays !== null) details.push(`ระยะขนส่งประมาณ ${settings.shipping.transitMinDays}–${settings.shipping.transitMaxDays} วัน`)
    parts.push(details.join(' · '))
  }
  if (settings?.checkout?.pickupEnabled) parts.push('รับสินค้าที่ร้านได้')
  return parts.join(' / ')
}

export async function loadSalesPostContext(draft: ProductDraft, signal: AbortSignal): Promise<SalesPostContext> {
  const apiBase = (import.meta.env.VITE_R2_UPLOAD_API as string | undefined)?.trim().replace(/\/$/, '')
  const commercePromise = draft.remoteProductId ? getCommerceProduct(draft.remoteProductId).catch(() => null) : Promise.resolve(null)
  const settingsPromise = apiBase
    ? fetch(`${apiBase}/store/settings`, { signal, headers: { accept: 'application/json' } }).then(async (response) => response.ok ? (await response.json()).settings : null).catch(() => null)
    : Promise.resolve(null)
  const productPromise = apiBase && draft.sku
    ? fetch(`${apiBase}/store/products/${encodeURIComponent(draft.sku)}`, { signal, headers: { accept: 'application/json' } }).then(async (response) => response.ok ? (await response.json()).product : null).catch(() => null)
    : Promise.resolve(null)
  const [commerce, settings, publicProduct] = await Promise.all([commercePromise, settingsPromise, productPromise])
  const publishedToShop = Boolean(publicProduct?.status === 'published')
  const siteUrl = String(settings?.siteUrl || import.meta.env.VITE_SALES_SITE_URL || '').replace(/\/$/, '')
  const publicCanonical = publishedToShop && siteUrl && publicProduct?.listingSlug
    ? `${siteUrl}/p/${publicProduct.listingSlug}-${encodeURIComponent(String(draft.sku).toLowerCase())}/`
    : ''
  return {
    canonicalShopUrl: publishedToShop ? canonicalShopUrl(commerce) || publicCanonical : undefined,
    defaultWarrantyDays: Number(settings?.warranty?.defaultDays || 0),
    fulfillmentText: fulfillmentText(settings),
    listingWarrantyDays: commerce?.storeWarrantyDays,
    listingWarrantyTerms: commerce?.storeWarrantyTerms,
    publishedToShop,
    storeName: String(settings?.merchantName || '').trim() || undefined,
  }
}
