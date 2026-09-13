# Batch 3.4 — Employee Management

Status: `IMPLEMENTED_PENDING_DEPLOYMENT_CHECK`

## Implemented
- Owner/Admin mobile employee management screen
- Server-side Supabase Auth Admin operations through the existing Cloudflare Worker
- Supabase Secret key stays server-only as `SUPABASE_SECRET_KEY`
- Create employees with temporary passwords and auto-confirmed email
- Forced password change on first login and after admin reset
- Role controls: owner/admin/sales/technician
- Active/inactive account control
- Admin guardrail: cannot manage owner/admin
- Self guardrail: cannot change own role/active state in Employee Management
- Last-owner guardrail
- Employee audit trail
- Employee search, active count and last sign-in information
- Self-service password change

## Deployment
1. Run `supabase/batch3_4.sql` in Supabase SQL Editor.
2. Update the existing R2/API Worker code from this repo.
3. In `workers/r2-upload`, run `npx wrangler secret put SUPABASE_SECRET_KEY` and paste the project's `sb_secret_...` value.
4. Run Worker typecheck and deploy.
5. Reuse the existing root `.env`; no new frontend secret is required.
6. Run root `npm install`, `npm run typecheck`, `npm run build`.

## Security
The Supabase secret key is never exposed to the PWA. Supabase Auth Admin user creation/update operations are executed only by the Worker after validating the caller's Supabase session and checking the caller's active owner/admin profile.
