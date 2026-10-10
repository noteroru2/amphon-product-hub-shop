# SEO Control Tower: network monitoring

The existing Control Tower now opens on network monitoring. Its experiments,
measurement guards, alert receipts, rollback/recovery, learning, and Action Center
remain under the separate Experiments tab.

## Collection

- 14 allowlisted sites; Shop has its own hostname scope even when sharing the
  `sc-domain:amphon.co.th` GSC property.
- Database scheduler checks due sites every 15 minutes, using persisted
  `next_check_at = previous dispatch + 72 hours`. This avoids day-of-month cron
  expressions that do not provide consistent three-day intervals.
- GET homepage, robots.txt, and sitemap. Discover the advertised sitemap from
  robots.txt, accepting only the same allowlisted hostname or its Unicode label.
  Normalize requests to that site's HTTPS origin. Do not accept arbitrary URLs
  supplied by the browser.
- Collect responses every minute; retain status, errors, noindex, canonical,
  and sitemap/robots change hashes. Pending requests older than ten minutes are
  surfaced as errors. Changes in XML are informational, not automatic SEO edits.
- `pg_net` response retention is temporary; durable checks live in
  `commerce_seo_health_checks`.

## Search data limits

GSC source ingestion through Windsor is currently paused: its Free plan allows
one account, while the connection reports fifteen accounts. Do not import the
synthetic zero row returned with the quota error as real data.

`commerce_gsc_query_demand` currently holds two properties last imported on
2026-10-04. This release captures only the latest import cohort (within fifteen
minutes), filters exact site hostnames, and labels it `QUERY_SAMPLE`. Its sum is
not the entire property's total. Missing data is null, never an inferred zero.
Position is impression-weighted, excluding invalid zero positions. Each source
timestamp is captured once; running a monitor does not freshen old GSC data.

The dashboard labels old or missing data, shows source and capture timestamps
separately, and compares only matching query/page pairs across snapshots at least
three days apart. Comparisons are disabled when GSC is blocked or stale. It does
not claim independent SERP rankings, indexed-page counts, or Core Web Vitals.

To complete fresh search reporting, restore the existing Windsor source or add
an authorized direct GSC ingestion adapter, with complete date-bounded imports,
source error handling, coverage metadata, and separate totals/query snapshots.
SERP and PageSpeed collection also require their own adapters; they are shown as
unconnected rather than simulated measurements.

## Access and verification

All new public tables enable RLS with owner/admin SELECT only; anonymous reads,
browser writes, and browser execution of collector functions are denied. Views
use `security_invoker=true`. Collectors are private and run with the scheduler's
existing database privileges. No new public security-definer RPC or browser
secret is introduced.

Verified locally: full Hub build/contracts, TypeScript, 24 regression tests.
Verified on the database: 14 sites, real HTTP responses for the three resources,
owner/admin reads, staff isolation, anonymous/write/collector denial, and advisor
checks with no findings involving the new tables or view.

The browser available for verification is at the Product Hub login screen; an
authenticated UI walkthrough has not been performed.
