/**
 * Privacy-minimized hook for an already configured GA4/GTM dataLayer. No customer identity,
 * contact text or personal details are sent. When GA4 is not configured this
 * only emits a local browser event for future integrations.
 */
type CommerceName = 'view_item' | 'select_item' | 'add_to_cart' | 'begin_checkout' | 'line_click' | 'purchase'
type CommercePayload = {
  item_id?: string
  item_name?: string
  item_category?: string
  price?: number
  currency?: 'THB'
  value?: number
  source?: string
  item_list_name?: string
  transaction_id?: string
  shipping?: number
  items?: Array<{ item_id: string; item_name: string; price: number; quantity: number }>
}
export function trackShopEvent(event: CommerceName, payload: CommercePayload = {}) {
  if (typeof window === 'undefined') return
  const normalized = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
  const detail = { event, ...normalized }
  const state = window as Window & { dataLayer?: Record<string, unknown>[] }
  if (Array.isArray(state.dataLayer)) {
    if (event === 'line_click') state.dataLayer.push(detail)
    else {
      const { event: _event, source: _source, ...fields } = detail
      const data = 'items' in fields ? fields : {
        ...fields,
        ...(fields.item_id ? { items: [{ item_id: fields.item_id, item_name: fields.item_name || '', price: fields.price || 0, quantity: 1 }] } : {}),
      }
      state.dataLayer.push({ event, ecommerce: data })
    }
  }
  window.dispatchEvent(new CustomEvent('amphon-shop-conversion', { detail }))
}
