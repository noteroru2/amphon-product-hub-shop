# SEO Growth Center

Read-only recommendations based on the latest finalized direct-GSC snapshot per registered site. The network refresh continues every 72 hours; the opportunity engine re-evaluates every ten minutes. Never inserts into the legacy `commerce_gsc_action_queue`, never modifies source websites, and does not claim causal uplift or real leads from GSC clicks.

## Criteria and limitations

- Near-first-page: at least 50 observed query/page impressions, position 4–20.
- Low CTR review: at least 100 impressions, position 1–10, CTR below 2%. This is a triage heuristic, NOT a calibrated CTR benchmark.
- Ownership review: at least 20 impressions and the same normalized exact query observed on other pages/sites, or disagreement with an owner-confirmed target. Not proof of cannibalization.
- Priority: log-scaled observed impressions, commercial-intent phrase boost, confirmed target boost; capped at 100. Not a Google score or estimated incremental traffic.
- Only latest SITE_TOTAL imports from READY sites with import age <=4 days and future skew <=5 minutes. Query detail is sampled/capped by the existing importer. No search volume, conversion, or SERP ranking claims.
- Ownership map is seeded from registered tracked queries as UNCONFIRMED proposals. Owners can change/confirm an exact keyword and registered same-site HTTPS page.
- Lead-page suggestions are top three commercial query landing pages per site plus ownership targets. They are candidates until the owner confirms them.

## Technical Guard

Private pg_net worker sends up to ten allowlisted page requests per minute, checks each page every 72 hours, and collects results every minute. Captures HTTP status, noindex in headers/meta, title, canonical, H1 count and metadata changes. Does not store HTTP bodies, send credentials, or accept arbitrary hosts.

Checks parse raw HTML conservatively, not rendered JS; missing fields mean review, not definitive absence. This is not URL Inspection, live index testing, a per-page robots evaluator, sitemap membership checking, PageSpeed or Core Web Vitals. HTTP_OK never means indexed. Redirects require review. Source response buffers are bounded to 2 MB in the collector. Requests use existing pg_net transport limits.

## Access and governance

Tables have RLS plus explicit grants. Anonymous access is revoked. Active owner/admin read business metrics; management RPC validates active profile server-side. Owner/admin can refresh and mark recommendations reviewed/dismissed/reopen. Only owners can confirm keyword ownership and lead pages. Private helpers are not browser-executable. Public view uses security_invoker.

Reviewed/dismissed decisions persist across new imports; OPEN evidence ages to STALE. Confirming ownership changes only Hub data and adds a monitoring target, not canonical tags or website content. Legacy Experiments remain separate and unmodified.
