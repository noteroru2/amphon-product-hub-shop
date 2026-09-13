# SHOP-6.1 Database Hotfix v5

Status: `READY_FOR_RETRY`

## Why v5 exists

The full migration previously evolved several PostgreSQL views by inserting new columns in the middle of the existing output column list. PostgreSQL `CREATE OR REPLACE VIEW` requires all existing columns to keep the same names, order, and types; only new columns may be appended at the end.

The first visible failure was:

`cannot change name of view column "updated_at" to "reservation_minutes"`

v5 fixes all affected view evolutions, not only the first failing statement:

- `commerce_public_store_settings_v`
- `commerce_order_admin_v`
- `commerce_listing_editor_v`

The original view column prefix is preserved exactly and SHOP-5/SHOP-6 fields are appended at the end.

## Retry

1. Extract `amphon-shop61-database-hotfix-v5.zip`.
2. Copy its contents over the existing `amphon-product-hub-shop6-1` folder and choose Replace All.
3. Keep your existing `deployment/install.config.ps1`.
4. Run `INSTALL-ALL.bat` again.
5. Do not run `migration repair` unless `supabase migration list --linked` shows the migration as applied remotely while the schema is not actually applied.

The installer now has a fail-fast SQL safety gate for:

- UUID `max(uuid)` aggregate regression.
- Store-settings view column insertion regression.
- Order-admin view column insertion regression.
- Listing-editor view column insertion regression.
- Database password exposure in CLI arguments.

## Expected database stage

```text
Database SQL safety check - PASS
supabase migration list --linked
supabase db push --linked --include-all
Applying migration 20260912000000_amphon_shop61_full_setup.sql...
Finished supabase db push.
Running SHOP-6 verification SQL...
Running SHOP-6.1 fail-fast database acceptance assertion...
DATABASE CONNECT + MIGRATION + ASSERTION - PASS
```
