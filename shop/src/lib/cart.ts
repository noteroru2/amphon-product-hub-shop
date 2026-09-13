export const CART_STORAGE_KEY = 'amphon_shop_cart_v1'
export const CART_EVENT = 'amphon-cart-change'

export function readCartSkus(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return Array.from(new Set(parsed.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))).slice(0, 10)
  } catch {
    return []
  }
}

export function writeCartSkus(skus: string[]) {
  if (typeof localStorage === 'undefined') return
  const normalized = Array.from(new Set(skus.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))).slice(0, 10)
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(normalized))
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: { count: normalized.length } }))
}

export function addCartSku(sku: string) {
  const current = readCartSkus()
  const normalized = String(sku || '').trim().toUpperCase()
  if (!normalized) return current
  writeCartSkus([...current, normalized])
  return readCartSkus()
}

export function removeCartSku(sku: string) {
  const normalized = String(sku || '').trim().toUpperCase()
  writeCartSkus(readCartSkus().filter((item) => item !== normalized))
  return readCartSkus()
}

export function clearCart() {
  writeCartSkus([])
}
