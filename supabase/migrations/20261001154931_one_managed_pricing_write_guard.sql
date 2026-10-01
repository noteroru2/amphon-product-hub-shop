create or replace function public.guard_one_managed_pricing_projection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not coalesce(old.one_managed, false) then
    return new;
  end if;

  if current_user in ('service_role','postgres') then
    return new;
  end if;

  if new.price is distinct from old.price
     or new.one_retail_price is distinct from old.one_retail_price
     or new.one_quick_sale_price is distinct from old.one_quick_sale_price
     or new.one_dealer_price is distinct from old.one_dealer_price
     or new.one_absolute_floor_price is distinct from old.one_absolute_floor_price
     or new.one_stock_age_days is distinct from old.one_stock_age_days
     or new.one_aging_bucket is distinct from old.one_aging_bucket
     or new.one_dealer_eligibility is distinct from old.one_dealer_eligibility
     or new.one_price_strategy is distinct from old.one_price_strategy
     or new.one_turnover_rule_version is distinct from old.one_turnover_rule_version
     or new.one_turnover_rule_cohort is distinct from old.one_turnover_rule_cohort
     or new.one_pricing_updated_at is distinct from old.one_pricing_updated_at
     or new.one_pricing_last_event_id is distinct from old.one_pricing_last_event_id
  then
    raise exception 'ONE_MANAGED_PRICING_SYSTEM_OWNED';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_one_managed_pricing_projection() from public;
revoke all on function public.guard_one_managed_pricing_projection() from anon, authenticated;

drop trigger if exists trg_guard_one_managed_pricing_projection on public.products;
create trigger trg_guard_one_managed_pricing_projection
before update on public.products
for each row
execute function public.guard_one_managed_pricing_projection();
