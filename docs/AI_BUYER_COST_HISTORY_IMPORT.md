# AI Buyer — AMPHON System historical cost import (staging only)

## Data sources
Use the three CSV exports generated read-only from the AMPHON System backend on Hetzner:
- `inventory_cost_history.csv` (one row per InventoryItem; historical unit buy cost)
- `sales_learning_history.csv` (one row per sale-learning event; do not count again as additional purchase)
- `field_purchase_history.csv` (field purchase; DRAFT is **not** an actual completed acquisition)

In the Product Hub AI Buyer Owner/Admin page, expand **AMPHON System → AI Buyer: นำเข้าประวัติทุน**, upload **one file at a time**, inspect the preview and confirm. The importer splits each file into atomic 100-row batches, upserts by `(source_kind, source_key)`, and records an immutable per-row audit with before/after. Rerunning files does not create duplicate source records.

## Security
`ai_buyer_cost_history`, `ai_buyer_cost_import_batches`, and `ai_buyer_cost_import_audit` are isolated staging tables with RLS Owner/Admin read, no direct browser DML. The `ai_buyer_cost_history_import` RPC verifies `auth.uid()` and owner/admin in `profiles`, and normalizes an allowlist of fields **on the server**. It never stores phone numbers, IDs, serial numbers, seller names or addresses from any extra CSV columns. Authentication uses the logged-in Supabase Hub session. The SQL lives in `supabase/ai_buyer_cost_history_import.sql`; apply it only to environments that are authorized to receive financial history.

## Do not treat a cost as an authorized buying offer
Historical purchase costs are not current market valuations. These staging tables are **not queried by the existing LINE Buyer Worker**. No active `ai_buyer_price_book_*` rows, auto-mode settings or LINE tokens are modified.

For learning:
1. Match sale learning `inventoryCode` to inventory `code`, not by row count or ID. Do not double-count purchase costs.
2. Separate FORFEIT from PURCHASE and exclude unfinished field DRAFT.
3. Normalize product model/spec and sale date, inspect misclassification/missing categories.
4. Assess actual cost vs verified sale and holding days, then generate **review-only** PriceBook V2.8 proposals.
5. Any integration with real-time LINE requires separate approval and testing.

## 2026-11-03 uploaded export preflight
- Inventory rows: 532 (512 PURCHASE, 20 FORFEIT); 159 blank categories
- Sale-learning rows: 111 from 102 distinct inventory items, all 111 events map to inventory IDs in the upload; some items have multiple sales
- Field-purchase rows: 3 (2 STOCKED, 1 DRAFT)
- Staging is initially empty and stays empty until the owner performs an import from Hub.
