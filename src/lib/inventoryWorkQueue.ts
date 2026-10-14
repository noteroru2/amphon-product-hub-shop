import type { ProductSummary } from '../types/product'

/** A single returned Hub inventory row already represents one intake group. */
export function needsListingWork(product: Pick<ProductSummary, 'status'>): boolean {
  return product.status === 'draft' || product.status === 'photo_ready'
}

export function sortPendingListingWork<T extends Pick<ProductSummary, 'createdAt' | 'updatedAt'>>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const first = Date.parse(a.createdAt || a.updatedAt)
    const second = Date.parse(b.createdAt || b.updatedAt)
    const aTime = Number.isFinite(first) ? first : Number.MAX_SAFE_INTEGER
    const bTime = Number.isFinite(second) ? second : Number.MAX_SAFE_INTEGER
    return aTime - bTime
  })
}
