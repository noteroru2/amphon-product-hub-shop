-- SHOP-8.0 — Customer Identity Architecture acceptance assertions
-- READ-ONLY. Run only AFTER applying 20260913230000_shop80_customer_identity_architecture.sql.
-- This file does not mutate production data.

-- 1) Required customer tables must exist.
do $$
begin
  if to_regclass('public.commerce_customer_profiles') is null then
    raise exception 'SHOP80_FAIL: commerce_customer_profiles missing';
  end if;
  if to_regclass('public.commerce_customer_addresses') is null then
    raise exception 'SHOP80_FAIL: commerce_customer_addresses missing';
  end if;
end $$;

-- 2) Customer tables must have RLS enabled.
do $$
declare
  profiles_rls boolean;
  addresses_rls boolean;
begin
  select relrowsecurity into profiles_rls
    from pg_class where oid = 'public.commerce_customer_profiles'::regclass;
  select relrowsecurity into addresses_rls
    from pg_class where oid = 'public.commerce_customer_addresses'::regclass;
  if profiles_rls is not true then
    raise exception 'SHOP80_FAIL: commerce_customer_profiles RLS disabled';
  end if;
  if addresses_rls is not true then
    raise exception 'SHOP80_FAIL: commerce_customer_addresses RLS disabled';
  end if;
end $$;

-- 3) Order ownership/snapshot columns must exist but remain nullable during staged rollout.
do $$
declare
  missing text[];
begin
  select array_agg(required.name order by required.name)
    into missing
  from (values
    ('customer_id'),
    ('auth_user_id'),
    ('customer_profile_snapshot'),
    ('shipping_address_snapshot')
  ) as required(name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'commerce_orders'
      and c.column_name = required.name
  );

  if cardinality(coalesce(missing, array[]::text[])) > 0 then
    raise exception 'SHOP80_FAIL: commerce_orders missing columns %', missing;
  end if;

  if exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'commerce_orders'
      and c.column_name in ('customer_id','auth_user_id','customer_profile_snapshot','shipping_address_snapshot')
      and c.is_nullable <> 'YES'
  ) then
    raise exception 'SHOP80_FAIL: staged order identity columns must remain nullable until SHOP-8.5';
  end if;
end $$;

-- 4) The staged feature flag must exist and remain OFF in SHOP-8.0.
do $$
declare
  required boolean;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'commerce_store_settings'
      and column_name = 'member_checkout_required'
  ) then
    raise exception 'SHOP80_FAIL: member_checkout_required missing';
  end if;

  select member_checkout_required into required
    from public.commerce_store_settings where id = 1;
  if required is distinct from false then
    raise exception 'SHOP80_FAIL: member_checkout_required must remain FALSE during SHOP-8.0';
  end if;
end $$;

-- 5) New Auth users must no longer be unconditionally provisioned as Product Hub staff.
do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.handle_new_auth_user()'::regprocedure)
    into definition;

  if position('raw_app_meta_data' in definition) = 0
     or position('account_type' in definition) = 0
     or position('commerce_customer_profiles' in definition) = 0 then
    raise exception 'SHOP80_FAIL: handle_new_auth_user does not implement explicit staff/customer separation';
  end if;
end $$;

-- 6) Required self-only RLS policies must exist.
do $$
declare
  policy_count integer;
begin
  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public'
    and (
      (tablename = 'commerce_customer_profiles' and policyname in (
        'commerce_customer_profiles_read_self',
        'commerce_customer_profiles_update_self'
      ))
      or
      (tablename = 'commerce_customer_addresses' and policyname in (
        'commerce_customer_addresses_read_self',
        'commerce_customer_addresses_insert_self',
        'commerce_customer_addresses_update_self',
        'commerce_customer_addresses_delete_self'
      ))
    );

  if policy_count <> 6 then
    raise exception 'SHOP80_FAIL: expected 6 customer self-service RLS policies, found %', policy_count;
  end if;
end $$;

-- 7) Orders remain server-only: authenticated role must not have direct table privileges.
do $$
begin
  if has_table_privilege('authenticated', 'public.commerce_orders', 'SELECT')
     or has_table_privilege('authenticated', 'public.commerce_orders', 'INSERT')
     or has_table_privilege('authenticated', 'public.commerce_orders', 'UPDATE')
     or has_table_privilege('authenticated', 'public.commerce_orders', 'DELETE') then
    raise exception 'SHOP80_FAIL: commerce_orders must remain server-only';
  end if;
end $$;

-- 8) Existing production commerce switches are reported for operator review only.
select
  purchase_enabled,
  member_checkout_required,
  stripe_enabled,
  stripe_promptpay_enabled,
  updated_at
from public.commerce_store_settings
where id = 1;

select 'SHOP-8.0 ACCEPTANCE ASSERTIONS PASS' as result;
