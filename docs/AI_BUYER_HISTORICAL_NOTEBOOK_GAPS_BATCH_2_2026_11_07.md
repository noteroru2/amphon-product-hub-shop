# Notebook historical price gaps — Owner review batch 2 (November 7, 2026)

This is **not an activation**. Owner asked to prioritize the 28 previously observed CPU/GPU groups with historical purchases but no staged price match. The system has 11 pending gap proposals from batch 1. This second batch covers eight further gaming CPU/GPU combinations; MacBook is excluded entirely.

Source is actual `public.ai_buyer_cost_history` inventory rows with both `buy_cost` and `actual_sale`, joined by inventory code, not ad/listing prices. Evidence validated against original inventory rows. Quote ranges were conservatively proposed by the assistant based on sample sale-vs-acquisition spread. Because most groups have one historical sale, evidence quality is LOW; all must remain `PENDING` for Owner approval and require exact physical model, GPU laptop version, RAM, SSD, warranty, defects, keyboards, age and local sell-through checks.

Saved Supabase `public.ai_buyer_notebook_gap_rule_batches` id `52e59063-d97f-423f-9451-721ce6320c9b` with 8 proposals, linked to inactive V2.8 DRAFT `f087aa6b-06e6-4e00-8d16-c83226032009`.

| CPU | GPU | Opening offer proposal (THB) | Actual evidence (inventory: buy -> sold) |
|---|---|---|---|
| i7 Gen 13 | RTX 5050 | 16,500–18,000 | INV-2026-0115: 19,000 -> 24,900 |
| i7 Gen 12 | RTX 4050 | 14,000–16,000 | INV-2026-0006: 16,650 -> 25,500 |
| i7 Gen 13 | RTX 4050 | 13,000–15,000 | INV-2026-0396: 12,000 -> 24,000 (Korean keyboard; atypically cheap buy) |
| Ryzen 7 7000 | RTX 4050 | 15,000–17,000 | INV-2026-0102: 18,150 -> 22,500 |
| Ryzen 7 7000 | RTX 4060 | 17,000–19,000 | INV-2026-0096: 20,650 -> 24,800 |
| Ryzen 9 8000 | RTX 4060 | 17,500–19,500 | INV-2026-0289: 20,000 -> 28,200 |
| Ryzen 7 7000 | RTX 2050 | 8,000–9,500 | INV-2026-0018: 10,500 -> 15,900 (historical label '7000s' not full CPU; model check required) |
| Ryzen 5 5000 | GTX 1650 | 4,500–5,500 | INV-2026-0012: 6,650 -> 10,500; INV-2026-0303: 4,650 -> 11,500 |

The previous `PENDING` historical gap batch `a9b7b5a7-4a9c-43c8-857d-e535b7279f44` (11 proposed prices) must continue to display. Prior UI implementation applied ONLY the latest gap batch, unintentionally hiding prior exact matches; the matcher now searches ALL eligible batches and returns null when overlapping/contradictory duplicates exist, without overriding any Owner-approved main gaming/office/business rule. The UI counts all 19 staged gap proposals rather than latest 8.

**Remaining groups:** Excluding MacBook and uncertain hardware, the previous uploaded Coverage exposed around 28 observed unpriced non-MacBook/non-review groups; batch 2 addresses eight specifically verified matches. Do not claim the remaining count fell by exactly eight until a new live Coverage recomputation is run, since the taxonomy and parser can change bucket assignment and evidence overlap. Prioritize further groups by actual sale count, consistent margins, reliable CPU/GPU and inventory sample size. No auto-generated numeric prices for uncertain RTX3050 VRAM or stale/missing historical information.

No change to Active V2.7, LINE AUTO or Customer-facing Price Engine.
