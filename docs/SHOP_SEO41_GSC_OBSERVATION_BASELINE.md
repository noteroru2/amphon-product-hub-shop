# SHOP-SEO-4.1 — GSC Observation Baseline

Date: 2026-09-13
Site: https://shop.amphon.co.th
Search Console property: `sc-domain:amphon.co.th`

## Verdict

BASELINE CAPTURED — OBSERVATION ACTIVE

Do not expand SEO landing pages during the observation window unless a critical technical defect is discovered. This phase exists to separate real Google Search behavior from assumptions made immediately after launch and architecture cleanup.

## GSC connector health

The connected Search Console source is working. For the full `amphon.co.th` domain property over the latest 28-day window it returned:

- clicks: 1,171
- impressions: 21,572
- CTR: 5.43%
- average position: 8.33

This control check matters because the Shop-specific result is currently empty.

## Shop Search Analytics baseline

For pages containing `shop.amphon.co.th` over the same latest 28-day window:

- Page rows: 0
- Query × Page rows: 0

Interpretation: **no Search Analytics rows are available for the Shop yet**. This must not be interpreted as “Google indexed zero URLs.” Search Analytics visibility and indexing are different signals.

Google's Search Console documentation notes that a newly created site or a site newly added to Search Console can take up to about a week to generate initial data. Therefore Day 7 is the first meaningful observation checkpoint, not the launch day.

## Sitemap observation

The Search Console sitemap data for `sc-domain:amphon.co.th` currently contains the existing corporate sitemap:

- `https://amphon.co.th/sitemap-index.xml`

No sitemap row for the Shop was returned by the connected Search Console source at baseline time.

### Owner action required

Submit this sitemap in Google Search Console:

`https://shop.amphon.co.th/sitemap.xml`

Use the existing `sc-domain:amphon.co.th` property. The Shop already exposes live robots/sitemap endpoints; this action makes the Shop sitemap explicitly visible in Search Console for observation.

Do not submit child sitemaps separately unless troubleshooting later. The Shop sitemap index owns:

- `/sitemap-categories.xml`
- `/sitemap-evergreen.xml`
- `/sitemap-products.xml`

## Index-eligible surface at baseline

- Homepage: 1
- Strategic category pages: 8
- Product pages: 2
- Evergreen Brand / Series / Model pages: 0
- Total intended SEO surface: **11 URLs**

### Strategic category owners

1. `/notebooks/` — โน้ตบุ๊กมือสอง
2. `/desktop-pcs/` — คอมพิวเตอร์มือสอง
3. `/iphones/` — iPhone มือสอง
4. `/smartphones/` — มือถือมือสอง / Android มือสอง
5. `/tablets/` — iPad / Tablet มือสอง
6. `/monitors/` — จอคอมมือสอง
7. `/cameras/` — กล้องมือสอง
8. `/gaming-consoles/` — เครื่องเกมมือสอง

### Current INDEX product URLs

- `/p/apple-macbook-neo-at-pc-2609-000002/`
- `/p/apple-ipad-gen11-at-tb-2609-000003/`

### HOLD surface

These remain intentionally out of the strategic index surface during observation:

- `/macbooks/`
- `/gaming-pcs/`
- `/camera-lenses/`
- `/graphics-cards/`
- `/pc-components/`
- `/accessories/`
- `/other-it/`
- all Brand / Series / Model evergreen pages until they pass the SEO-ready gate

## Freeze contract

Until the Day 14 review, do not make ranking-sensitive changes to the observed strategic owners unless fixing a verified technical problem.

Freeze:

- canonical paths
- category keyword ownership
- INDEX/HOLD promotion policy
- strategic Title/H1 intent
- Brand / Series / Model activation

Allowed during observation:

- critical 4xx/5xx fixes
- broken canonical/schema/sitemap fixes
- checkout/member fixes unrelated to SEO copy
- accessibility or layout fixes that do not change search intent
- new products entering or leaving inventory under the existing product lifecycle rules

## Observation checkpoints

### Day 7 — 2026-09-20

Collect:

- total Shop clicks / impressions
- Page-level impressions
- Query × Page rows
- average position
- first queries associated with each strategic category
- sitemap status after submission

Decision: **observe only** unless there is a technical indexing failure or clear URL ownership conflict.

### Day 14 — 2026-09-27

Classify each strategic owner:

- `WAIT` — still insufficient evidence
- `KEEP` — query ownership is correct
- `IMPROVE` — impressions exist and on-page intent can be improved without changing URL ownership
- `CANNIBALIZATION_REVIEW` — the same query cluster is splitting across competing owners
- `INDEXING_REVIEW` — expected strategic page still has no visibility and needs coverage/sitemap inspection

Only after this review should a HOLD Category or Evergreen page be considered for promotion.

### Day 28 — 2026-10-11

Use if Day 14 data is still sparse. This is the first point where broader SEO expansion can be considered if indexing and query ownership are stable.

## Comparison metrics

For every checkpoint record:

- clicks
- impressions
- CTR
- average position
- unique queries
- unique pages with impressions
- top Query × Page pairs
- query ownership conflicts
- sitemap submitted/downloaded/errors/warnings
- current INDEX category/product/evergreen counts

## Decision rules

Do not optimize from tiny samples. A single impression or one isolated query is discovery evidence, not a ranking winner.

Prioritize a page for improvement when it develops repeated impressions around the intended query cluster, especially if it sits within striking distance of page one or has meaningful impressions but weak CTR.

Do not create a Brand / Series / Model page simply because a taxonomy entity exists. Promotion still requires unique intent, useful content, clean parent-child linking, non-duplicative product ownership, and evidence from GSC/inventory/business priority.

## Machine-readable baseline

`shop/seo-observation/shop-seo41-baseline.json`

This snapshot is intentionally immutable. Later observation rounds should create comparison snapshots rather than editing the baseline values.
