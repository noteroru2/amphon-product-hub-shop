export const SHOPEE_MANUAL_MARKUP_OPTIONS = [18, 19, 20] as const
export type ShopeeManualMarkupPercent = (typeof SHOPEE_MANUAL_MARKUP_OPTIONS)[number]
export const DEFAULT_SHOPEE_MANUAL_MARKUP_PERCENT: ShopeeManualMarkupPercent = 20

export function normalizeShopeeMarkup(value: number): ShopeeManualMarkupPercent {
  if (value <= 18) return 18
  if (value >= 20) return 20
  return 19
}

export function shopeeManualPrice(
  basePrice: number,
  markupPercent: number = DEFAULT_SHOPEE_MANUAL_MARKUP_PERCENT,
) {
  const base = Number(basePrice || 0)
  if (!(base > 0)) return 0
  const markup = normalizeShopeeMarkup(Number(markupPercent || 0))
  // Keep staff entry simple and never round below the requested buffer.
  return Math.ceil((base * (100 + markup)) / 100 / 10) * 10
}

export function shopeeMarkupAmount(
  basePrice: number,
  markupPercent: number = DEFAULT_SHOPEE_MANUAL_MARKUP_PERCENT,
) {
  return Math.max(0, shopeeManualPrice(basePrice, markupPercent) - Number(basePrice || 0))
}
