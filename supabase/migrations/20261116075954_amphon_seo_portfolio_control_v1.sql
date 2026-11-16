-- Existing applied migration captured verbatim from Supabase on 2026-11-16.

-- AMPHON SEO Portfolio Control v1; additive only. Existing SEO tables remain authoritative.
create table if not exists public.commerce_seo_portfolio_projects (
  site_id text primary key references public.commerce_seo_sites(id) on delete restrict,
  repo_candidates text[] not null default '{}',
  production_repo text,
  production_branch text,
  hosting_provider text not null default 'UNKNOWN',
  hosting_project_id text,
  mapping_status text not null default 'UNVERIFIED'
    check(mapping_status in ('UNVERIFIED','CANDIDATE','MULTIPLE_CANDIDATES','VERIFIED')),
  mapping_evidence text not null default '',
  central_deploy_allowed boolean not null default false check(central_deploy_allowed=false),
  updated_at timestamptz not null default now(),
  check(production_repo is null or production_repo = any(repo_candidates))
);
create index if not exists seo_portfolio_projects_status_idx on public.commerce_seo_portfolio_projects(mapping_status);
alter table public.commerce_seo_portfolio_projects enable row level security;
revoke all on table public.commerce_seo_portfolio_projects from public, anon, authenticated;
grant select,insert,update,delete on table public.commerce_seo_portfolio_projects to service_role;

create table if not exists public.commerce_seo_portfolio_keyword_roles (
  keyword text not null,
  site_id text not null references public.commerce_seo_sites(id) on delete restrict,
  role text not null check(role in ('PRIMARY','SUPPORTING','LOCAL','COMMERCE')),
  intent text not null default 'SELL_TO_STORE',
  target_page text,
  approval_status text not null default 'PROPOSED'
    check(approval_status in ('PROPOSED','APPROVED','REJECTED')),
  distinct_value text not null default '',
  source text not null default 'LEGACY_SEO_HUB',
  updated_at timestamptz not null default now(),
  primary key(keyword,site_id,role)
);
create unique index if not exists seo_portfolio_approved_primary_idx
  on public.commerce_seo_portfolio_keyword_roles(lower(btrim(keyword)))
  where role='PRIMARY' and approval_status='APPROVED';
alter table public.commerce_seo_portfolio_keyword_roles enable row level security;
revoke all on table public.commerce_seo_portfolio_keyword_roles from public, anon, authenticated;
grant select,insert,update,delete on table public.commerce_seo_portfolio_keyword_roles to service_role;

create table if not exists public.commerce_seo_portfolio_release_events (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.commerce_seo_sites(id) on delete restrict,
  repository text not null,
  commit_sha text not null default '',
  environment text not null default 'UNKNOWN'
    check(environment in ('UNKNOWN','PREVIEW','STAGING','PRODUCTION')),
  event_kind text not null check(event_kind in
    ('COMMIT_OBSERVED','DEPLOY_REQUESTED','DEPLOY_SUCCEEDED','DEPLOY_FAILED','PRODUCTION_VERIFIED','ROLLBACK_VERIFIED')),
  provider text not null default 'GITHUB',
  external_event_id text not null,
  event_at timestamptz not null,
  qa_status text not null default 'NOT_VERIFIED'
    check(qa_status in ('NOT_VERIFIED','PASSED','FAILED')),
  affected_urls jsonb not null default '[]'::jsonb check(jsonb_typeof(affected_urls)='array'),
  evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence)='object'),
  received_at timestamptz not null default now(),
  unique(provider,external_event_id,event_kind)
);
create index if not exists seo_portfolio_release_site_time_idx
 on public.commerce_seo_portfolio_release_events(site_id,event_at desc);
alter table public.commerce_seo_portfolio_release_events enable row level security;
revoke all on table public.commerce_seo_portfolio_release_events from public,anon,authenticated;
grant select,insert,update,delete on table public.commerce_seo_portfolio_release_events to service_role;

create table if not exists public.commerce_seo_portfolio_attributions (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.commerce_seo_sites(id) on delete restrict,
  contact_event_id uuid references public.commerce_seo_contact_events(id) on delete restrict,
  lead_reference text,
  ai_buyer_case_id uuid references public.ai_buyer_valuation_cases(id) on delete restrict,
  system_purchase_reference text,
  inventory_reference text,
  attribution_status text not null default 'PENDING'
    check(attribution_status in ('PENDING','MATCHED_UNVERIFIED','PURCHASE_VERIFIED','SOLD_VERIFIED','REJECTED')),
  attributed_at timestamptz not null default now(),
  purchase_verified_at timestamptz,
  sold_verified_at timestamptz,
  quantity integer check(quantity is null or quantity>0),
  acquisition_cost numeric(14,2) check(acquisition_cost is null or acquisition_cost>=0),
  sale_revenue numeric(14,2) check(sale_revenue is null or sale_revenue>=0),
  realized_gross_profit numeric(14,2),
  verification_source text not null default '',
  evidence_ref text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(attribution_status not in ('PURCHASE_VERIFIED','SOLD_VERIFIED') or
        (purchase_verified_at is not null and nullif(verification_source,'') is not null and
         (contact_event_id is not null or nullif(lead_reference,'') is not null))),
  check(attribution_status <> 'SOLD_VERIFIED' or
       (sold_verified_at is not null and quantity is not null and sale_revenue is not null and
        acquisition_cost is not null and realized_gross_profit is not null))
);
create index if not exists seo_portfolio_attribution_site_idx
 on public.commerce_seo_portfolio_attributions(site_id,attribution_status,attributed_at desc);
create index if not exists seo_portfolio_attribution_contact_idx
 on public.commerce_seo_portfolio_attributions(contact_event_id);
create unique index if not exists seo_portfolio_attribution_purchase_unique
 on public.commerce_seo_portfolio_attributions(site_id,system_purchase_reference)
 where system_purchase_reference is not null;
alter table public.commerce_seo_portfolio_attributions enable row level security;
revoke all on table public.commerce_seo_portfolio_attributions from public,anon,authenticated;
grant select,insert,update,delete on table public.commerce_seo_portfolio_attributions to service_role;

-- All views are invoker-security, service-only; no visitor identifiers are exposed.
create or replace view public.commerce_seo_portfolio_gsc_windows_v with (security_invoker=true) as
with latest as (
 select distinct on (site_id) site_id,id,source_at,data_start_date,data_end_date,
  last_data_date,clicks,impressions,ctr,position,daily,query_truncated
 from public.commerce_seo_network_snapshots
 where coverage='SITE_TOTAL' and data_end_date is not null
 order by site_id,data_end_date desc,source_at desc
),
daily as (
 select l.site_id,l.id as snapshot_id,l.data_end_date,
        d.day::date as metric_date,d.clicks,d.impressions,d.position
 from latest l
 cross join lateral jsonb_to_recordset(coalesce(l.daily,'[]'::jsonb))
   as d(day text,clicks numeric,impressions numeric,ctr numeric,position numeric)
 where d.day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
),
windows as (select unnest(array[7,14,28]) as days)
select l.site_id,l.id as snapshot_id,w.days as window_days,
       (l.data_end_date-(w.days-1))::date as start_date,l.data_end_date as end_date,
       case when w.days=28 then l.clicks else coalesce(sum(d.clicks),0) end as clicks,
       case when w.days=28 then l.impressions else coalesce(sum(d.impressions),0) end as impressions,
       case when w.days=28 then l.ctr
            else coalesce(sum(d.clicks),0)/nullif(sum(d.impressions),0) end as ctr,
       case when w.days=28 then l.position
            else sum(d.position*d.impressions)/nullif(sum(d.impressions),0) end as position,
       count(d.metric_date) as dates_present,
       case when w.days=28 then 'GSC_FINAL_PROPERTY_TOTAL'
            else 'GSC_FINAL_DAILY_ROLLUP' end as provenance,
       l.source_at,l.query_truncated
from latest l cross join windows w
left join daily d on d.site_id=l.site_id
 and d.metric_date between l.data_end_date-(w.days-1) and l.data_end_date
group by l.site_id,l.id,l.data_end_date,l.clicks,l.impressions,l.ctr,l.position,l.source_at,l.query_truncated,w.days;

create or replace view public.commerce_seo_portfolio_query_page_28d_v with (security_invoker=true) as
with latest as (
 select distinct on (site_id) site_id,id,data_start_date,data_end_date,queries,query_truncated,source_at
 from public.commerce_seo_network_snapshots
 where coverage='SITE_TOTAL' and data_end_date is not null
 order by site_id,data_end_date desc,source_at desc
)
select l.site_id,l.id as snapshot_id,l.data_start_date,l.data_end_date,
       q.query,q.page,q.clicks,q.impressions,q.position,
       l.query_truncated,true as sampled_not_property_total,l.source_at
from latest l cross join lateral jsonb_to_recordset(coalesce(l.queries,'[]'::jsonb))
 as q(query text,page text,clicks numeric,impressions numeric,position numeric)
where q.page <> '';

create or replace view public.commerce_seo_portfolio_funnel_v with (security_invoker=true) as
with contact as (
 select site_id,count(*) as contact_events,
 count(*) filter(where confirmed_lead) as confirmed_contact_events,
 count(*) filter(where sale_id is not null) as contact_events_with_sale_reference
 from public.commerce_seo_contact_events group by site_id
),deals as (
 select site_id,
 count(*) filter(where attribution_status in('PURCHASE_VERIFIED','SOLD_VERIFIED')) as verified_purchases,
 coalesce(sum(quantity) filter(where attribution_status in('PURCHASE_VERIFIED','SOLD_VERIFIED')),0) as verified_units,
 count(*) filter(where attribution_status='SOLD_VERIFIED') as verified_sales,
 coalesce(sum(realized_gross_profit) filter(where attribution_status='SOLD_VERIFIED'),0) as realized_gross_profit
 from public.commerce_seo_portfolio_attributions group by site_id
)
select s.id as site_id,s.label,
 coalesce(c.contact_events,0) as contact_events,
 coalesce(c.confirmed_contact_events,0) as confirmed_contact_events,
 coalesce(c.contact_events_with_sale_reference,0) as contact_events_with_sale_reference,
 coalesce(d.verified_purchases,0) as verified_purchases,
 coalesce(d.verified_units,0) as verified_units,
 coalesce(d.verified_sales,0) as verified_sales,
 coalesce(d.realized_gross_profit,0) as realized_gross_profit
from public.commerce_seo_sites s
left join contact c on s.id=c.site_id
left join deals d on s.id=d.site_id;

revoke all on public.commerce_seo_portfolio_gsc_windows_v from public,anon,authenticated;
revoke all on public.commerce_seo_portfolio_query_page_28d_v from public,anon,authenticated;
revoke all on public.commerce_seo_portfolio_funnel_v from public,anon,authenticated;
grant select on public.commerce_seo_portfolio_gsc_windows_v to service_role;
grant select on public.commerce_seo_portfolio_query_page_28d_v to service_role;
grant select on public.commerce_seo_portfolio_funnel_v to service_role;

