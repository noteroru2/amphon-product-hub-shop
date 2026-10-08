-- AMPHON operating loop closeout: security hardening, legacy integrity,
-- AI Buyer deterministic outcome closure, and business growth measurement.
-- Applied to production as Supabase migration 20261008082714.

-- 1) SECURITY HARDENING
alter table public.ai_buyer_learning_windows enable row level security;
alter table public.ai_buyer_learning_events enable row level security;
alter table public.ai_buyer_learning_imports enable row level security;
alter table public.ai_buyer_learning_line_delivery_stats enable row level security;
alter table public.ai_buyer_learning_labels enable row level security;

revoke all on table
  public.ai_buyer_learning_windows,
  public.ai_buyer_learning_events,
  public.ai_buyer_learning_imports,
  public.ai_buyer_learning_line_delivery_stats,
  public.ai_buyer_learning_labels
from anon, authenticated;

grant select, insert, update, delete on table
  public.ai_buyer_learning_windows,
  public.ai_buyer_learning_events,
  public.ai_buyer_learning_imports,
  public.ai_buyer_learning_line_delivery_stats,
  public.ai_buyer_learning_labels
to service_role;

alter view public.facebook_learning_feedback_v set (security_invoker = true);
alter view public.facebook_rotation_health_v set (security_invoker = true);
alter view public.sales_channel_readiness_v set (security_invoker = true);

revoke execute on function public.ai_buyer_apply_final_outcome() from public, anon, authenticated;
revoke execute on function public.ai_buyer_sync_ledger_from_financial() from public, anon, authenticated;
revoke execute on function public.ai_buyer_sync_ledger_from_order() from public, anon, authenticated;
revoke execute on function public.ai_buyer_sync_ledger_from_product() from public, anon, authenticated;
revoke execute on function public.ai_buyer_touch_outcome_updated_at() from public, anon, authenticated;
revoke execute on function public.facebook_learning_pick(text,smallint,smallint,text) from public, anon, authenticated;

grant execute on function public.ai_buyer_apply_final_outcome() to service_role;
grant execute on function public.ai_buyer_sync_ledger_from_financial() to service_role;
grant execute on function public.ai_buyer_sync_ledger_from_order() to service_role;
grant execute on function public.ai_buyer_sync_ledger_from_product() to service_role;
grant execute on function public.ai_buyer_touch_outcome_updated_at() to service_role;
grant execute on function public.facebook_learning_pick(text,smallint,smallint,text) to service_role;

comment on function public.get_member_checkout_policy() is
'Intentional public read-only boolean RPC. SECURITY DEFINER is retained because exposing commerce_store_settings is broader than returning this single policy bit.';

-- 2) LEGACY DATA INTEGRITY
update public.products
set one_availability='SOLD',
    one_availability_version=coalesce(one_availability_version,0)+1,
    one_availability_updated_at=now(),
    one_availability_last_reason='LEGACY_STATUS_RECONCILIATION'
where coalesce(one_managed,false)=false
  and status='sold'
  and one_availability='IN_STOCK';

update public.products
set one_availability='IN_STOCK',
    one_availability_version=coalesce(one_availability_version,0)+1,
    one_availability_updated_at=now(),
    one_availability_last_reason='LEGACY_STATUS_RECONCILIATION'
where coalesce(one_managed,false)=false
  and status='published'
  and one_availability is null;

update public.external_entity_links l
set sync_status='ERROR',
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'integrityError','ORPHAN_TARGET_PRODUCT',
      'integrityDetectedAt',now()
    ),
    updated_at=now()
where l.target_system='product-hub'
  and l.target_entity_type='product'
  and l.sync_status='LINKED'
  and not exists (
    select 1 from public.products p where p.id::text=l.target_entity_id
  );

create or replace function public.enforce_legacy_product_availability()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if coalesce(new.one_managed,false)=false then
    if new.status='sold' and new.one_availability is distinct from 'SOLD' then
      new.one_availability := 'SOLD';
      new.one_availability_version := coalesce(new.one_availability_version,0)+1;
      new.one_availability_updated_at := now();
      new.one_availability_last_reason := 'LEGACY_STATUS_GUARD';
    elsif new.status='published' and new.one_availability is null then
      new.one_availability := 'IN_STOCK';
      new.one_availability_version := coalesce(new.one_availability_version,0)+1;
      new.one_availability_updated_at := now();
      new.one_availability_last_reason := 'LEGACY_STATUS_GUARD';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_legacy_product_availability_guard on public.products;
create trigger trg_legacy_product_availability_guard
before insert or update of status,one_managed,one_availability on public.products
for each row execute function public.enforce_legacy_product_availability();

revoke execute on function public.enforce_legacy_product_availability() from public, anon, authenticated;
grant execute on function public.enforce_legacy_product_availability() to service_role;

create or replace view public.one_integrity_issues_v
with (security_invoker=true)
as
select
  'ONE_MANAGED_STATUS_AVAILABILITY_DRIFT'::text issue_type,
  p.id::text entity_id,
  p.sku,
  jsonb_build_object('status',p.status,'availability',p.one_availability) detail,
  p.updated_at observed_at
from public.products p
where p.one_managed=true
  and (
    (p.status='sold' and p.one_availability is distinct from 'SOLD')
    or (p.status='published' and p.one_availability is distinct from 'IN_STOCK')
  )
union all
select
  'ONE_MANAGED_LINK_MISSING',
  p.id::text,
  p.sku,
  jsonb_build_object('oneManaged',true),
  p.updated_at
from public.products p
where p.one_managed=true
  and not exists (
    select 1 from public.external_entity_links l
    where l.target_system='product-hub'
      and l.target_entity_type='product'
      and l.target_entity_id=p.id::text
      and l.sync_status='LINKED'
  )
union all
select
  'ORPHAN_TARGET_LINK',
  l.id::text,
  l.business_key,
  jsonb_build_object('sourceEntityId',l.source_entity_id,'targetEntityId',l.target_entity_id,'syncStatus',l.sync_status),
  l.updated_at
from public.external_entity_links l
where l.target_system='product-hub'
  and l.target_entity_type='product'
  and not exists (select 1 from public.products p where p.id::text=l.target_entity_id)
union all
select
  'INTEGRATION_INBOX_FAILURE',
  i.id::text,
  i.entity_sku,
  jsonb_build_object('eventType',i.event_type,'status',i.status,'error',i.last_error,'attempts',i.attempts),
  i.updated_at
from public.integration_event_inbox i
where i.status in ('DEAD','FAILED')
  and i.updated_at >= now()-interval '14 days';

revoke all on public.one_integrity_issues_v from anon, authenticated;
grant select on public.one_integrity_issues_v to service_role;

-- 3) AI BUYER CLOSED LOOP
create or replace function public.ai_buyer_close_stale_outcomes()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_expired int := 0;
  v_terminal int := 0;
begin
  with latest_delivered as (
    select distinct on (o.case_id)
      o.case_id,o.delivered_at
    from public.ai_buyer_offers o
    where o.delivered_at is not null
    order by o.case_id,o.delivered_at desc
  ), stale as (
    select c.id
    from public.ai_buyer_valuation_cases c
    join latest_delivered d on d.case_id=c.id
    where c.state in ('OFFERED','NEGOTIATING','PRICING')
      and d.delivered_at < now()-interval '7 days'
      and not exists (select 1 from public.ai_buyer_case_outcomes x where x.case_id=c.id)
      and not exists (
        select 1 from public.ai_buyer_messages m
        where m.case_id=c.id and m.direction='INBOUND' and m.created_at>d.delivered_at
      )
  )
  update public.ai_buyer_valuation_cases c
  set state='EXPIRED',completed_at=coalesce(completed_at,now()),updated_at=now()
  where c.id in (select id from stale);
  get diagnostics v_expired = row_count;

  insert into public.ai_buyer_case_outcomes(
    case_id,final_label,reason_code,note,outcome_at,source,verified
  )
  select c.id,'CUSTOMER_NO_RESPONSE','AUTO_STALE_NO_RESPONSE',
         'Auto-closed after 7 days with no inbound reply after delivered offer.',
         coalesce(c.completed_at,now()),'SYSTEM_SYNC',true
  from public.ai_buyer_valuation_cases c
  where c.state='EXPIRED'
    and not exists(select 1 from public.ai_buyer_case_outcomes x where x.case_id=c.id)
  on conflict(case_id) do nothing;
  get diagnostics v_terminal = row_count;

  insert into public.ai_buyer_case_outcomes(
    case_id,final_label,reason_code,note,outcome_at,source,verified
  )
  select c.id,'CANCELLED_OTHER','AUTO_TERMINAL_CANCELLED',
         'Auto-labeled from terminal CANCELLED state.',
         coalesce(c.completed_at,now()),'SYSTEM_SYNC',true
  from public.ai_buyer_valuation_cases c
  where c.state='CANCELLED'
    and not exists(select 1 from public.ai_buyer_case_outcomes x where x.case_id=c.id)
  on conflict(case_id) do nothing;

  return jsonb_build_object('expiredCases',v_expired,'outcomesInserted',v_terminal);
end;
$$;

revoke execute on function public.ai_buyer_close_stale_outcomes() from public, anon, authenticated;
grant execute on function public.ai_buyer_close_stale_outcomes() to service_role;

create or replace view public.ai_buyer_outcome_health_v
with (security_invoker=true)
as
select
  (select count(*) from public.ai_buyer_valuation_cases)::bigint as total_cases,
  (select count(distinct case_id) from public.ai_buyer_offers)::bigint as offered_cases,
  (select count(*) from public.ai_buyer_case_outcomes)::bigint as final_outcomes,
  (select count(*) from public.ai_buyer_case_outcomes where final_label='PURCHASED')::bigint as purchased_cases,
  (select count(distinct case_id) from public.ai_buyer_deal_ledger where status='SOLD')::bigint as sold_economic_cases,
  (select coalesce(sum(gross_profit),0) from public.ai_buyer_deal_ledger where status='SOLD')::numeric as realized_gross_profit,
  (select count(*) from public.ai_buyer_final_label_queue_v)::bigint as needs_manual_final_label,
  (select count(*) from public.ai_buyer_valuation_cases c
     where c.state in ('OFFERED','NEGOTIATING','PRICING')
       and exists(select 1 from public.ai_buyer_offers o where o.case_id=c.id and o.delivered_at is not null)
  )::bigint as open_offered_cases;

revoke all on public.ai_buyer_outcome_health_v from anon, authenticated;
grant select on public.ai_buyer_outcome_health_v to service_role;

select cron.unschedule(jobid) from cron.job where jobname='ai-buyer-close-stale-outcomes';
select cron.schedule(
  'ai-buyer-close-stale-outcomes',
  '17 * * * *',
  $cron$select public.ai_buyer_close_stale_outcomes();$cron$
);

-- 4) BUSINESS GROWTH MEASUREMENT
create table if not exists public.business_growth_daily (
  snapshot_date date primary key,
  captured_at timestamptz not null default now(),
  live_products int not null default 0,
  shop_orders int not null default 0,
  shop_paid_orders int not null default 0,
  shop_completed_orders int not null default 0,
  shop_revenue numeric(14,2) not null default 0,
  facebook_posts int not null default 0,
  distribution_open_critical int not null default 0,
  distribution_open_warning int not null default 0,
  ai_pricing_decisions int not null default 0,
  ai_offers int not null default 0,
  ai_final_outcomes int not null default 0,
  ai_purchases int not null default 0,
  ai_realized_gross_profit numeric(14,2) not null default 0,
  seo_executions int not null default 0,
  seo_measurements int not null default 0,
  seo_improved int not null default 0,
  merchant_unresolved_issues int not null default 0,
  one_integrity_issue_count int not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.business_growth_daily enable row level security;
revoke all on public.business_growth_daily from anon, authenticated;
grant select,insert,update,delete on public.business_growth_daily to service_role;

create or replace function public.capture_business_growth_daily(p_date date default null)
returns public.business_growth_daily
language plpgsql
security definer
set search_path=''
as $$
declare
  d date := coalesce(p_date, timezone('Asia/Bangkok',now())::date);
  start_ts timestamptz := (d::timestamp at time zone 'Asia/Bangkok');
  end_ts timestamptz := ((d+1)::timestamp at time zone 'Asia/Bangkok');
  result public.business_growth_daily;
begin
  insert into public.business_growth_daily(
    snapshot_date,captured_at,live_products,
    shop_orders,shop_paid_orders,shop_completed_orders,shop_revenue,
    facebook_posts,distribution_open_critical,distribution_open_warning,
    ai_pricing_decisions,ai_offers,ai_final_outcomes,ai_purchases,ai_realized_gross_profit,
    seo_executions,seo_measurements,seo_improved,
    merchant_unresolved_issues,one_integrity_issue_count,metadata
  )
  values (
    d,now(),
    (select count(*) from public.products where status='published'),
    (select count(*) from public.commerce_orders where created_at>=start_ts and created_at<end_ts),
    (select count(*) from public.commerce_orders where paid_at>=start_ts and paid_at<end_ts),
    (select count(*) from public.commerce_orders where completed_at>=start_ts and completed_at<end_ts),
    (select coalesce(sum(total),0) from public.commerce_orders where completed_at>=start_ts and completed_at<end_ts),
    (select count(*) from public.facebook_post_ledger where published_at>=start_ts and published_at<end_ts),
    (select count(*) from public.distribution_alerts where status='OPEN' and severity='CRITICAL'),
    (select count(*) from public.distribution_alerts where status='OPEN' and severity='WARNING'),
    (select count(*) from public.ai_buyer_pricing_decisions where created_at>=start_ts and created_at<end_ts),
    (select count(*) from public.ai_buyer_offers where created_at>=start_ts and created_at<end_ts),
    (select count(*) from public.ai_buyer_case_outcomes where outcome_at>=start_ts and outcome_at<end_ts),
    (select count(*) from public.ai_buyer_case_outcomes where final_label='PURCHASED' and outcome_at>=start_ts and outcome_at<end_ts),
    (select coalesce(sum(gross_profit),0) from public.ai_buyer_deal_ledger where status='SOLD' and sold_at>=start_ts and sold_at<end_ts),
    (select count(*) from public.commerce_gsc_action_executions where applied_at>=start_ts and applied_at<end_ts),
    (select count(*) from public.commerce_gsc_action_measurements where measured_at>=start_ts and measured_at<end_ts),
    (select count(*) from public.commerce_gsc_action_measurements where verdict='IMPROVED' and measured_at>=start_ts and measured_at<end_ts),
    (select count(*) from public.commerce_merchant_account_issues where resolved_at is null),
    (select count(*) from public.one_integrity_issues_v),
    jsonb_build_object('timezone','Asia/Bangkok','capturedBy','scheduled_measurement_v1')
  )
  on conflict(snapshot_date) do update set
    captured_at=excluded.captured_at,
    live_products=excluded.live_products,
    shop_orders=excluded.shop_orders,
    shop_paid_orders=excluded.shop_paid_orders,
    shop_completed_orders=excluded.shop_completed_orders,
    shop_revenue=excluded.shop_revenue,
    facebook_posts=excluded.facebook_posts,
    distribution_open_critical=excluded.distribution_open_critical,
    distribution_open_warning=excluded.distribution_open_warning,
    ai_pricing_decisions=excluded.ai_pricing_decisions,
    ai_offers=excluded.ai_offers,
    ai_final_outcomes=excluded.ai_final_outcomes,
    ai_purchases=excluded.ai_purchases,
    ai_realized_gross_profit=excluded.ai_realized_gross_profit,
    seo_executions=excluded.seo_executions,
    seo_measurements=excluded.seo_measurements,
    seo_improved=excluded.seo_improved,
    merchant_unresolved_issues=excluded.merchant_unresolved_issues,
    one_integrity_issue_count=excluded.one_integrity_issue_count,
    metadata=excluded.metadata
  returning * into result;
  return result;
end;
$$;

revoke execute on function public.capture_business_growth_daily(date) from public, anon, authenticated;
grant execute on function public.capture_business_growth_daily(date) to service_role;

create or replace view public.business_growth_30d_v
with (security_invoker=true)
as
select *
from public.business_growth_daily
where snapshot_date >= timezone('Asia/Bangkok',now())::date - 29
order by snapshot_date desc;

revoke all on public.business_growth_30d_v from anon, authenticated;
grant select on public.business_growth_30d_v to service_role;

select cron.unschedule(jobid) from cron.job where jobname='business-growth-daily';
select cron.schedule(
  'business-growth-daily',
  '15 17 * * *',
  $cron$select public.capture_business_growth_daily((timezone('Asia/Bangkok',now())::date - 1));$cron$
);

select public.ai_buyer_close_stale_outcomes();
select public.capture_business_growth_daily(timezone('Asia/Bangkok',now())::date);
