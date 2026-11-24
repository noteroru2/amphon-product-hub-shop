import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculateRealizedGrossProfit } from '../src/lib/tradeEvidenceEconomics.ts'

const purchase = (x={}) => ({
  transaction_amount:10000, repair_cost:300, shipping_cost:200,
  platform_fee:0,other_direct_cost:0,quantity:1,...x,
})
const sale=(x={})=>({
  transaction_amount:14000,repair_cost:0,shipping_cost:0,platform_fee:0,
  other_direct_cost:0,quantity:1,...x,
})
test('realized profit deducts real purchase+sale direct costs, not fixed overhead',()=>{
  assert.equal(calculateRealizedGrossProfit(purchase(),sale()),3500)
  assert.equal(calculateRealizedGrossProfit(purchase({other_direct_cost:100}),sale({shipping_cost:80,platform_fee:420,other_direct_cost:30})),2870)
})
test('negative profit is not hidden as zero',()=>{
  assert.equal(calculateRealizedGrossProfit(purchase(),sale({transaction_amount:7500})), -3000)
})
test('no profit from unmatched quantities, incomplete receipts or NaN',()=>{
  assert.equal(calculateRealizedGrossProfit(purchase(),sale({quantity:2})),null)
  assert.equal(calculateRealizedGrossProfit(purchase({transaction_amount:null}),sale()),null)
  assert.equal(calculateRealizedGrossProfit(purchase(),sale({transaction_amount:NaN})),null)
  assert.equal(calculateRealizedGrossProfit(purchase({repair_cost:-1}),sale()),null)
})
test('fractional amounts are calculated in satang',()=>{
  assert.equal(calculateRealizedGrossProfit(
    purchase({transaction_amount:100.10,repair_cost:0.10,shipping_cost:0.20}),
    sale({transaction_amount:120.20,platform_fee:0.30})),19.50)
})
test('financial data cannot leak to public editorial AI/Facebook export',()=>{
  const source=readFileSync(new URL('../src/lib/tradeEvidence.ts',import.meta.url),'utf8')
  const ai=source.split('export function approvedEvidenceForAi')[1]
  assert.ok(ai)
  for(const forbidden of ['acquisition_amount:', 'transaction_amount:', 'repair_cost:', 'shipping_cost:',
    'platform_fee:', 'other_direct_cost:', 'verification_reference:', 'channel_evidence_ref:'])
    assert.equal(ai.includes(forbidden),false,'Must not export '+forbidden)
})
test('migration requires owner approval, private image, distinct verification and invoker-secured view',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261124110000_trade_evidence_real_deal_economics.sql',import.meta.url),'utf8')
  for(const term of ["current_user_role()) <> 'owner'","trade_evidence_images","transaction_verified",
    "trade_evidence_economics_v","security_invoker=true","revoke all on public.trade_evidence_economics_v from public,anon,authenticated",
    'p.quantity=s.quantity','seo_attribution_proven','trade_evidence_kind_deal_code_unique_idx'])
    assert.ok(sql.includes(term),'Missing private DB guard: '+term)
})
