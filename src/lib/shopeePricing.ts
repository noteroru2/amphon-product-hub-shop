export const SHOPEE_MANUAL_MARKUP_PERCENT = 18 as const

export function shopeeManualPrice(basePrice: number) {
  const base = Number(basePrice || 0)
  if (!(base > 0)) return 0
  // AMPHON Shopee policy: fixed +18%, rounded up to the next 10 THB.
  return Math.ceil((base * 1.18) / 10) * 10
}

export function shopeeMarkupAmount(basePrice: number) {
  return Math.max(0, shopeeManualPrice(basePrice) - Number(basePrice || 0))
}
