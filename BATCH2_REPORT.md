# Batch 2 — Real Backend Report

Status: `IMPLEMENTED_WITH_ENVIRONMENT_WARNING`

## Implemented

- Supabase Auth login / optional bootstrap signup
- `profiles` + roles: owner, admin, sales, technician
- Non-recursive RLS helper functions
- Owner/Admin-only financial table access
- Server-generated SKU trigger
- Product CRUD against Supabase
- Owner/Admin delete
- Product image metadata CRUD
- Cloudflare Worker authenticated with Supabase bearer token
- R2 binding upload/delete (no R2 access keys in browser)
- Worker image delivery route
- Mobile upload queue
- Partial-upload retry semantics
- Supabase Realtime inventory refresh with debounce
- IndexedDB/Dexie draft autosave v2
- Drafts isolated by logged-in employee
- Resume latest local draft after app restart
- iOS/Safari-compatible image decode fallback
- Browser-side JPEG compression before upload
- Cost hidden from Sales/Technician UI
- Status validation: Ready/Published requires images; Ready/Published requires sale price

## Security corrections made from Batch 1

1. Removed recursive `profiles` RLS role lookup.
2. Removed direct profile self-update policy to prevent role escalation paths.
3. R2 credentials are no longer required by the app or Worker code.
4. Worker checks the Supabase session on every upload/delete.
5. Worker verifies product access using the same Supabase RLS before touching R2.
6. Product cost remains in `product_financials`, not the general product row.

## Verification performed

- Frontend TypeScript syntax/static audit: `PASS`
- Worker TypeScript syntax/static audit: `PASS`
- Batch 2 placeholder/TODO grep: `PASS`
- App demo-data import check: `PASS`
- Current package-version review: completed for React, React DOM, Vite, Lucide, Dexie, Supabase JS, React types, Wrangler and Cloudflare Worker types.

## Environment warning

A dependency-resolved `npm install` / `npm run build` could not be completed in this execution environment because DNS resolution for `registry.npmjs.org` returns `EAI_AGAIN`.

The code was therefore checked with the locally available TypeScript compiler plus temporary type shims. On a normal internet-connected development machine, run:

```bash
npm install
npm run typecheck
npm run build

cd workers/r2-upload
npm install
npm run typecheck
```

Do not call production deployment complete until those dependency-resolved checks pass.

## Required deployment configuration

1. Run `supabase/schema.sql`.
2. Create first Supabase Auth user.
3. Promote that email to `owner` using the SQL snippet in README.
4. Create R2 bucket `amphon-product-images`.
5. Copy Worker `wrangler.toml.example` to `wrangler.toml` and set Supabase + allowed origins.
6. Deploy Worker.
7. Put Supabase and Worker URLs into root `.env`.
8. Run root app build and deploy PWA.
