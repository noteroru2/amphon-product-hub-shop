# Direct Google Search Console ingestion

The existing SEO Control Tower now has a direct read-only Google connection, independent of Windsor. Experiments remain separate and their integrity/causal guards are unchanged.

## Owner activation

1. Enable Search Console API in a Google Cloud project.
2. Configure Google Auth Platform. Create an OAuth client of type Web application.
3. Register this exact authorized redirect URI:
   `https://mfpdtlxwdbxitgfzdape.supabase.co/functions/v1/seo-gsc/callback`
4. In Hub → SEO Control Tower → Google Search Console → settings, enter Client ID and Client Secret as the active owner. These go over HTTPS to the authenticated backend and into Supabase Vault; they are never stored in browser storage or source control.
5. Click Connect and consent with the Google account that can read the registered sites. Only `webmasters.readonly` is requested. Additional accounts can cover remaining properties.
6. The first imports are queued immediately. Each successful site import schedules its next import 72 hours later. Two sites per dispatcher invocation are claimed; the minute cron is a queue dispatcher, not a minute data-fetch interval.

For an external OAuth app in Testing, add the owner as a test user. Testing refresh tokens can expire; configure the production consent app appropriately for ongoing use. Google verification requirements depend on app audience and scope. Do not paste Google passwords or refresh tokens into chats.

## Data semantics

* Web search, finalized data, rolling 28 days ending three Pacific calendar days before the run.
* Aggregate query with no dimensions supplies the host-scoped totals. Because the page filter is present, Google aggregates by canonical page (`auto`), not by property. These are not necessarily identical to the whole-property Search Console headline counts.
* Exact host regex includes `www`, Unicode and ASCII/punycode variants and separates `amphon.co.th` from `shop.amphon.co.th` despite their shared domain property.
* Daily rows include the most recent date with disclosed metrics. Fetch time, requested date window and last observed data date are stored separately and shown in Hub.
* Query/page detail pages through at most 2,000 rows and records whether the local cap was reached. Google can omit rows even below the cap; query sums never replace aggregate totals.
* Successful empty API responses are valid empty windows. HTTP errors, malformed metrics and expired authorization do not overwrite history with zeroes.
* Legacy `QUERY_SAMPLE` snapshots remain visibly distinguished from direct `SITE_TOTAL` snapshots. Comparisons require matching coverage and snapshots at least three days apart.
* Legacy Windsor capture skips sites with a direct connection job. No automatic writes are made to experiment measurement sources: those require aligned primary-query evidence, not dashboard totals.

## Access and reliability

The Edge Function performs `getUser` verification and active database role checks for every management call. Only the owner can configure credentials or disconnect. OAuth callbacks use a hashed one-use state, 10-minute expiry, active actor validation and PKCE. Codes and tokens are not redirected to the frontend. CORS allows the production Hub origin only.

The internal RPC is service-role-only. Token tables have RLS, no browser grants and service-only policies. Vault stores client credentials, refresh tokens and a random scheduler key. The public callback/cron endpoint has gateway JWT verification disabled because it implements separate callback and scheduler authentication. Other calls require an authenticated owner/admin.

Claims use `FOR UPDATE SKIP LOCKED`, unique leases and a five-minute lease expiry. Snapshot insertion and successful job completion are one database transaction. Failed calls retry with backoff; invalid grants mark the connection for reauthorization. Google 429/5xx responses receive bounded retries. Each run processes two sites concurrently with a bounded deadline. Disconnect invalidates leases, disables jobs and scrubs the local Vault token; it does not revoke unrelated Google authorizations.

Expired OAuth state metadata is retained with expired timestamps; it cannot be reused. Disconnected connection metadata remains for diagnostics, with its Vault value overwritten. No data deletion is required during installation.

## Validation and activation boundary

`tests/seo-gsc.test.mjs` executes the ingestion core and actual Edge request handler with mocked external boundaries. It checks Pacific dates, hostname isolation, property permissions, totals versus query rows, pagination, valid empty windows, malformed/error responses, backoff, anonymous/staff rejection and secret-free status.

A rollback-only production database test verified one-use OAuth state, duplicate claim exclusion, wrong-lease rejection, atomic snapshots, 72-hour scheduling, reauthorization and token scrubbing. Production anonymous access returned HTTP 401. Security advisor findings do not include the new objects.

No live Google import is claimed until the owner configures an OAuth client and consents. There were no Google credentials in Vault at implementation time. Search Console is a source of average observed search position, not a fixed-location SERP checker; speed/Core Web Vitals still need a separate source.
