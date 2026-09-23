import type { CatalogCategory, IndexPolicy } from './catalog'
import type { StoreProduct } from '../lib/store-api'

export interface CategoryStockState {
  currentStockCount: number
  historicalStockCount: number
}

export function categoryStockStateFromProducts(
  categorySlug: string,
  products: StoreProduct[],
): CategoryStockState {
  let currentStockCount = 0
  let historicalStockCount = 0

  for (const product of products) {
    if (product.categorySlug !== categorySlug) continue
    historicalStockCount += 1
    if (product.status === 'published' || product.status === 'reserved') currentStockCount += 1
  }

  return { currentStockCount, historicalStockCount }
}

export function effectiveCategoryIndexPolicy(
  category: CatalogCategory,
  state: CategoryStockState,
): IndexPolicy {
  if (category.indexPolicy === 'NOINDEX' || category.indexPolicy === 'RETIRED') return category.indexPolicy

  if (category.indexPolicy === 'INDEX') {
    return state.currentStockCount > 0 || state.historicalStockCount > 0 ? 'INDEX' : 'HOLD'
  }

  if (category.indexPolicy === 'HOLD' && category.autoIndexWhenStocked) {
    const currentThreshold = Math.max(1, category.minCurrentStockForIndex ?? 1)
    const historicalThreshold = Math.max(1, category.minHistoricalStockForIndex ?? currentThreshold)
    if (state.currentStockCount >= currentThreshold || state.historicalStockCount >= historicalThreshold) return 'INDEX'
  }

  return 'HOLD'
}

export function categoryIsEffectivelyIndexable(
  category: CatalogCategory,
  state: CategoryStockState,
) {
  return effectiveCategoryIndexPolicy(category, state) === 'INDEX'
}
