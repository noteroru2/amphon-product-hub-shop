// Pure accounting helper used only for admin previews/tests. Final reporting is
// computed by the database from owner-verified matching receipts, never clicks.
export interface TradeMoney {
  transaction_amount: number | null
  repair_cost: number
  shipping_cost: number
  platform_fee: number
  other_direct_cost: number
  quantity: number
}
export function calculateRealizedGrossProfit(purchase: TradeMoney, sale: TradeMoney): number | null {
  if (purchase.transaction_amount == null || sale.transaction_amount == null
    || !Number.isInteger(purchase.quantity) || purchase.quantity < 1
    || purchase.quantity !== sale.quantity) return null
  const amounts = [purchase.transaction_amount,sale.transaction_amount,
    purchase.repair_cost,purchase.shipping_cost,purchase.other_direct_cost,
    sale.shipping_cost,sale.platform_fee,sale.other_direct_cost]
  if (amounts.some(n => !Number.isFinite(n) || n < 0)) return null
  const [cost,revenue,repair,inbound,purchaseOther,outbound,fee,saleOther] = amounts
  // Work in satang to avoid JS float arithmetic mismatch on decimal prices.
  const cents = (n: number) => Math.round(n * 100)
  return (cents(revenue)-cents(cost)-cents(repair)-cents(inbound)
    -cents(purchaseOther)-cents(outbound)-cents(fee)-cents(saleOther))/100
}
