import type { StoreAvailability, StoreProduct } from './store-api'

/**
 * Fail closed when status and availability disagree. The stock source is AMPHON
 * System; a stale or partial feed must never make a sold unit purchasable.
 */
export function publicAvailability(product: StoreProduct): StoreAvailability {
  if (product.availability === 'out_of_stock') return 'out_of_stock'
  if (product.status !== 'published' && product.status !== 'reserved') return 'out_of_stock'
  if (product.availability === 'reserved' || product.status === 'reserved') return 'reserved'
  if (
    product.status === 'published' &&
    product.availability === 'available' &&
    Number.isFinite(product.price) &&
    product.price > 0
  ) return 'available'
  return 'out_of_stock'
}

export function normalizeStoreProduct(product: StoreProduct): StoreProduct {
  return { ...product, availability: publicAvailability(product) }
}
