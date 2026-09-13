# SHOP-SEO-4 — SEO Architecture & Commercial Content Audit

Date: 2026-09-13
Site: https://shop.amphon.co.th

## Verdict

Architecture: PASS WITH OBSERVATION GATE

The Shop now has a clear URL ownership model and build-time protection against accidental cannibalization. No new SEO landing pages were activated in this batch.

## Current index surface

- Homepage: 1 strategic broad-intent page.
- Strategic category pages: 8 INDEX pages.
- Product pages: 2 current INDEX listings.
- Evergreen Brand / Series / Model pages: 0 effective INDEX pages.
- Secondary category pages: 7 HOLD pages.
- Account, cart, checkout, order, document and warranty flows remain non-search landing pages.

Production public listing snapshot at audit time:

- total public listings: 2
- INDEX listings: 2
- listings without images: 0
- listings without SEO title: 0
- listings without SEO description: 0
- listings without category mapping: 0
- listings without brand mapping: 0
- listings without series mapping: 2
- listings without model mapping: 2

Missing Series / Model mapping does not block the SKU product pages. It deliberately prevents premature Series / Model SEO expansion.

## Keyword → URL ownership

| Intent | Canonical owner | Status |
| --- | --- | --- |
| สินค้าไอทีมือสองออนไลน์ | `/` | KEEP |
| โน้ตบุ๊กมือสอง | `/notebooks/` | KEEP + IMPROVE |
| คอมพิวเตอร์มือสอง | `/desktop-pcs/` | KEEP + IMPROVE |
| iPhone มือสอง | `/iphones/` | KEEP + IMPROVE |
| มือถือมือสอง / Android มือสอง | `/smartphones/` | KEEP + IMPROVE |
| iPad มือสอง / Tablet มือสอง | `/tablets/` | KEEP + IMPROVE |
| จอคอมมือสอง | `/monitors/` | KEEP + IMPROVE |
| กล้องมือสอง | `/cameras/` | KEEP + IMPROVE |
| เครื่องเกมมือสอง | `/gaming-consoles/` | KEEP + IMPROVE |
| MacBook มือสอง | `/macbooks/` | WAIT / HOLD |
| คอมเกมมิ่งมือสอง | `/gaming-pcs/` | WAIT / HOLD |
| เลนส์กล้องมือสอง | `/camera-lenses/` | WAIT / HOLD |
| การ์ดจอมือสอง | `/graphics-cards/` | WAIT / HOLD |
| อุปกรณ์คอมมือสอง | `/pc-components/` | WAIT / HOLD |
| อุปกรณ์ไอทีมือสอง | `/accessories/` | WAIT / HOLD |
| สินค้าไอทีมือสองอื่น ๆ | `/other-it/` | WAIT / HOLD |
| Brand / Series / Model | clean taxonomy path under the owning category | WAIT until SEO-ready |
| individual used item | `/p/{listing-slug}-{sku}/` | INDEX only when listing policy permits |

## Cannibalization findings

### Fixed: source-category overlap

Top-level category pages previously loaded products from legacy source fields (`source_category`, subtype and free-text query). This made future overlap possible. The clearest example was `graphics-cards` and `pc-components`, which both used the same source category `component`.

Category pages now load products by canonical commerce taxonomy `categorySlug`. One listing therefore belongs to the category URL selected in Product Hub rather than appearing in several top-level SEO owners because of a broad source value.

### Safe by governance

- `/notebooks/` vs `/macbooks/`: MacBook remains HOLD.
- `/desktop-pcs/` vs `/gaming-pcs/`: Gaming PC remains HOLD.
- `/cameras/` vs `/camera-lenses/`: Lens remains HOLD.
- `/graphics-cards/` vs `/pc-components/`: both remain HOLD until taxonomy coverage and inventory support separate intent.
- Brand / Series / Model pages cannot enter the evergreen sitemap unless `effectiveIndexPolicy=INDEX`.

## Thin / no-stock page finding

At audit time only `notebooks` and `tablets` have current public inventory. Six strategic INDEX categories can therefore render with no current product cards.

Decision: do not oscillate index/noindex based only on temporary used-stock availability. Instead, keep strategic category ownership stable and add unique commercial buying content to all eight strategic categories. Each page now contains category-specific buying guidance and contextual links to related strategic categories.

This keeps the URL useful when stock temporarily reaches zero while avoiding generic placeholder copy.

## Structured data

Strategic category pages now emit:

- `CollectionPage`
- `ItemList` when products are currently present
- `BreadcrumbList`

Product pages continue to own Product merchant structured data and breadcrumb data. Evergreen pages retain CollectionPage / ItemList / BreadcrumbList behavior when they eventually pass the index gate.

## Sitemap policy

- `sitemap-categories.xml`: homepage + strategic INDEX categories only.
- `sitemap-products.xml`: excludes `NOINDEX`, `HOLD`, and `RETIRED` listing policies.
- `sitemap-evergreen.xml`: includes only `effectiveIndexPolicy=INDEX`.
- `sitemap.xml`: sitemap index for the three governed sitemaps.

No account, checkout, cart, order status, receipt/document or warranty URL is intentionally included in SEO sitemaps.

## Production taxonomy cleanup

The audit found an orphaned acceptance-test brand `SHOP62` in production taxonomy. It had:

- 0 listing references
- 0 aliases
- 0 series
- 0 models

It was safely retired (`RETIRED`, inactive) rather than physically deleted. It no longer appears in the evergreen page view.

## GSC baseline

The connected Search Console domain property for `amphon.co.th` returned no Query × Page rows for pages on `shop.amphon.co.th` over the latest 28-day window at audit time.

Interpretation: the Shop is too new for ranking-based winner/loser decisions. Do not create more SEO landing pages based on assumptions yet.

Observation gate: wait for Search Console impressions before promoting HOLD categories or Brand / Series / Model pages.

## Promotion rules for HOLD pages

A HOLD category or evergreen page should not become INDEX merely because the route exists. Promote only when the page has a clear unique search intent and enough evidence to be useful. Recommended minimum checks:

1. canonical taxonomy ownership is unambiguous;
2. page has unique Title, H1, description and customer-facing copy;
3. page has current inventory or meaningful historical/product evidence;
4. internal links exist from the parent taxonomy page;
5. it does not duplicate the product set and keyword target of an existing owner;
6. GSC data, inventory trend, or business priority justifies opening the page.

## Product lifecycle policy to watch

Used-item product URLs can remain useful after sale because they contain real photos, condition and specifications, but the site must not accumulate unlimited low-value sold pages. A later lifecycle batch should define when sold SKU pages remain INDEX, become NOINDEX, or consolidate to a Model / Series owner once those evergreen pages are mature.

Do not implement large-scale redirects until enough Model / Series pages have passed the SEO-ready gate and GSC provides evidence.

## Build gates

`npm run build` now includes:

- `verify:content-hygiene`
- `verify:shop87b`
- `verify:shop87c`
- `verify:shopseo4`
- `astro check`
- `astro build`

`verify:shopseo4` protects canonical category ownership, strategic vs HOLD categories, unique commercial keyword owners, structured data and sitemap/index governance.
