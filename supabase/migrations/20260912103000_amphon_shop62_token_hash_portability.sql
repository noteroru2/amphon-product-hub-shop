-- AMPHON SHOP-6.2 token hash portability hotfix
-- Forward-only fix for databases where 20260912090000 is already applied.
--
-- SHOP-6.2 security-definer functions intentionally use search_path = ''.
-- pgcrypto may be installed in a non-public schema (for example `extensions`),
-- so an unqualified digest() is not portable. PostgreSQL provides built-in
-- pg_catalog.sha256(bytea), which avoids extension-schema resolution entirely.

create or replace function public.set_shop62_test_token(test_token text, ttl_minutes integer default 30)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  expires_at_value timestamptz;
begin
  if not private.shop62_actor_is_service_or_postgres() then raise exception 'SHOP62_SERVICE_ROLE_REQUIRED'; end if;
  if char_length(coalesce(test_token, '')) < 32 then raise exception 'SHOP62_TEST_TOKEN_TOO_SHORT'; end if;
  if ttl_minutes < 5 or ttl_minutes > 120 then raise exception 'SHOP62_TEST_TOKEN_TTL_INVALID'; end if;

  expires_at_value := now() + make_interval(mins => ttl_minutes);
  update public.commerce_store_settings
     set shop62_test_token_hash = pg_catalog.encode(
           pg_catalog.sha256(pg_catalog.convert_to(test_token, 'UTF8')),
           'hex'
         ),
         shop62_test_token_expires_at = expires_at_value
   where id = 1;
  return expires_at_value;
end;
$$;

revoke all on function public.set_shop62_test_token(text, integer) from public, anon, authenticated;
grant execute on function public.set_shop62_test_token(text, integer) to service_role;

create or replace function private.shop62_assert_test_token(test_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.commerce_store_settings%rowtype;
begin
  if not private.shop62_actor_is_service_or_postgres() then raise exception 'SHOP62_SERVICE_ROLE_REQUIRED'; end if;
  select * into s from public.commerce_store_settings where id = 1 for update;
  if s.id is null then raise exception 'STORE_SETTINGS_NOT_FOUND'; end if;
  if s.purchase_enabled is true then raise exception 'SHOP62_REQUIRES_PUBLIC_CHECKOUT_DISABLED'; end if;
  if s.shop62_test_token_hash is null or s.shop62_test_token_expires_at is null or s.shop62_test_token_expires_at <= now() then
    raise exception 'SHOP62_TEST_TOKEN_EXPIRED';
  end if;
  if pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(coalesce(test_token, ''), 'UTF8')),
       'hex'
     ) <> s.shop62_test_token_hash then
    raise exception 'SHOP62_TEST_TOKEN_INVALID';
  end if;
end;
$$;

revoke all on function private.shop62_assert_test_token(text) from public, anon, authenticated;
