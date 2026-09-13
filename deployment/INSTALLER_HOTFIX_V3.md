# INSTALLER HOTFIX V3

Fixes Windows PowerShell 5.1 Supabase authentication probe failure.

The v2 installer attempted `supabase projects list 2>&1` before login. Under
`$ErrorActionPreference = 'Stop'`, Windows PowerShell 5.1 can treat native stderr
as a terminating error, so the script stopped before reaching `supabase login`.

V3 removes the probe. If `SUPABASE_ACCESS_TOKEN` is not set, the installer runs:

    npx supabase@latest login

Then it continues with `supabase link` and the database migration.

No database rollback is required for the v2 failure because it happened before
`supabase link` / `db push`.
