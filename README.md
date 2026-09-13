# AMPHON Product Hub — Batch 4 Publish Center

## SHOP-6.1 Full Deploy Bundle — Windows one-click

For a complete install/connect/deploy flow, configure `deployment/install.config.ps1` from the example and run `INSTALL-ALL.bat`.

- `INSTALL-ALL.bat` — database + R2 + Worker + optional Stripe webhook + builds + Shop deploy
- `DATABASE-ONLY.bat` — Supabase link + one-shot full DB migration + verification only
- `supabase/FULL_DATABASE_SETUP.sql` — SQL Editor fallback: complete schema/migrations in one file
- `supabase/FULL_DATABASE_VERIFY.sql` — read-only verification bundle
- `deployment/INSTALLATION_GUIDE_TH.md` — Thai installation guide
- `deployment/AFTER_INSTALL_CHECKLIST.md` — release checklist before enabling checkout

Secrets are requested interactively and are not committed to the source bundle. Production checkout remains disabled until the live acceptance/test-payment checklist is completed.


Mobile-first PWA product master for AMPHON TRADING.

## Batch 2 status
Implemented in this repo:

- Supabase email/password authentication
- Automatic `profiles` row creation from Auth users
- Roles: `owner`, `admin`, `sales`, `technician`
- RLS with owner/admin-only financial data
- Server-generated SKU such as `AT-NB-2609-000001`
- Real Supabase product CRUD
- Tap a product card to edit it
- Owner/Admin product deletion
- Product image records in Supabase
- Cloudflare Worker authentication against the active Supabase session
- Direct R2 upload through an R2 binding (no R2 access key in the browser)
- Public image delivery through the Worker `/image/*` route
- Image deletion from R2 when editing/deleting a product
- Upload queue UI with waiting/uploading/done/error states
- Partial-upload recovery: the product remains `draft`, uploaded images are remembered locally, and retry continues the remaining images
- Supabase Realtime inventory refresh across phones/tablets
- Local IndexedDB/Dexie autosave remains enabled for mobile drafts
- Cost is hidden from Sales/Technician and stored separately in `product_financials`

## 1. Requirements

- Node.js 22
- Supabase free project
- Cloudflare account + R2 bucket
- Wrangler CLI (installed by the worker package)

## 2. Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Run the complete file:

```text
supabase/schema.sql
```

The file is designed to upgrade the Batch 1 schema and can be re-run.

### Create the first login

Create the first user in **Supabase → Authentication → Users** (or temporarily enable frontend signup below).

Then promote that email to Owner once in SQL Editor:

```sql
update public.profiles p
set role = 'owner'
from auth.users u
where p.id = u.id
  and u.email = 'YOUR_EMAIL@example.com';
```

All new users start as `sales` by default.

## 3. Frontend environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Fill:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_R2_UPLOAD_API=https://YOUR-R2-WORKER.workers.dev
VITE_ALLOW_SIGNUP=false
```

For the very first setup only, you may set `VITE_ALLOW_SIGNUP=true`, create the account, then set it back to `false`.

## 4. Cloudflare R2 Worker

Create an R2 bucket named:

```text
amphon-product-images
```

Then:

```bash
cd workers/r2-upload
npm install
cp wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "IMAGES"
bucket_name = "amphon-product-images"

[vars]
SUPABASE_URL = "https://YOUR_PROJECT.supabase.co"
SUPABASE_PUBLISHABLE_KEY = "YOUR_PUBLISHABLE_KEY"
ALLOWED_ORIGINS = "http://localhost:5173,https://app.amphon.co.th,https://hub.amphon.co.th,https://shop.amphon.co.th"
```

Deploy:

```bash
npm run deploy
```

Copy the resulting Worker URL into `VITE_R2_UPLOAD_API` in the root `.env`.

### Why the Worker uses an R2 binding

The browser never receives R2 access keys. Every upload/delete request must include a valid Supabase access token. The Worker verifies the token and verifies that the user can read the target product through Supabase RLS before changing R2 objects.

## 5. Run the PWA

From repo root:

```bash
npm install
npm run dev
```

To test from an iPhone/iPad/Android on the same Wi-Fi:

```bash
npm run dev -- --host 0.0.0.0
```

Add that computer's LAN origin (for example `http://192.168.1.20:5173`) to `ALLOWED_ORIGINS` in the Worker while testing on mobile.

Production check:

```bash
npm run typecheck
npm run build
```

## Mobile workflow

1. Login on iPhone/iPad/Android.
2. Tap **เพิ่มสินค้า**.
3. Enter product information.
4. Take/select photos. Images are compressed in the browser.
5. Choose price/status.
6. Save.
7. Product row is created first as `draft` while photos upload.
8. After every image succeeds, the requested final status is applied.
9. Other logged-in devices refresh through Supabase Realtime.

If an upload fails, the successfully uploaded images are recorded in the local draft. Press **บันทึก** again and only the remaining images upload.

## Security decisions

- `product_financials` is separated from normal product data.
- Only Owner/Admin can read or write cost.
- Only Owner/Admin can delete products.
- Staff can never receive R2 credentials.
- The R2 Worker validates the Supabase session on every mutation.
- Product images are publicly readable by URL because they are intended to be reusable on the future sales website. Upload/delete remain authenticated.

## Current boundary

Batch 2 is the real backend foundation. It intentionally does **not** yet include:

- Employee-management UI / invitations
- Automatic Facebook/Marketplace content
- ZIP/share center
- Sales website publishing controls
- Amphon System adapter

Those belong to the next workflow/integration batches.

## Batch 3 — Mobile Sales Toolkit

Added after Batch 2:

- Existing product cards now open directly on step 4 (price/review) so staff reaches sales tools immediately.
- **Download all images** creates one ZIP in the browser.
- ZIP contains ordered product photos plus `spec.txt` and `sales-content.txt`.
- **Share images** opens the native mobile Share Sheet when the browser supports multi-file Web Share.
- **Copy specs** creates category-aware text from saved product data.
- **Copy sales content** creates a ready-to-post Thai sales caption from saved product data.
- Cost/financial data is intentionally excluded from all copied/exported sales text.
- `src/vite-env.d.ts` is included so Vite `import.meta.env` passes TypeScript checking.

This batch does **not** change the Supabase schema or R2 Worker API. Existing Batch 2 Supabase/R2 deployment can be reused.

After upgrading, keep/copy your existing root `.env`, then run:

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

The new ZIP feature uses `fflate` in the browser. The project pins the current 0.8.x release range.


## Batch 3.1 Content Template

Sales Toolkit includes Facebook, Marketplace, WINNER IT and Generic content presets. Templates live in `src/lib/contentTemplates.ts`. No Supabase or R2 Worker migration is required for this batch.

## Batch 3.2 — Product Schema & Smart Form

Batch 3.2 upgrades product capture from a generic form to category-aware structured data.

### Added

- Main categories: Notebook, Desktop PC, iPhone, Android Phone, iPad/Tablet, Camera, Lens, Monitor, Gaming Console, Component, Accessories and Other.
- Subtypes per category, for example Notebook → General/Gaming/Business/MacBook and Component → CPU/GPU/Mainboard/RAM/SSD/HDD/PSU/Cooler/Case.
- Dynamic smart fields with `Required`, `Recommended` and `Optional` importance.
- Category-specific condition checks such as Face ID, True Tone, shutter count, sensor/EVF condition, lens fungus/haze checks, dead pixels, stick drift and storage health.
- Data Completeness Score and a minimum 80% readiness gate.
- `ready_to_list` and `published` require all Required fields, a sale price and at least one image.
- Product image roles such as Cover, Screen, Serial, Defect, Accessories, Pixel Test and Shutter Count.
- ZIP image filenames now include the image role, for example `01-cover.jpg` and `02-screen.jpg`.
- Content templates and `spec.txt` use schema-aware labels automatically.

### Existing Batch 3.1 deployment: required Supabase migration

Before starting the Batch 3.2 frontend, open **Supabase → SQL Editor** and run the complete file:

```text
supabase/batch3_2.sql
```

It adds:

- `products.subtype`
- new category values (`lens`, `monitor`, `accessory`)
- `product_images.image_role`
- SKU prefixes for Lens (`LNS`), Monitor (`MON`) and Accessories (`AC`)

Existing products and images are preserved. Existing products receive a neutral subtype (`other`, except iPhone/Android which are mapped automatically), and existing cover images are marked `cover`.

**No R2 Worker redeploy is required.** Keep the same root `.env` and existing Cloudflare Worker URL.

Then run from the project root:

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

The complete fresh-install schema at `supabase/schema.sql` already includes the Batch 3.2 changes.


## Batch 3.3 — Production Workflow & Guardrails

Batch 3.3 hardens the app for daily multi-employee use.

### Added

- Live Serial / IMEI duplicate lookup while staff types.
- Database trigger blocks a second **active-stock** item with the same normalized Serial / IMEI, protecting against two phones saving at nearly the same time.
- Sold/returned/cancelled historical items do not permanently block the identifier, so a device can be bought back later as a new stock record.
- Save lock prevents accidental double-submit from repeated taps.
- Status transition guard in both frontend/backend and PostgreSQL.
- Risk confirmation before changing an existing item to Sold, Returned or Cancelled.
- Returned/Cancelled items can be reopened as Draft only by Owner/Admin.
- Existing published/reserved products no longer get temporarily demoted to Draft just because new photos are being uploaded.
- Upload queue explicitly supports retry: completed uploads are retained and the next save sends only pending images.
- Owner/Admin activity history on each product: create, edit, Serial/IMEI change, status change, image upload/delete and incomplete upload.
- Pending-image warning before save.

### Required migration from Batch 3.2

Open **Supabase → SQL Editor** and run the complete file:

```text
supabase/batch3_3.sql
```

This migration creates:

- `normalize_product_identifier(text)`
- `find_active_product_by_identifier(text)` RPC
- normalized identifier lookup index
- database duplicate guard trigger
- database status-transition guard trigger
- activity-log lookup index

It does not delete or rewrite existing products. Existing duplicates, if any, are left untouched; the guard prevents creating a new active duplicate or changing an identifier/status into a new conflict.

**No R2 Worker redeploy is required.** Keep the same `.env`, Supabase project, R2 bucket and Worker URL.

Then run from project root:

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

For a fresh Supabase project, `supabase/schema.sql` already includes Batch 3.3.

## Batch 3.4 — Employee Management

Run `supabase/batch3_4.sql` once after Batch 3.3.

Employee Auth administration is server-only. The existing Cloudflare Worker now also provides `/employees` admin endpoints. Before redeploying the Worker, add the Supabase project **Secret key** as an encrypted Worker secret (never put it in the frontend `.env` or `wrangler.toml`):

```powershell
cd workers/r2-upload
npx wrangler secret put SUPABASE_SECRET_KEY
npm run typecheck
npm run deploy
```

Paste the project's `sb_secret_...` value when Wrangler prompts. The secret is used only inside the Worker for Supabase Auth Admin operations.

Batch 3.4 includes:
- Owner/Admin employee list and search
- Create employee with server-generated temporary password
- First-login forced password change
- Change display name, role and active status
- Reset employee password with forced change on next login
- Employee-management audit log
- Admin cannot manage Owner/Admin
- Cannot change own role/active status from Employee Management
- Cannot deactivate or demote the last active Owner
- Self-service password change from Profile

No R2 bucket changes are required, but the Worker **must be redeployed** because Batch 3.4 adds authenticated employee-management routes.


## Batch 3.5 — QR / Barcode Workflow

Batch 3.5 adds a mobile-first item identification workflow on top of the existing SKU/product records. **No Supabase migration and no Cloudflare Worker redeploy are required.**

### Added

- Product QR generated from the saved SKU and a deep link such as `https://hub.amphon.co.th/?sku=AT-NB-2609-000123`.
- Code128 barcode generated from the same SKU for ordinary barcode readers.
- Bottom-navigation **Scan** screen.
- Live camera QR/barcode scanning via `@zxing/browser`.
- Scan-from-photo fallback for iPhone/iPad/Android and non-HTTPS LAN testing.
- Manual SKU/Serial search fallback.
- Scanned SKU or Serial opens the exact existing product at the workflow/sales screen.
- QR opened from the normal iPhone/Android camera resolves the `?sku=` deep link after login.
- Product quick actions: Edit details, Reserve, Sold.
- Warranty date shown next to the quick workflow actions.
- One-tap status actions reuse the Batch 3.3 workflow transition guards and activity logs.
- Printable labels in 70×40 mm and 50×30 mm layouts.
- Label includes AMPHON TRADING, product title, SKU, sale price, QR and Code128.
- Download QR PNG, Barcode PNG and copy product deep link.

### HTTPS note for live scanning

Browser live camera access requires a secure context on mobile. Production `https://hub.amphon.co.th` is appropriate. When testing the Vite app from another device using a LAN URL such as `http://192.168.1.20:5173`, use **ถ่าย/เลือกรูปโค้ด** or manual SKU search if the browser blocks `getUserMedia`.

### Upgrade from Batch 3.4

Keep your existing root `.env`, existing Supabase database, R2 bucket and deployed Worker. Then run:

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

Batch 3.5 adds frontend dependencies `@zxing/browser`, `@zxing/library`, `qrcode` and `jsbarcode`.

Set `VITE_PUBLIC_APP_URL=https://hub.amphon.co.th` in the root `.env` before printing permanent labels. When omitted, QR links use the current browser origin (useful for temporary testing only). Keep the legacy `app.amphon.co.th` API origin allowed during the compatibility window for old clients and labels.


## Batch 4 — Publish Center

Batch 4 adds a mobile-first publication workflow that tracks where each product has actually been listed. It does **not** auto-post to Facebook or Marketplace; staff copy/share the prepared content and images, then confirm the listing in Product Hub.

### Channels

- Facebook
- Facebook Marketplace
- WINNER IT
- Website (manual tracking now; reserved for automatic website integration in Batch 4.1)

### Added

- Publish Center shortcut on Home and Inventory.
- Work queues: `รอลง`, `ลงไม่ครบ`, `ครบแล้ว`, `ต้องปิดประกาศ`.
- Per-product 0/4–4/4 channel progress.
- Per-channel states: `ยังไม่ลง`, `ลงแล้ว`, `ปิดประกาศแล้ว`.
- Save listing URL for each channel.
- Store who published, when it was published, who ended it and when.
- Copy channel-specific content directly from the publication sheet.
- Share product images through the mobile share sheet.
- Realtime publication-state refresh across phones/tablets.
- Technician can view publication status; Owner/Admin/Sales can change it.
- The first active publication automatically changes overall product status from `ready_to_list` to `published`.
- Ending the last active publication changes overall product status from `published` back to `ready_to_list`.
- `reserved` and `sold` product statuses are never downgraded by Publish Center.
- Sold products with live listings are placed in `ต้องปิดประกาศ`; after all listings are ended they disappear from the Publish Center work queue.
- Publication changes are written into the existing product activity log.

### Required Supabase migration

Run the whole file in **Supabase → SQL Editor**:

```text
supabase/batch4.sql
```

This creates `product_publications`, RLS policies, indexes and Supabase Realtime publication support. Existing products/images are not changed or deleted.

### Upgrade from Batch 3.5

1. Run `supabase/batch4.sql` once.
2. Keep the existing root `.env`.
3. Keep the existing deployed Cloudflare Worker; **no Worker redeploy is required**.
4. Run:

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

No new npm dependencies are added in Batch 4.

## Batch 4.1 — Sales Website Integration

Batch 4.1 turns the Website channel into a real publication source instead of manual tracking.

### Added

- Website publish/unpublish controls in Publish Center.
- Stable sales-page URL contract: `/product/{SKU}`.
- `VITE_SALES_SITE_URL` for the production sales website base URL.
- Server-only `website_products` projection that excludes serial/IMEI, costs, internal notes and employee data.
- Public read-only Cloudflare Worker Store API:
  - `GET /store/health`
  - `GET /store/products`
  - `GET /store/products/:sku`
- Search/filter/pagination for the public product feed.
- Website reads live Product Master data, so price/spec/image edits do not need a second manual sync.
- Reserved products stay visible as `availability=reserved`.
- Sold/returned/cancelled products automatically end the Website publication and disappear from the public Store API.
- Public API CORS is read-only and open (`*`) while authenticated employee/R2 routes keep the existing `ALLOWED_ORIGINS` rules.
- Store API never returns cost, serial/IMEI, internal notes, employee information or secrets.

### Required Supabase migration

Run:

```text
supabase/batch4_1.sql
```

### Required Product Hub environment

Keep the existing `.env` and add the real sales website URL when known:

```dotenv
VITE_SALES_SITE_URL=https://shop.amphon.co.th
```

### Worker redeploy required

Batch 4.1 adds the public Store API to the existing Worker. Keep the existing `wrangler.toml` and `SUPABASE_SECRET_KEY`, then run:

```bash
cd workers/r2-upload
npm install
npm run typecheck
npm run deploy
```

No new Worker secrets and no new R2 bucket are required.

Then return to the project root:

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

No new npm dependencies are added in Batch 4.1.

See `docs/SALES_WEBSITE_INTEGRATION.md` and `examples/sales-website/storeClient.ts` for the API contract used by the future sales website.

---

## SHOP-2 — Evergreen SEO Taxonomy

SHOP-2 adds Brand / Series / Model evergreen routes on top of SHOP-1. Apply:

1. `supabase/shop_1.sql` (if not already applied)
2. `supabase/shop_2.sql`
3. inspect `supabase/shop_2_verify.sql`
4. redeploy `workers/r2-upload`
5. deploy `shop/`

See `docs/SHOP2_TAXONOMY_PLAYBOOK.md` and `SHOP2_REPORT.md`.

## SHOP-1 → SHOP-3 Storefront track

The package now also contains the `shop/` Astro SSR storefront for `shop.amphon.co.th`.

Applied in order:

- SHOP-1: Astro Storefront Foundation + Supabase Commerce Schema
- SHOP-2: Brand / Series / Model Evergreen SEO Architecture
- SHOP-3: Product Detail SEO + Merchant Listing Schema + Used Product Trust UX

Storefront migrations:

```text
supabase/shop_1.sql
supabase/shop_2.sql
supabase/shop_3.sql
supabase/shop_4.sql
supabase/shop_5.sql
```

SHOP-3 merchant purchase readiness remains disabled by default until a real checkout/order flow exists. See `docs/SHOP3_PRODUCT_DETAIL_PLAYBOOK.md`.

## SHOP-4 — Publish Center ↔ Commerce Admin

SHOP-4 moves normal Shop configuration into the AMPHON Product Hub UI.

Added:

- per-SKU Category / Brand / Series / Model mapping
- SEO title / meta / index-policy controls
- Merchant condition + GTIN / MPN / Google category controls
- Merchant readiness blockers in Publish Center
- stable canonical Shop URL before Website publish
- Owner/Admin Shipping + Return policy settings
- taxonomy candidate review/remap
- Owner/Admin quick-create Series/Model as HOLD
- Store API v4 authenticated `/commerce/*` admin endpoints
- database hierarchy validation and canonical publication URL sync

Merchant condition is now limited to `NEW`, `USED`, `REFURBISHED`. Legacy `DAMAGED` entries migrate to `USED`; visible defects remain on the product page.

Apply after SHOP-3:

```text
supabase/shop_4.sql
supabase/shop_4_verify.sql
```

Then redeploy `workers/r2-upload` and rebuild both Product Hub and `shop/`.

SHOP-4 deliberately locks `purchase_enabled=false`. Do not remove `commerce_store_settings_shop4_purchase_lock` until SHOP-5 provides tested order/reservation/checkout behavior.

See `docs/SHOP4_COMMERCE_ADMIN_PLAYBOOK.md` and `SHOP4_REPORT.md`.


## SHOP-5 — Cart + Atomic Reservation + Checkout + Orders

SHOP-5 removes the temporary SHOP-4 purchase lock and adds the real checkout/order lifecycle.

- local cart with live availability recheck
- atomic PostgreSQL SKU reservations with deterministic row locking
- idempotent checkout (`idempotency_key`)
- bank transfer and pickup/pay-at-store baseline payment methods
- public order status via opaque `public_token`
- Cloudflare Turnstile challenge with mandatory server-side Siteverify before stock reservation
- payment notification / staff payment review
- automatic reservation expiry and stock release
- Product Hub Online Orders management for Owner/Admin/Sales
- paid order fulfillment: packing, shipped/tracking, pickup-ready, complete
- explicit refund transition for paid orders

Apply after SHOP-4:

```text
supabase/shop_5.sql
supabase/shop_5_verify.sql
```

Set Worker secrets with `wrangler secret put SUPABASE_SECRET_KEY` and `wrangler secret put TURNSTILE_SECRET_KEY`, then redeploy `workers/r2-upload`, rebuild Product Hub, rebuild `shop/`, and configure the Worker cron trigger for reservation expiry.

SHOP-5 intentionally does not hard-code a card/QR payment gateway. The order engine is provider-neutral; a payment adapter can be added later without changing reservation/order ownership. See `docs/SHOP5_CHECKOUT_ORDER_PLAYBOOK.md` and `SHOP5_REPORT.md`.

## SHOP-6.1 Production Closeout

Current release gate: `PASS_WITH_LIVE_ACCEPTANCE_REQUIRED`.

See:
- `SHOP6_REPORT.md`
- `SHOP6_1_REPORT.md`
- `docs/SHOP6_PAYMENT_FULFILLMENT_PLAYBOOK.md`
- `docs/SHOP61_PRODUCTION_ACCEPTANCE.md`
- `supabase/shop_6.sql`
- `supabase/shop_6_verify.sql`
- `supabase/shop_6_1_acceptance.sql`

Do not enable production checkout solely from static verification. Run the target Supabase acceptance SQL and Stripe/Cloudflare live E2E matrix first.

## Installer baseline

Use **SHOP-6.1 Full Deploy v5** or newer. v5 fixes PostgreSQL `CREATE OR REPLACE VIEW` column-order compatibility across SHOP-5/6 and adds a pre-push safety gate.

## SHOP-6.1 Build Hotfix v9

If Supabase, Worker deploy, Stripe webhook, and frontend env generation already passed but
`verify:production-closeout` failed on Windows/Node 24 with `Cannot read properties of undefined (reading 'trim')`,
apply Hotfix v9 and run `RESUME-FROM-BUILD.bat`. This resumes from Step 6 and does not touch the database,
API Worker secrets, or Stripe webhook setup again.


## SHOP-6.2 — Payment & Fulfillment E2E Acceptance

After SHOP-6.1 live HTTP acceptance, run:

```bat
SHOP62-DB-UPGRADE-TEST.bat
```

Then configure the intended production Commerce settings with `purchase_enabled=false`, and run:

```bat
SHOP62-PROVIDER-E2E.bat
```

See `docs/SHOP62_PAYMENT_E2E_ACCEPTANCE.md`. SHOP-6.2 never enables public purchase automatically.
