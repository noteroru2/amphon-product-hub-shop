# AI Buyer Office Notebook Price Rules — 5 Nov 2026

Owner pasted and explicitly confirmed 43 category rows (42 numeric opening ranges plus 1 Intel Core Ultra Series 2+ per-model review). This is an OPENING NEGOTIATION RANGE, not a target, price ceiling, forecast, or worker quote.

Staged row in `public.ai_buyer_office_notebook_rule_batches`: `6d3bc4ac-0e19-4325-a29d-4e1a1543c5ff`, status PENDING, bound to existing V2.8 Draft. All numeric ranges have been preserved from the owner's message unchanged. The batch stores 6 Intel i3, 8 Intel i5, 8 Intel i7, 5 Ryzen 3, 6 Ryzen 5, 5 Ryzen 7, and 5 new Intel Core/Core Ultra rows.

## Scope and exceptions
Only Windows general office laptops with integrated graphics, around RAM 8GB and SSD 256–512GB, verified working condition with charger, standard panel, normal battery.

Do NOT match without checking:
- Gaming dGPU (GeForce/Radeon discrete), gaming-class chassis; preserve separately approved gaming rules.
- Business, Premium or Workstation variants (ThinkPad, Latitude, EliteBook, OLED, touch, premium ultrabooks), MacBook.
- Damage, battery issues, liquid damage, locked firmware, missing charger or warranty/repair uncertainty.
- CPU exact architecture and U/H/HX class. Ryzen 7000 and 8000 may contain materially different architectures; don't conflate same-series CPUs. Intel Core 3/5 (non-Ultra) and Core Ultra are not the same class.
- An unknown CPU or a match across multiple rows triggers Owner review. Core Ultra Series 2+ is explicitly PER_MODEL with NULL prices; never convert to 0.
- RAM/storage upgrades affect resale but do NOT automatically raise opening price without Owner-defined adjustment policy.

## Safety
Hub Owner-only read RLS on batch and audit tables. Owner-only authenticated RPC explicitly confirms all 43 rows and writes APPROVED_DRAFT status and append audit in one transaction. It does NOT update existing PriceBook V2.7/V2.8 entry rows, LINE Worker, or public quotes. SQL approval then repeat refusal tested in ROLLBACK transaction; actual batch stays PENDING pending Owner's Hub confirmation.
