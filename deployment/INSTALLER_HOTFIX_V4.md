# SHOP-6.1 Installer Hotfix v4

Fixes the remote migration failure:

`ERROR: function max(uuid) does not exist (SQLSTATE 42883)`

## What changed

1. `commerce_taxonomy_candidates_v` no longer calls `max(uuid)`.
   - A single mapped UUID is selected only when the group has exactly one distinct mapping.
   - Multiple conflicting mappings return NULL for manual review.
2. The installer now passes the Supabase database password through `SUPABASE_DB_PASSWORD` instead of `-p <password>`, so the password is not echoed in terminal logs.
3. Verification and acceptance SQL are executed with `supabase db query -f <file>`.
4. A pre-push SQL safety check blocks the known UUID aggregate regression.
5. `supabase migration list --linked` is shown before retrying `db push`.

## Retry

Overlay this hotfix on the existing `amphon-product-hub-shop6-1` folder and run `INSTALL-ALL.bat` again.

The failed migration is only written to Supabase migration history after it applies successfully, so a failed push should remain pending and will be retried. If the migration list unexpectedly shows `20260912000000` as already applied on the remote side, stop and inspect the migration state before using `migration repair`.

## Security note

If the database password was exposed in copied terminal logs, rotate it in Supabase before production use.
