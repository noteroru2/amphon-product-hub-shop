# AI Buyer Cost Learning V1 (manual review; NO automatic pricing)

## Purpose
Turn imported read-only historical inventory and sales data into **evidence cohorts** in the Hub AI Buyer Owner/Admin console. Provide a path to explicitly save a **disabled, owner-reviewed candidate** into an existing PriceBook V2.8 Draft. Never activate V2.7, publish any price or send a LINE offer.

## Matching and quality
- Match sales to inventory **exactly by inventory_code**, not by item name, and calculate one sale-price statistic per distinct inventory code. Five sale events from the same code count as **one physical reference**, not five independent bought products.
- Exclude FORFEIT from PURCHASE cohorts, exclude FIELD and any FIELD DRAFT from price cohorts; show counters for excluded data.
- Exclude uncategorized inventory from price cohorts, but show the missing-category count.
- Strict model cohort grouping: normalized category + normalized **full** product name. Deliberately do not merge RAM/SSD/GPU differences. No language-model approximate matching or price invention.
- Each cohort shows independent purchase units, independent sold inventory codes, sale events, median historical buy cost, median realized sale price, median sale-minus-buy spread, and holding days.
- Fail-closed **suggested** opening/target/hard-max numbers only if at least 3 distinct purchased-and-sold products in one exact cohort, positive actual recorded profit for every sold reference, positive sale-minus-buy spread, and a sale in the past 180 days. Even then, figures are illustrative and require current market verification.
- On sparse actual datasets (currently 532 inventory, 111 sale, 3 field; no model group with multiple independent purchased-and-sold items), show evidence **without numerical proposals**. Do not fabricate sample confidence.

## Owner-controlled write path
Only an active Owner/Admin with access to the AI Buyer menu and Supabase RLS can read the history. UI displays references and blank manual price fields for low sample-size cohorts; owner must fill the numbers, confirm market/spec/condition/cost review, select an existing DRAFT and explicitly confirm the save. The existing audited `ai_buyer_pb28_save_entry` RPC then creates a **disabled** draft row `active:false` with sample codes and evidence count in `note`. The UI refuses to overwrite an existing exact draft identity; the owner can edit it from PriceBook V2.8 Admin.

Historical cost staging, source `ai_buyer_price_book_*` ACTIVE V2.7, and LINE approval mode are unchanged. This is not an ML training pipeline, autonomous pricing decision, or continuous sync service.

## Tests
`node --test scripts/verify-ai-buyer-cost-learning.test.mjs` covers:
1. Multiple sale events same stock code count once.
2. Three independent sold items required to produce a guarded estimate.
3. FORFEIT and unconfirmed FIELD DRAFT excluded.
4. Missing categories and unmatched sales flagged.
5. Stale history and loss-making actual outcomes block suggestions.
6. Different spec variants remain distinct.
7. Model normalization and category normalization.

### Next release gates
- Improve inventory raw-name and category mapping using human-reviewed structured specs.
- Acquire more independent sales per exact variant, and verify real costs including refurb/return costs.
- Add versioned calibration/replay before use in live pricing. Keep owner approval and separately audit LINE end-to-end.
