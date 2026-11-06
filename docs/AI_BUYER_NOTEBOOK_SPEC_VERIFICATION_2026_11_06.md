# RTX3050 / MacBook Specification Verification in Notebook Coverage

### Motivation
The previous Coverage view grouped all MacBook Apple M1-M5 together (mixing Air and Pro, screen size, RAM and SSD), and RTX3050 without explicit VRAM was indistinguishable from RTX3050 4GB or 6GB in the underlying legacy names. The right answer is **data-quality verification** instead of inventing missing specs or adding overlapping prices.

### Changes
- Parse explicit RTX3050 4GB/6GB VRAM only when it immediately follows GPU token (not RAM/SSD 16/512), and preserve UNKNOWN.
- For MacBook, group historical rows by chip/year, Air/Pro/Neo, actual screen size, RAM, SSD. Unknown values explicitly marked UNKNOWN; no guess from Apple chip.
- Dedicated prioritized Notebook Spec Verification queue on Coverage with actual inventory ID, original name and missing fields. In-stock units are shown first.
- Owner verifies physical information, enters revised complete descriptive name and evidence note (GPU-Z, About This Mac, System Information) and confirms. Persist using existing `ai_buyer_cost_spec_review_save` RPC; audit history and source snapshots remain in existing review tables. Original inventory and accounting entries are not mutated.
- Coverage now uses `applyCostSpecReviews` before classification; stale owner-review snapshots automatically stop applying. Price engine remains unchanged. No MacBook broad price because exact model, screen and memory matter.
- Existing Approval state, V2.7 Active and LINE AUTO untouched.

### Data validation
As of Nov 6, 2026 several inventory names still say `RTX3050/16/512`, where 16 is RAM, not VRAM; others contain verified `RTX3050 6GB/16/512` or `RTX3050 4GB/8/512`. MacBook Air M2 15-inch and M3 15-inch must not mix with 13-inch; Pro M1 Pro must not mix with MacBook Air M1.

No existing hardware facts are overwritten automatically. All missing values require verification.

### Verification
`node --test scripts/verify-ai-buyer-notebook-spec-verification.test.mjs` + Hub TypeScript and build in CI.
