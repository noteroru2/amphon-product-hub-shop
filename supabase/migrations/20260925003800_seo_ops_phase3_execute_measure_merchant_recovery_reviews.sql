-- SEO Ops Phase 3 — Execute/Measure, Merchant diagnostics, Recovery, Verified Reviews
-- Applied to production on 2026-09-25. Safe to re-run.

-- ============================================================
-- ① GSC ACTION EXECUTE / MEASURE LOOP
-- ============================================================

create table if not exists public.commerce_gsc_action_executions (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.commerce_gsc_action_queue(id) on delete cascade,
  execution_kind text not null check (execution_kind in ('INTERNAL_LINK','META','RECOVERY','OTHER')),
  repository text,
  pull_request_number integer,
  commit_sha text,
  live_url text,
  applied_at timestamptz not null default now(),
  baseline_clicks numeric not null default 0,
  baseline_impressions numeric not null default 0,
  baseline_ctr numeric not null default 0,
  baseline_position numeric not null default 0,
  baseline_fetched_at timestamptz,
  monitor_status text not null default 'MONITORING'
    check (monitor_status in ('MONITORING','ROLLBACK_REVIEW','COMPLETE','STOPPED')),
  last_measured_at timestamptz,
  rollback_review_reason text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists commerce_gsc_action_executions_action_idx
  on public.commerce_gsc_action_executions(action_id, applied_at desc);
create index if not exists commerce_gsc_action_executions_monitor_idx
  on public.commerce_gsc_action_executions(monitor_status, applied_at);

alter table public.commerce_gsc_action_executions enable row level security;
drop policy if exists commerce_gsc_action_executions_read_admin on public.commerce_gsc_action_executions;
create policy commerce_gsc_action_executions_read_admin
on public.commerce_gsc_action_executions
for select to authenticated
using (public.current_user_role() in ('owner','admin'));
revoke all on public.commerce_gsc_action_executions from anon;
revoke insert, update, delete on public.commerce_gsc_action_executions from authenticated;
grant select on public.commerce_gsc_action_executions to authenticated;
grant select, insert, update, delete on public.commerce_gsc_action_executions to service_role;

create table if not exists public.commerce_gsc_action_measurements (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.commerce_gsc_action_executions(id) on delete cascade,
  checkpoint_days integer not null check (checkpoint_days in (7,14,28)),
  measured_at timestamptz not null default now(),
  clicks numeric not null default 0,
  impressions numeric not null default 0,
  ctr numeric not null default 0,
  position numeric not null default 0,
  clicks_delta numeric not null default 0,
  impressions_delta numeric not null default 0,
  ctr_delta numeric not null default 0,
  position_delta numeric not null default 0,
  verdict text not null check (verdict in ('IMPROVED','NEUTRAL','REGRESSED','INSUFFICIENT_DATA')),
  rollback_recommended boolean not null default false,
  source_fetched_at timestamptz,
  created_at timestamptz not null default now(),
  unique(execution_id, checkpoint_days)
);

alter table public.commerce_gsc_action_measurements enable row level security;
drop policy if exists commerce_gsc_action_measurements_read_admin on public.commerce_gsc_action_measurements;
create policy commerce_gsc_action_measurements_read_admin
on public.commerce_gsc_action_measurements
for select to authenticated
using (
  public.current_user_role() in ('owner','admin')
  and exists (
    select 1 from public.commerce_gsc_action_executions e
    where e.id = execution_id
  )
);
revoke all on public.commerce_gsc_action_measurements from anon;
revoke insert, update, delete on public.commerce_gsc_action_measurements from authenticated;
grant select on public.commerce_gsc_action_measurements to authenticated;
grant select, insert, update, delete on public.commerce_gsc_action_measurements to service_role;

create or replace function private.record_gsc_action_execution(
  p_action_id uuid,
  p_execution_kind text,
  p_repository text default null,
  p_pull_request_number integer default null,
  p_commit_sha text default null,
  p_live_url text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.commerce_gsc_action_queue;
  v_id uuid;
  v_fetched timestamptz;
begin
  select * into a
  from public.commerce_gsc_action_queue
  where id=p_action_id;

  if a.id is null then
    raise exception 'GSC_ACTION_NOT_FOUND';
  end if;

  if p_execution_kind not in ('INTERNAL_LINK','META','RECOVERY','OTHER') then
    raise exception 'INVALID_EXECUTION_KIND';
  end if;

  select max(d.fetched_at) into v_fetched
  from public.commerce_gsc_query_demand d
  where d.property=a.property
    and d.page=a.page
    and d.window_days=28;

  insert into public.commerce_gsc_action_executions(
    action_id,execution_kind,repository,pull_request_number,commit_sha,live_url,
    applied_at,baseline_clicks,baseline_impressions,baseline_ctr,baseline_position,
    baseline_fetched_at,notes
  ) values (
    a.id,p_execution_kind,p_repository,p_pull_request_number,p_commit_sha,coalesce(p_live_url,a.page),
    now(),a.clicks,a.impressions,a.ctr,a.position,v_fetched,p_notes
  )
  returning id into v_id;

  update public.commerce_gsc_action_queue
  set status='APPLIED',resolved_at=now(),updated_at=now()
  where id=a.id;

  return v_id;
end;
$$;

revoke all on function private.record_gsc_action_execution(uuid,text,text,integer,text,text,text) from public;
revoke all on function private.record_gsc_action_execution(uuid,text,text,integer,text,text,text) from anon;
revoke all on function private.record_gsc_action_execution(uuid,text,text,integer,text,text,text) from authenticated;
grant execute on function private.record_gsc_action_execution(uuid,text,text,integer,text,text,text) to service_role;

create or replace function private.refresh_gsc_action_measurements()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  v_checkpoint integer;
  v_clicks numeric;
  v_impressions numeric;
  v_ctr numeric;
  v_position numeric;
  v_fetched timestamptz;
  v_verdict text;
  v_rollback boolean;
begin
  for e in
    select
      x.*,
      a.property,a.page,a.primary_query,a.opportunity_type,a.action_type
    from public.commerce_gsc_action_executions x
    join public.commerce_gsc_action_queue a on a.id=x.action_id
    where x.monitor_status in ('MONITORING','ROLLBACK_REVIEW')
      and x.applied_at <= now() - interval '7 days'
    order by x.applied_at
  loop
    v_checkpoint := null;
    if e.applied_at <= now() - interval '28 days'
       and not exists(select 1 from public.commerce_gsc_action_measurements m where m.execution_id=e.id and m.checkpoint_days=28) then
      v_checkpoint := 28;
    elsif e.applied_at <= now() - interval '14 days'
       and not exists(select 1 from public.commerce_gsc_action_measurements m where m.execution_id=e.id and m.checkpoint_days=14) then
      v_checkpoint := 14;
    elsif e.applied_at <= now() - interval '7 days'
       and not exists(select 1 from public.commerce_gsc_action_measurements m where m.execution_id=e.id and m.checkpoint_days=7) then
      v_checkpoint := 7;
    end if;

    if v_checkpoint is null then
      continue;
    end if;

    select
      coalesce(sum(o.clicks),0),
      coalesce(sum(o.impressions),0),
      case when coalesce(sum(o.impressions),0)>0 then sum(o.clicks)/sum(o.impressions) else 0 end,
      case when coalesce(sum(o.impressions),0)>0 then sum(o.position*o.impressions)/sum(o.impressions) else 0 end,
      max(o.fetched_at)
    into v_clicks,v_impressions,v_ctr,v_position,v_fetched
    from public.commerce_gsc_opportunity_v o
    where o.property=e.property
      and o.page=e.page
      and o.opportunity_type=e.opportunity_type
      and o.fetched_at >= now() - interval '3 days';

    if v_fetched is null or v_impressions < 10 then
      v_verdict := 'INSUFFICIENT_DATA';
      v_rollback := false;
    elsif
      (v_position <= e.baseline_position - 0.5 and v_ctr >= e.baseline_ctr * 0.85)
      or
      (v_ctr >= greatest(e.baseline_ctr * 1.15, e.baseline_ctr + 0.005)
       and v_position <= e.baseline_position + 0.75)
    then
      v_verdict := 'IMPROVED';
      v_rollback := false;
    elsif
      (v_position >= e.baseline_position + 1.0 and v_ctr <= e.baseline_ctr * 1.10)
      or
      (e.baseline_ctr > 0
       and v_ctr <= e.baseline_ctr * 0.75
       and v_impressions >= 20
       and v_position >= e.baseline_position - 0.25)
    then
      v_verdict := 'REGRESSED';
      v_rollback := e.action_type not in ('PROTECT_PAGE','BRAND_WATCH');
    else
      v_verdict := 'NEUTRAL';
      v_rollback := false;
    end if;

    insert into public.commerce_gsc_action_measurements(
      execution_id,checkpoint_days,measured_at,
      clicks,impressions,ctr,position,
      clicks_delta,impressions_delta,ctr_delta,position_delta,
      verdict,rollback_recommended,source_fetched_at
    ) values (
      e.id,v_checkpoint,now(),
      v_clicks,v_impressions,v_ctr,v_position,
      v_clicks-e.baseline_clicks,
      v_impressions-e.baseline_impressions,
      v_ctr-e.baseline_ctr,
      v_position-e.baseline_position,
      v_verdict,v_rollback,v_fetched
    )
    on conflict (execution_id,checkpoint_days) do nothing;

    update public.commerce_gsc_action_executions
    set
      last_measured_at=now(),
      monitor_status=case
        when v_rollback then 'ROLLBACK_REVIEW'
        when v_checkpoint=28 and v_verdict <> 'INSUFFICIENT_DATA' then 'COMPLETE'
        else 'MONITORING'
      end,
      rollback_review_reason=case
        when v_rollback then
          'GSC checkpoint '||v_checkpoint||'d regressed vs baseline; review the exact deployed patch before any rollback.'
        else rollback_review_reason
      end
    where id=e.id;
  end loop;
end;
$$;

revoke all on function private.refresh_gsc_action_measurements() from public;
revoke all on function private.refresh_gsc_action_measurements() from anon;
revoke all on function private.refresh_gsc_action_measurements() from authenticated;
grant execute on function private.refresh_gsc_action_measurements() to service_role;

insert into public.commerce_gsc_action_executions(
  action_id,execution_kind,live_url,applied_at,
  baseline_clicks,baseline_impressions,baseline_ctr,baseline_position,
  baseline_fetched_at,notes
)
select
  a.id,
  case
    when a.action_type='INTERNAL_LINK_BOOST' then 'INTERNAL_LINK'
    when a.action_type='META_REVIEW' then 'META'
    when a.action_type='RECOVERY_PLAN' then 'RECOVERY'
    else 'OTHER'
  end,
  a.page,
  coalesce(a.resolved_at,a.updated_at),
  a.clicks,a.impressions,a.ctr,a.position,
  (select max(d.fetched_at) from public.commerce_gsc_query_demand d
   where d.property=a.property and d.page=a.page and d.window_days=28),
  'Bootstrapped from pre-measurement APPLIED action'
from public.commerce_gsc_action_queue a
where a.status='APPLIED'
  and not exists (
    select 1 from public.commerce_gsc_action_executions e where e.action_id=a.id
  );

-- ============================================================
-- ④ RECOVERY ENGINE
-- ============================================================

create table if not exists public.commerce_gsc_recovery_diagnostics (
  action_id uuid primary key references public.commerce_gsc_action_queue(id) on delete cascade,
  diagnosis_type text not null,
  competing_page_count integer not null default 0,
  leader_page text,
  leader_impressions numeric not null default 0,
  total_query_impressions numeric not null default 0,
  current_page_impressions numeric not null default 0,
  current_share numeric not null default 0,
  leader_share numeric not null default 0,
  auto_safe_internal_link boolean not null default false,
  requires_human_review boolean not null default true,
  recommended_checks text not null,
  checked_at timestamptz not null default now()
);

alter table public.commerce_gsc_recovery_diagnostics enable row level security;
drop policy if exists commerce_gsc_recovery_diagnostics_read_admin on public.commerce_gsc_recovery_diagnostics;
create policy commerce_gsc_recovery_diagnostics_read_admin
on public.commerce_gsc_recovery_diagnostics
for select to authenticated
using (public.current_user_role() in ('owner','admin'));
revoke all on public.commerce_gsc_recovery_diagnostics from anon;
revoke insert,update,delete on public.commerce_gsc_recovery_diagnostics from authenticated;
grant select on public.commerce_gsc_recovery_diagnostics to authenticated;
grant select,insert,update,delete on public.commerce_gsc_recovery_diagnostics to service_role;

create or replace function private.refresh_gsc_recovery_diagnostics()
returns void
language sql
security definer
set search_path = ''
as $$
insert into public.commerce_gsc_recovery_diagnostics(
  action_id,diagnosis_type,competing_page_count,leader_page,leader_impressions,
  total_query_impressions,current_page_impressions,current_share,leader_share,
  auto_safe_internal_link,requires_human_review,recommended_checks,checked_at
)
with actions as (
  select *
  from public.commerce_gsc_action_queue
  where status in ('OPEN','APPROVED','APPLIED')
    and action_type in ('INTERNAL_LINK_BOOST','RECOVERY_PLAN','META_REVIEW')
),
fresh as (
  select d.property,d.query,d.page,d.impressions,d.clicks,d.ctr,d.position,d.fetched_at
  from public.commerce_gsc_query_demand d
  where d.window_days=28
    and d.fetched_at >= now() - interval '3 days'
),
stats as (
  select
    a.id action_id,
    a.action_type,
    a.page action_page,
    a.primary_query,
    a.position action_position,
    a.ctr action_ctr,
    count(distinct f.page)::int competing_page_count,
    coalesce(sum(f.impressions),0)::numeric total_impressions,
    coalesce(sum(f.impressions) filter(where f.page=a.page),0)::numeric current_impressions
  from actions a
  left join fresh f
    on f.property=a.property
   and lower(f.query)=lower(a.primary_query)
  group by a.id,a.action_type,a.page,a.primary_query,a.position,a.ctr
),
leader as (
  select distinct on (a.id)
    a.id action_id,
    f.page leader_page,
    f.impressions leader_impressions
  from actions a
  join fresh f
    on f.property=a.property
   and lower(f.query)=lower(a.primary_query)
  order by a.id,f.impressions desc,f.clicks desc,f.page
)
select
  s.action_id,
  case
    when s.competing_page_count >= 2
      and coalesce(l.leader_page,'') <> s.action_page
      and s.total_impressions > 0
      and s.current_impressions / s.total_impressions < 0.60
      then 'OWNER_COMPETITION'
    when s.competing_page_count >= 2
      and s.total_impressions > 0
      and coalesce(l.leader_impressions,0) / s.total_impressions < 0.75
      then 'CANNIBALIZATION'
    when s.action_position > 15
      then 'AUTHORITY_OR_COVERAGE_GAP'
    when s.action_position <= 10 and s.action_ctr < 0.03
      then 'SNIPPET_OR_INTENT_GAP'
    else 'INTERNAL_AUTHORITY_GAP'
  end,
  s.competing_page_count,
  l.leader_page,
  coalesce(l.leader_impressions,0),
  s.total_impressions,
  s.current_impressions,
  case when s.total_impressions>0 then s.current_impressions/s.total_impressions else 0 end,
  case when s.total_impressions>0 then coalesce(l.leader_impressions,0)/s.total_impressions else 0 end,
  case
    when s.action_type='INTERNAL_LINK_BOOST'
     and s.competing_page_count <= 1
     and s.action_position > 5
     and s.action_position <= 15
     then true
    else false
  end,
  case
    when s.competing_page_count >= 2 then true
    when s.action_type='RECOVERY_PLAN' then true
    else false
  end,
  case
    when s.competing_page_count >= 2
      and coalesce(l.leader_page,'') <> s.action_page
      then 'Compare Query×Page ownership, inspect whether the competing URL is a better intent owner, and avoid adding authority until ownership is resolved.'
    when s.competing_page_count >= 2
      then 'Inspect cannibalization, anchor distribution and overlapping sections before consolidating or adding links.'
    when s.action_position > 15
      then 'Check query coverage, content freshness, evidence depth and internal authority; keep the current URL owner unless evidence supports a different owner.'
    when s.action_position <= 10 and s.action_ctr < 0.03
      then 'Inspect title/description and intent fit; do not rewrite automatically while ranking is already on page one.'
    else 'Use a small contextual internal-link boost from relevant pages; do not alter URL, canonical or H1.'
  end,
  now()
from stats s
left join leader l using(action_id)
on conflict (action_id) do update set
  diagnosis_type=excluded.diagnosis_type,
  competing_page_count=excluded.competing_page_count,
  leader_page=excluded.leader_page,
  leader_impressions=excluded.leader_impressions,
  total_query_impressions=excluded.total_query_impressions,
  current_page_impressions=excluded.current_page_impressions,
  current_share=excluded.current_share,
  leader_share=excluded.leader_share,
  auto_safe_internal_link=excluded.auto_safe_internal_link,
  requires_human_review=excluded.requires_human_review,
  recommended_checks=excluded.recommended_checks,
  checked_at=now();
$$;

revoke all on function private.refresh_gsc_recovery_diagnostics() from public;
revoke all on function private.refresh_gsc_recovery_diagnostics() from anon;
revoke all on function private.refresh_gsc_recovery_diagnostics() from authenticated;
grant execute on function private.refresh_gsc_recovery_diagnostics() to service_role;

select private.refresh_gsc_recovery_diagnostics();

-- ============================================================
-- ② MERCHANT DIAGNOSTICS
-- ============================================================

create table if not exists public.commerce_merchant_feed_diagnostics (
  product_id uuid primary key references public.products(id) on delete cascade,
  sku text,
  title text not null,
  feed_eligible boolean not null default false,
  severity text not null check (severity in ('PASS','WARNING','ERROR','EXCLUDED')),
  issue_codes text[] not null default '{}'::text[],
  image_count integer not null default 0,
  cover_width integer,
  cover_height integer,
  price numeric,
  product_status text,
  index_policy text,
  merchant_enabled boolean not null default false,
  checked_at timestamptz not null default now()
);

alter table public.commerce_merchant_feed_diagnostics enable row level security;
drop policy if exists commerce_merchant_feed_diagnostics_read_admin on public.commerce_merchant_feed_diagnostics;
create policy commerce_merchant_feed_diagnostics_read_admin
on public.commerce_merchant_feed_diagnostics
for select to authenticated
using (public.current_user_role() in ('owner','admin'));
revoke all on public.commerce_merchant_feed_diagnostics from anon;
revoke insert,update,delete on public.commerce_merchant_feed_diagnostics from authenticated;
grant select on public.commerce_merchant_feed_diagnostics to authenticated;
grant select,insert,update,delete on public.commerce_merchant_feed_diagnostics to service_role;

create table if not exists public.commerce_merchant_account_issues (
  id uuid primary key default gen_random_uuid(),
  merchant_account_id text,
  item_id text,
  sku text,
  issue_code text not null,
  severity text not null check (severity in ('INFO','WARNING','ERROR')),
  issue_title text not null,
  issue_detail text,
  destination text,
  source text not null default 'GOOGLE_MERCHANT',
  observed_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(source,issue_code,item_id,destination)
);

alter table public.commerce_merchant_account_issues enable row level security;
drop policy if exists commerce_merchant_account_issues_read_admin on public.commerce_merchant_account_issues;
create policy commerce_merchant_account_issues_read_admin
on public.commerce_merchant_account_issues
for select to authenticated
using (public.current_user_role() in ('owner','admin'));
revoke all on public.commerce_merchant_account_issues from anon;
revoke insert,update,delete on public.commerce_merchant_account_issues from authenticated;
grant select on public.commerce_merchant_account_issues to authenticated;
grant select,insert,update,delete on public.commerce_merchant_account_issues to service_role;

create table if not exists public.commerce_merchant_sync_state (
  id smallint primary key default 1 check (id=1),
  connector text not null default 'google_merchant',
  connected boolean not null default false,
  merchant_account_id text,
  last_synced_at timestamptz,
  status_message text,
  updated_at timestamptz not null default now()
);

alter table public.commerce_merchant_sync_state enable row level security;
drop policy if exists commerce_merchant_sync_state_read_admin on public.commerce_merchant_sync_state;
create policy commerce_merchant_sync_state_read_admin
on public.commerce_merchant_sync_state
for select to authenticated
using (public.current_user_role() in ('owner','admin'));
revoke all on public.commerce_merchant_sync_state from anon;
revoke insert,update,delete on public.commerce_merchant_sync_state from authenticated;
grant select on public.commerce_merchant_sync_state to authenticated;
grant select,insert,update,delete on public.commerce_merchant_sync_state to service_role;

insert into public.commerce_merchant_sync_state(id,connected,status_message)
values (1,false,'Google Merchant account diagnostics connector is not connected yet; local feed diagnostics remain active.')
on conflict (id) do nothing;

create or replace function private.refresh_merchant_feed_diagnostics()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.commerce_merchant_feed_diagnostics(
    product_id,sku,title,feed_eligible,severity,issue_codes,
    image_count,cover_width,cover_height,price,product_status,index_policy,
    merchant_enabled,checked_at
  )
  select
    l.product_id,
    l.sku,
    l.title,
    (
      l.status in ('published','reserved')
      and l.index_policy='INDEX'
      and l.merchant_enabled
      and coalesce(l.price,0)>0
      and coalesce(img.image_count,0)>0
    ) as feed_eligible,
    case
      when l.status not in ('published','reserved') or l.index_policy <> 'INDEX' or not l.merchant_enabled
        then 'EXCLUDED'
      when coalesce(l.price,0)<=0 or coalesce(img.image_count,0)=0
        then 'ERROR'
      when img.cover_width is not null and img.cover_height is not null and least(img.cover_width,img.cover_height) < 500
        then 'WARNING'
      else 'PASS'
    end,
    array_remove(array[
      case when l.status not in ('published','reserved') then 'NOT_SELLABLE' end,
      case when l.index_policy <> 'INDEX' then 'NOT_INDEX' end,
      case when not l.merchant_enabled then 'MERCHANT_DISABLED' end,
      case when coalesce(l.price,0)<=0 then 'INVALID_PRICE' end,
      case when coalesce(img.image_count,0)=0 then 'MISSING_IMAGE' end,
      case when coalesce(img.image_count,0)>0 and (img.cover_width is null or img.cover_height is null) then 'IMAGE_DIMENSION_UNKNOWN_INFO' end,
      case when img.cover_width is not null and img.cover_height is not null and least(img.cover_width,img.cover_height) < 500 then 'IMAGE_UNDER_500_UPCOMING' end
    ],null),
    coalesce(img.image_count,0),
    img.cover_width,
    img.cover_height,
    l.price,
    l.status,
    l.index_policy,
    l.merchant_enabled,
    now()
  from public.commerce_public_listing_v l
  left join lateral (
    select
      count(*)::int image_count,
      max(pi.width) filter(where pi.is_cover) cover_width,
      max(pi.height) filter(where pi.is_cover) cover_height
    from public.product_images pi
    where pi.product_id=l.product_id
      and nullif(btrim(coalesce(pi.public_url,'')),'') is not null
  ) img on true
  on conflict (product_id) do update set
    sku=excluded.sku,
    title=excluded.title,
    feed_eligible=excluded.feed_eligible,
    severity=excluded.severity,
    issue_codes=excluded.issue_codes,
    image_count=excluded.image_count,
    cover_width=excluded.cover_width,
    cover_height=excluded.cover_height,
    price=excluded.price,
    product_status=excluded.product_status,
    index_policy=excluded.index_policy,
    merchant_enabled=excluded.merchant_enabled,
    checked_at=now();

  delete from public.commerce_merchant_feed_diagnostics d
  where not exists (
    select 1 from public.commerce_public_listing_v l where l.product_id=d.product_id
  );
end;
$$;

revoke all on function private.refresh_merchant_feed_diagnostics() from public;
revoke all on function private.refresh_merchant_feed_diagnostics() from anon;
revoke all on function private.refresh_merchant_feed_diagnostics() from authenticated;
grant execute on function private.refresh_merchant_feed_diagnostics() to service_role;

update public.commerce_store_settings
set
  shipping_policy_url=coalesce(nullif(shipping_policy_url,''),'https://shop.amphon.co.th/shipping/'),
  return_policy_url=coalesce(nullif(return_policy_url,''),'https://shop.amphon.co.th/returns/'),
  warranty_policy_url=coalesce(nullif(warranty_policy_url,''),'https://shop.amphon.co.th/warranty/'),
  updated_at=now()
where id=1;

select private.refresh_merchant_feed_diagnostics();

-- ============================================================
-- ⑤ VERIFIED TRUST / REVIEW LAYER
-- ============================================================

create table if not exists public.commerce_review_invites (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  public_token uuid not null default gen_random_uuid() unique,
  expires_at timestamptz not null default (now() + interval '180 days'),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_id,product_id)
);

alter table public.commerce_review_invites enable row level security;
drop policy if exists commerce_review_invites_read_admin on public.commerce_review_invites;
create policy commerce_review_invites_read_admin
on public.commerce_review_invites
for select to authenticated
using (public.current_user_role() in ('owner','admin'));
revoke all on public.commerce_review_invites from anon;
revoke insert,update,delete on public.commerce_review_invites from authenticated;
grant select on public.commerce_review_invites to authenticated;
grant select,insert,update,delete on public.commerce_review_invites to service_role;

create table if not exists public.commerce_customer_reviews (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null unique references public.commerce_review_invites(id) on delete restrict,
  order_id uuid not null references public.commerce_orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  title text,
  body text not null,
  display_name text not null,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  verification_method text not null default 'ORDER' check (verification_method in ('ORDER')),
  submitted_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references auth.users(id) on delete set null,
  moderation_note text,
  updated_at timestamptz not null default now()
);

create index if not exists commerce_customer_reviews_status_idx
  on public.commerce_customer_reviews(status,submitted_at desc);
create index if not exists commerce_customer_reviews_product_idx
  on public.commerce_customer_reviews(product_id,status,submitted_at desc);
create index if not exists commerce_review_invites_product_idx
  on public.commerce_review_invites(product_id);
create index if not exists commerce_customer_reviews_order_idx
  on public.commerce_customer_reviews(order_id);
create index if not exists commerce_customer_reviews_moderated_by_idx
  on public.commerce_customer_reviews(moderated_by);

alter table public.commerce_customer_reviews enable row level security;
drop policy if exists commerce_customer_reviews_read_admin on public.commerce_customer_reviews;
create policy commerce_customer_reviews_read_admin
on public.commerce_customer_reviews
for select to authenticated
using (public.current_user_role() in ('owner','admin'));
revoke all on public.commerce_customer_reviews from anon;
revoke insert,update,delete on public.commerce_customer_reviews from authenticated;
grant select on public.commerce_customer_reviews to authenticated;
grant select,insert,update,delete on public.commerce_customer_reviews to service_role;

create or replace function private.ensure_commerce_review_invites()
returns void
language sql
security definer
set search_path = ''
as $$
insert into public.commerce_review_invites(order_id,product_id,expires_at)
select
  o.id,
  i.product_id,
  greatest(coalesce(o.completed_at,now()),now()) + interval '180 days'
from public.commerce_orders o
join public.commerce_order_items i on i.order_id=o.id
where o.completed_at is not null
  and o.paid_at is not null
  and o.order_status not in ('CANCELLED','EXPIRED')
on conflict (order_id,product_id) do nothing;
$$;

revoke all on function private.ensure_commerce_review_invites() from public,anon,authenticated;
grant execute on function private.ensure_commerce_review_invites() to service_role;

create or replace function public.resolve_review_invite(p_token uuid)
returns table(
  valid boolean,
  product_title text,
  product_sku text,
  expires_at timestamptz,
  already_used boolean
)
language sql
security definer
set search_path = ''
as $$
select
  (
    i.id is not null
    and i.used_at is null
    and i.expires_at > now()
    and o.completed_at is not null
    and o.paid_at is not null
  ) as valid,
  p.title,
  p.sku,
  i.expires_at,
  (i.used_at is not null)
from public.commerce_review_invites i
join public.commerce_orders o on o.id=i.order_id
join public.products p on p.id=i.product_id
where i.public_token=p_token
limit 1;
$$;

revoke all on function public.resolve_review_invite(uuid) from public;
revoke all on function public.resolve_review_invite(uuid) from anon;
revoke all on function public.resolve_review_invite(uuid) from authenticated;
grant execute on function public.resolve_review_invite(uuid) to service_role;

create or replace function public.submit_verified_review(
  p_token uuid,
  p_rating integer,
  p_title text,
  p_body text,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.commerce_review_invites;
  ord public.commerce_orders;
  v_id uuid;
  v_title text;
  v_body text;
  v_name text;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'INVALID_REVIEW_RATING';
  end if;

  v_title := nullif(left(btrim(coalesce(p_title,'')),120),'');
  v_body := left(btrim(coalesce(p_body,'')),2000);
  v_name := left(btrim(coalesce(p_display_name,'')),80);

  if length(v_body) < 10 then
    raise exception 'REVIEW_BODY_TOO_SHORT';
  end if;
  if length(v_name) < 1 then
    raise exception 'REVIEW_DISPLAY_NAME_REQUIRED';
  end if;

  select * into inv
  from public.commerce_review_invites
  where public_token=p_token
  for update;

  if inv.id is null then
    raise exception 'REVIEW_INVITE_INVALID';
  end if;
  if inv.used_at is not null then
    raise exception 'REVIEW_INVITE_USED';
  end if;
  if inv.expires_at <= now() then
    raise exception 'REVIEW_INVITE_EXPIRED';
  end if;

  select * into ord
  from public.commerce_orders
  where id=inv.order_id;

  if ord.completed_at is null or ord.paid_at is null or ord.order_status in ('CANCELLED','EXPIRED') then
    raise exception 'REVIEW_ORDER_NOT_ELIGIBLE';
  end if;

  insert into public.commerce_customer_reviews(
    invite_id,order_id,product_id,rating,title,body,display_name,status,verification_method
  ) values (
    inv.id,inv.order_id,inv.product_id,p_rating,v_title,v_body,v_name,'PENDING','ORDER'
  )
  returning id into v_id;

  update public.commerce_review_invites
  set used_at=now()
  where id=inv.id;

  return v_id;
end;
$$;

revoke all on function public.submit_verified_review(uuid,integer,text,text,text) from public;
revoke all on function public.submit_verified_review(uuid,integer,text,text,text) from anon;
revoke all on function public.submit_verified_review(uuid,integer,text,text,text) from authenticated;
grant execute on function public.submit_verified_review(uuid,integer,text,text,text) to service_role;

create or replace function public.moderate_verified_review(
  p_review_id uuid,
  p_status text,
  p_note text default null
)
returns public.commerce_customer_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.commerce_customer_reviews;
begin
  if public.current_user_role() not in ('owner','admin') then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if p_status not in ('APPROVED','REJECTED') then
    raise exception 'INVALID_REVIEW_STATUS';
  end if;

  update public.commerce_customer_reviews
  set
    status=p_status,
    moderated_at=now(),
    moderated_by=auth.uid(),
    moderation_note=nullif(left(btrim(coalesce(p_note,'')),500),''),
    updated_at=now()
  where id=p_review_id
  returning * into r;

  if r.id is null then
    raise exception 'REVIEW_NOT_FOUND';
  end if;
  return r;
end;
$$;

revoke all on function public.moderate_verified_review(uuid,text,text) from public,anon;
grant execute on function public.moderate_verified_review(uuid,text,text) to authenticated,service_role;

create or replace view public.commerce_public_reviews_v
with (security_invoker=true)
as
select
  r.id,
  r.product_id,
  p.sku,
  p.title as product_title,
  r.rating,
  r.title,
  r.body,
  r.display_name,
  true as verified_purchase,
  r.submitted_at,
  r.moderated_at
from public.commerce_customer_reviews r
join public.products p on p.id=r.product_id
where r.status='APPROVED';

revoke all on public.commerce_public_reviews_v from anon,authenticated;
grant select on public.commerce_public_reviews_v to service_role;

create or replace view public.commerce_review_admin_v
with (security_invoker=true)
as
select
  i.id invite_id,
  i.public_token,
  i.order_id,
  i.product_id,
  p.sku,
  p.title product_title,
  i.expires_at,
  i.used_at,
  i.created_at invite_created_at,
  r.id review_id,
  r.rating,
  r.title review_title,
  r.body review_body,
  r.display_name,
  r.status review_status,
  r.submitted_at,
  r.moderated_at,
  r.moderation_note
from public.commerce_review_invites i
join public.products p on p.id=i.product_id
left join public.commerce_customer_reviews r on r.invite_id=i.id;

grant select on public.commerce_review_admin_v to authenticated,service_role;

select private.ensure_commerce_review_invites();

-- ============================================================
-- Shared 15-minute refresh loop
-- ============================================================

do $$
declare existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname='commerce-seo-governance-15m'
  limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end $$;

select cron.schedule(
  'commerce-seo-governance-15m',
  '*/15 * * * *',
  'select private.sync_commerce_model_longtails(); select private.apply_commerce_seo_governance(); select private.refresh_commerce_spec_pages(); select private.refresh_commerce_gsc_action_queue(); select private.refresh_gsc_recovery_diagnostics(); select private.refresh_merchant_feed_diagnostics(); select private.ensure_commerce_review_invites(); select private.refresh_gsc_action_measurements();'
);
