-- Existing applied migration captured verbatim from Supabase on 2026-11-16.

create table if not exists public.commerce_seo_portfolio_gsc_query_pages (
 site_id text not null references public.commerce_seo_sites(id) on delete restrict,
 window_days smallint not null check(window_days in (7,14)),
 start_date date not null,
 end_date date not null,
 query text not null,
 page text not null,
 clicks numeric not null check(clicks>=0),
 impressions numeric not null check(impressions>=0),
 position numeric check(position>=0),
 source text not null default 'GSC_FINAL_SEO_CONNECTOR',
 partial_window boolean not null default false,
 synced_at timestamptz not null default now(),
 primary key(site_id,window_days,end_date,query,page),
 check(end_date-start_date=window_days-1),
 check(page ~ '^https?://')
);
create index if not exists seo_portfolio_qp_site_window_idx on public.commerce_seo_portfolio_gsc_query_pages(site_id,window_days,end_date desc);
alter table public.commerce_seo_portfolio_gsc_query_pages enable row level security;
revoke all on public.commerce_seo_portfolio_gsc_query_pages from public,anon,authenticated;
grant select,insert,update,delete on public.commerce_seo_portfolio_gsc_query_pages to service_role;

create table if not exists public.commerce_seo_portfolio_gsc_ingest_runs (
 id uuid primary key default gen_random_uuid(),
 site_id text not null references public.commerce_seo_sites(id) on delete restrict,
 window_days smallint not null check(window_days in (7,14,28)),
 start_date date not null,
 end_date date not null,
 source text not null,
 rows_written integer not null default 0,
 data_complete boolean not null default false,
 status text not null default 'PENDING' check(status in ('PENDING','SUCCESS','FAILED')),
 error_class text,
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(site_id,window_days,end_date,source)
);
alter table public.commerce_seo_portfolio_gsc_ingest_runs enable row level security;
revoke all on public.commerce_seo_portfolio_gsc_ingest_runs from public,anon,authenticated;
grant select,insert,update,delete on public.commerce_seo_portfolio_gsc_ingest_runs to service_role;

create or replace view public.commerce_seo_portfolio_query_page_all_v with (security_invoker=true) as
select site_id,window_days,start_date,end_date,query,page,clicks,impressions,position,partial_window,
       source,synced_at
from public.commerce_seo_portfolio_gsc_query_pages
union all
select site_id,28::smallint as window_days,data_start_date,data_end_date,query,page,clicks,impressions,position,
       coalesce(query_truncated,false) as partial_window,
       'GSC_FINAL_SAMPLED_NETWORK_SNAPSHOT'::text as source,source_at as synced_at
from public.commerce_seo_portfolio_query_page_28d_v;
revoke all on public.commerce_seo_portfolio_query_page_all_v from public,anon,authenticated;
grant select on public.commerce_seo_portfolio_query_page_all_v to service_role;

