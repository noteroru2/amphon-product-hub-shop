# HUB-1 — PRODUCT HUB DOMAIN CUTOVER REPORT

- Timestamp: `2026-09-13T12:06:43.7627804+07:00`
- Verdict: **PASS_WITH_WARNING**
- Previous Product Hub production URL: `https://app.amphon.co.th` was configured locally, but public DNS did not exist and the Cloudflare account had no Pages project or `amphon-product-hub` Worker before HUB-1
- New canonical Product Hub URL: `https://hub.amphon.co.th`
- SHOP URL: `https://shop.amphon.co.th` (unchanged)

## Deployment architecture

- Frontend: React 19 + TypeScript + Vite 8 PWA
- Source directory: repository root (`src/`, `public/`, `index.html`)
- Build output: `dist/`
- Cloudflare deployment type: Workers Static Assets with SPA fallback
- Frontend service: `amphon-product-hub`
- Hub deployed version: `27e74623-d7d8-432b-8ba4-1c0fbcf6f3b4`
- Production API Worker: `amphon-product-images`
- API Worker pre-HUB-1 rollback version: `3ae7e4dd-495d-4d2f-aa18-7cfdccd4fb6c`
- API Worker HUB-1 version: `bfcd7701-1d91-41ee-9c4a-31a7d8719be1`

## Custom domains

- Before: neither `hub.amphon.co.th` nor `app.amphon.co.th` resolved; SHOP remained attached to its separate existing deployment
- After: `hub.amphon.co.th` is attached to `amphon-product-hub` and serves the Product Hub over valid HTTPS
- Legacy `app.amphon.co.th`: N/A as a live compatibility target because it had no DNS before cutover; its API CORS origin remains retained for compatibility

## Files changed

- `.env` (local production Hub URL)
- `.env.example`
- `deployment/install.config.ps1`
- `deployment/install.config.example.ps1`
- `deployment/INSTALL-ALL.ps1`
- `deployment/INSTALLATION_GUIDE_TH.md`
- `workers/r2-upload/wrangler.jsonc`
- `index.html`
- `public/robots.txt`
- `wrangler.jsonc`
- `package.json`
- `package-lock.json`
- `README.md`
- `scripts/verify-hub1.mjs`
- `HUB1_PRODUCT_HUB_DOMAIN_CUTOVER_REPORT.md`

Generated build files under ignored `dist/` were rebuilt and deployed. No Supabase migration, SHOP source/config, commerce data, product, order, Stripe, webhook, shipping, return, or PromptPay setting was changed.

## Environment and configuration changes

- `VITE_PUBLIC_APP_URL=https://hub.amphon.co.th`
- `VITE_SALES_SITE_URL=https://shop.amphon.co.th` (unchanged)
- `VITE_R2_UPLOAD_API` (unchanged production Worker URL)
- Product Hub Wrangler service: `amphon-product-hub`
- Product Hub custom domain: `hub.amphon.co.th`

Only public variable names and sanitized URL values are recorded here.

## API CORS

Authenticated API allowlist now contains:

- `http://localhost:5173`
- `https://app.amphon.co.th` (retained)
- `https://hub.amphon.co.th` (added)
- `https://shop.amphon.co.th` (retained)

The authenticated API allowlist was not broadened to `*`. Live GET returned the exact Hub origin; OPTIONS preflight for POST and PATCH returned HTTP 204 with the same origin. Public Store API CORS behavior was not changed.

## QR and deep links

The existing implementation constructs Product Hub links from `VITE_PUBLIC_APP_URL` and the real route format `/?sku=<SKU>`. New production builds therefore generate `https://hub.amphon.co.th/?sku=<SKU>`. The deployed JavaScript contains the new host and not `app.amphon.co.th`.

## Supabase Auth

- Authentication type: Supabase password authentication (`signInWithPassword`)
- No OAuth, magic-link, `redirectTo`, callback URL, or cross-domain session cookie implementation was found
- No Supabase Auth dashboard redirect change is required for the existing password flow
- Signup remains disabled by production frontend configuration
- Session/local data remains browser-origin scoped; no explicit cookie Domain, SameSite, or custom localStorage key was found

The unauthenticated production root displays only the intended login shell. Sensitive Hub content is gated behind an authenticated session, active employee profile, UI role checks, API authentication, and database policies. No P0 unauthenticated exposure was found.

## Indexing and security

- Hub meta robots: `noindex,nofollow`
- Hub `robots.txt`: `Disallow: /`
- Hub is not referenced by the SHOP sitemap
- SHOP indexing configuration was not changed
- No existing CSP, `connect-src`, `frame-src`, `form-action`, explicit cookie Domain, or WebSocket origin rule was found; none was weakened or invented during HUB-1

## Build and deployment

- Root dependency install/audit: PASS, 0 vulnerabilities
- Product Hub typecheck: PASS
- Product Hub Vite/PWA build: PASS
- Hub Wrangler dry-run: PASS
- API Worker typecheck: PASS
- API Worker Wrangler dry-run: PASS
- Hub Worker deploy/custom-domain attachment: PASS
- API Worker CORS deploy: PASS
- Non-blocking build warning: the main minified JavaScript chunk exceeds Vite's 500 kB advisory threshold

## Production verification

- Hub HTTPS/TLS and root: PASS
- Product Hub title/build identity: PASS
- Login page loads: PASS
- Redirect loop: none observed
- Browser console errors/warnings on login shell: none
- Hub noindex and robots: PASS
- API GET from Hub origin: PASS
- API POST/PATCH preflight from Hub origin: PASS
- QR canonical build host: PASS
- Legacy hostname: N/A (no pre-existing DNS)

Post-login navigation for Dashboard, Products, Inventory, QR/Barcode, Publish Center, Orders, employee management, commerce settings, warranty/customer data, and authenticated product images was verified statically against the session/role guards but not exercised with a real employee account. This is the reason for `PASS_WITH_WARNING`.

## SHOP protection and regressions

- `https://shop.amphon.co.th`: HTTP 200
- Production Store health: PASS
- `purchase_enabled=true`: confirmed before and after deployments
- Stripe cards enabled: confirmed
- PromptPay disabled: confirmed
- SHOP-6.2 static regression: PASS
- SHOP-1 through SHOP-6 production static regression: PASS
- No order, Checkout Session, charge, refund, or payment test was created

## API Worker regression

- `/health`: PASS
- Store `/health`: PASS
- API Worker version 6 contract: PASS
- Worker source was not modified by HUB-1; only `ALLOWED_ORIGINS` configuration changed
- Existing secret bindings were retained and no secret value was inspected

## Secret scan

PASS. No Supabase server key, Stripe key, webhook secret, Turnstile secret, database password, Cloudflare token, or OAuth client secret was added to HUB-1 source/report output.

## Rollback procedure

1. For an API CORS regression, roll `amphon-product-images` back to version `3ae7e4dd-495d-4d2f-aa18-7cfdccd4fb6c` or restore its prior allowlist and deploy only that Worker.
2. For a Hub build regression, deploy the previous known-good `amphon-product-hub` version once one exists; HUB-1 is its first discovered production deployment.
3. If the new hostname itself must be withdrawn, remove only the `hub.amphon.co.th` binding from `amphon-product-hub` after confirming the replacement URL.
4. Restore `VITE_PUBLIC_APP_URL` and rebuild only Product Hub if the canonical application URL must be reverted.
5. Never use SHOP emergency close and never modify `purchase_enabled` as part of Hub rollback.

## Remaining warnings

- A real employee credential was not used, so post-login navigation and authenticated product-image loading require one owner verification pass.
- `app.amphon.co.th` was not operational before HUB-1; old printed labels pointing there were already unresolved. The origin remains in API CORS, but hostname compatibility is N/A until an owner intentionally provisions that legacy hostname.
- The large Vite chunk warning is pre-existing/non-blocking and was not refactored during this scoped cutover.

## Git status / manual diff

This folder is not a Git repository (`git status` reports no `.git`), so no Git diff is available. The manual changed-file list above is authoritative for HUB-1.
