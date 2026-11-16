/**
 * Privacy-minimized hook for an already configured GA4/GTM dataLayer. No customer identity,
 * contact text or personal details are sent. When GA4 is not configured this
 * only emits a local browser event for future integrations.
 */
type CommerceName = 'view_item' | 'select_item' | 'add_to_cart' | 'begin_checkout' | 'line_click'
type CommercePayload = {
  item_id?: string
  item_name?: string
  item_category?: string
  price?: number
  currency?: 'THB'
  value?: number
  source?: string
  item_list_name?: string
}
export function trackShopEvent(event: CommerceName, payload: CommercePayload = {}) {
  if (typeof window === 'undefined') return
  const normalized = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
  const detail = { event, ...normalized }
  const state = window as Window & { dataLayer?: Record<string, unknown>[] }
  if (Array.isArray(state.dataLayer)) state.dataLayer.push(detail)
  window.dispatchEvent(new CustomEvent('amphon-shop-conversion', { detail }))
}
