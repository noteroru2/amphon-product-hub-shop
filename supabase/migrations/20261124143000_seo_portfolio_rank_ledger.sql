-- AMPHON SEO Rank Ledger P2. Read-only to Hub, writable only by trusted server-side Ubersuggest observations.
-- Important: A Google Search Console average position is NOT a SERP rank.
create table if not exists public.commerce_seo_portfolio_rank_snapshots (
  site_id text not null references public.commerce_seo_sites(id) on delete restrict,
  provider_project_id text not null check (length(provider_project_id) between 20 and 128),
  keyword text not null check (length(keyword) between 2 and 200 and keyword = btrim(keyword)),
  location_id integer not null check (location_id > 0),
  language_code text not null check (language_code ~ '^[a-z]{2,3}$'),
  device text not null check (device in ('DESKTOP','MOBILE')),
  checked_on date not null,
  checked_at timestamptz not null default now(),
  serp_date date,
  status text not null check (status in ('PENDING','RANKED','NOT_RANKING_TOP_100')),
  position smallint,
  ranking_url text,
  source text not null default 'UBERSUGGEST_PROJECT_POSITION_INFO'
    check (source='UBERSUGGEST_PROJECT_POSITION_INFO'),
  primary key (site_id,provider_project_id,keyword,location_id,language_code,device,checked_on),
  constraint seo_rank_state_consistency check (
    (status='PENDING' and position is null and serp_date is null and ranking_url is null)
    or
    (status='NOT_RANKING_TOP_100' and position is null and serp_date is not null and ranking_url is null)
    or
    (status='RANKED' and position between 1 and 100 and serp_date is not null)
  ),
  constraint seo_rank_url_safe check (
    ranking_url is null
    or (ranking_url ~ '^https?://[^[:space:]]+$' and length(ranking_url) <= 2000)
  )
);
create index if not exists seo_portfolio_rank_snapshots_latest_idx
  on public.commerce_seo_portfolio_rank_snapshots (site_id,checked_on desc,keyword);
alter table public.commerce_seo_portfolio_rank_snapshots enable row level security;
revoke all on table public.commerce_seo_portfolio_rank_snapshots from public,anon,authenticated;
grant select,insert,update on table public.commerce_seo_portfolio_rank_snapshots to service_role;
comment on table public.commerce_seo_portfolio_rank_snapshots is
  'Historical Ubersuggest project_position_info observations. PENDING is not unranked, GSC average position is not SERP, no customer data, service_role only; read via authenticated Hub owner/admin portfolio.';
