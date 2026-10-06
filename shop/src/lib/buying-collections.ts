import type { BuyingCollection } from '../config/buying-guides'
import type { StoreProduct } from './store-api'

export function matchesBuyingCollection(product: StoreProduct, collection: BuyingCollection) {
  if (!collection.categories.includes(product.categorySlug || '')) return false
  if (!Number.isFinite(product.price) || product.price <= 0) return false
  if (collection.budget !== undefined && product.price > collection.budget) return false
  if (collection.requireOfficeSpecs) {
    const ram = String(product.specs?.ram ?? '').trim()
    const ramMatch = ram.match(/^(\d+(?:\.\d+)?)\s*(?:gb|g|กิกะไบต์)?(?:\s|$)/i)
    if (!ramMatch || Number(ramMatch[1]) < 8) return false
    const ssd = String(product.specs?.ssd ?? '').trim()
    const storage = `${product.specs?.storage ?? ''} ${product.specs?.storage_type ?? ''}`
    if (!ssd || /^(?:none|no\b|ไม่มี|hdd|0\b|-)/i.test(ssd)) {
      if (!/\b(?:ssd|nvme)\b/i.test(storage)) return false
    } else if (/hdd/i.test(ssd) && !/ssd|nvme/i.test(ssd)) return false
  }
  return true
}

export function collectionStock(products: StoreProduct[], collection: BuyingCollection) {
  const history = products.filter((product) => matchesBuyingCollection(product, collection))
  const current = history.filter((product) => product.availability === 'available' && product.status === 'published')
  const sold = history.filter((product) => product.availability === 'out_of_stock')
  return { current, sold, history, indexable: history.length >= 3 }
}
