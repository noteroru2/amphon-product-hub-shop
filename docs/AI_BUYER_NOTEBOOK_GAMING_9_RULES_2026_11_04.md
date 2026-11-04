# AMPHON Gaming Notebook Owner Opening-Offer Policy — 2026-11-04

Owner explicitly specified 9 gaming notebook groups to use as **starting negotiation offers** (THB); DO NOT confuse these with verified retail prices, owner maximum bids, approved autonomous pricing, or active LINE quotes.

| GPU | CPU qualifier | Starting offer THB | Caution |
|--|--|--:|--|
| GTX1050 / 1050 Ti | i5 Gen7–9 | 6,000 | high versus multiple historical purchases |
| GTX1650 | i5 Gen10, RAM8/16, SSD512 | 7,000–8,000 | same scope as previously approved DRAFT rule |
| GTX1650 Ti | i5 Gen10–11 | 8,500 | device condition and model critical |
| RTX2050 | i5 Gen11–12 or Ryzen5 | 10,000 | 1 comparable historic purchase |
| RTX3050 4GB | i5 Gen11–13 or Ryzen5 | 11,000–12,000 | do not mix with 3050 Ti/6GB |
| RTX3050 6GB | i5 Gen12–13 or Ryzen5 | 13,000–14,000 | lower-priced resale stock may compress margin |
| RTX4050 | i5 Gen12–14 or Ryzen5/7 | 17,000–18,000 | depends on brand, generation and repairs |
| RTX4060 | i5/i7 Gen12–14 or Ryzen5/7 | 20,000–21,000 | verify thin-model resale and condition |
| RTX5050 / RTX5060 | new Intel Core or Ryzen | 22,000–24,000 | must separate 5050 and 5060 for active quoting |

## Historical checks
Input: `public.ai_buyer_cost_history` 532 inventory +111 sale +3 field. Rough filtered historical PURCHASE examples (GPU name pattern, exclude common desktop names; still imperfect):

- GTX1050 ~11 matches, median ~5,000 THB; GTX1050 Ti ~4, median ~4,000, includes possible accessory false positives. Offers 6,000 on all old devices may be too high.
- GTX1650 ~17, median ~6,500; GTX1650 Ti ~5, median ~7,650.
- RTX2050 ~1, buy cost 10,500.
- RTX3050 4GB ~1, buy cost 9,200; RTX3050 6GB ~6, median ~12,150. RTX3050 without VRAM stated contains Ti, non-GPU 3050U, and GPU component false positives; do not pool blindly.
- RTX4050 ~7 median ~18,200, RTX4060 ~4 median ~18,800 (includes GPU-only false positives).
- RTX5050 ~2 matched notebook buys at 17,000 and 19,000; RTX5060 results were GPU components, NOT notebook comparables.

These are historical acquisition cost snapshots, not independent completed-sale estimates. Several records lack category and independent sold devices are sparse. Do not infer an accurate current retail from them.

External references checked 2026-11-04:
- AMPHON own shop listing ASUS TUF i5 Gen10 GTX1650 8/512 THB12,500, MSI GF63 i5 Gen11 RTX3050 4GB THB14,900, Acer Nitro Lite i5 Gen13 RTX3050 6GB THB19,900.
- Thai third-party used laptop listings for RTX4050 and RTX4060 around THB26,900–32,900 on some variants. These are listing prices, not confirmed sold prices.
- Retail prices are time-sensitive, and listing quality varies.

## Safe release
Staged exactly 9 items in `public.ai_buyer_notebook_rule_batches`, ID `b5f7280c-9ae2-417b-9ed1-fb35bf8672ca`, status `PENDING`, bound to the existing V2.8 Draft. Owner-only Hub UI now shows all 9 with risk labels, original owner's numbers, and approve/dismiss buttons. Approval sets `APPROVED_DRAFT` with immutable audit and does NOT write to `ai_buyer_pb28_entries`, `ai_buyer_price_book_entries`, LINE, or customer-facing AI Buyer Worker.

Existing previously approved single GTX1650 DRAFT rule is left unchanged. This new 9-group policy is separate.

Before future Worker use: require explicit spec parser recognition, exact GPU VRAM and Ti distinction, range/CPU generation matching, verified charger, clean ownership, no water damage or malfunction, remaining warranty, resale evidence and gross-to-net profit floor, owner-approved release and rollback tests.
