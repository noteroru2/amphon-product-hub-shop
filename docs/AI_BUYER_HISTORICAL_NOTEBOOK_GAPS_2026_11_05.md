# AMPHON Historical Notebook Price Gaps V1 — Nov 5, 2026

Owner's goal: prioritize exact CPU/GPU groups with historical PURCHASE evidence but no staged opening price. Do not populate every zero-sample taxonomy group.

Findings:
- 270 notebook inventory rows and 97 historically observed coverage buckets (based on last saved snapshot; recompute on page load).
- 10 Gaming rules in APPROVED_DRAFT, 43 Office rules in PENDING, 14 Business rules in PENDING, with no live Worker use.
- Historical gaps arise from GTX1650 with i5 Gen9, RTX3060 with i5 Gen11 or Ryzen5 5000, RTX3050Ti in i5/i7 generations, Business i3 Gen11 or Ryzen5 5000, and low-end Pentium N6000/N5030.
- RTX3050_UNSPEC has missing VRAM and must not be priced as 4GB or 6GB until a hardware verification.
- MacBook Apple M1/M2 CPU-only group cannot distinguish Air/Pro, year, display, RAM, SSD and battery; use model-specific active PriceBook or individual review, not a blanket quote.
- Some historic 'actual_sale' data is anomalous, e.g. INV-2026-0024 88,200 for an old GTX1050 notebook; exclude outliers in future model price setting.

Batch ID `a9b7b5a7-4a9c-43c8-857d-e535b7279f44` holds 11 proposals in status PENDING, linked to V2.8 DRAFT, with individual inventory evidence keys and reviewed buy/sale context. Owner has **not** approved these numbers. 7 gaming, 2 Business, 2 Entry/General. Evidence count in individual rows is exact inventory evidence count; one-item cohorts are marked HIGH.

The Hub adds Owner's Historical Pricing Gaps review section in Chat Price Control, with separate owner-only review RPC and audit. Coverage displays stage and suggested price only when CPU/GPU/category are an exact match and there is no pre-existing owner price. Neither active V2.7/V2.8 price rows, LINE AUTO, nor AI Buyer live pricing is changed.

For N6000/N5030, the aggregated Coverage uses Entry / Celeron / Pentium rather than a specific chip. These proposals remain visible for Owner review but **must not** be applied to a generic Entry bucket. Instead verify exact CPU. Similar safety handling applies to uncertain Ryzen-series architecture, missing VRAM and unknown CPU.

Marketplace example references checked for context only, not used as verified transaction prices:
- https://www.shopbkk.com/product/14650/asus-tuf-gaming-f15-fx506hm-hn008t-eclipse-gray-2 (retail listing i5-11400H RTX3060 19,900 THB)
- https://pkjgroup.net/ (retail listing i5-11400H RTX3050Ti 18,900 THB)
