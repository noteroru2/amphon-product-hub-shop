create schema if not exists private;

create table if not exists public.commerce_gsc_query_demand (
  id bigserial primary key,
  property text not null,
  window_days integer not null default 28 check (window_days between 1 and 365),
  query text not null,
  page text not null default '',
  clicks numeric not null default 0,
  impressions numeric not null default 0,
  ctr numeric not null default 0,
  position numeric not null default 0,
  source text not null default 'windsor-searchconsole',
  fetched_at timestamptz not null default now(),
  unique (property, window_days, query, page)
);

alter table public.commerce_gsc_query_demand enable row level security;
grant select, insert, update, delete on public.commerce_gsc_query_demand to service_role;
grant usage, select on sequence public.commerce_gsc_query_demand_id_seq to service_role;

create table if not exists public.commerce_spec_pages (
  id uuid primary key default gen_random_uuid(),
  dimension text not null check (dimension in ('GPU','CPU','RAM','STORAGE')),
  token text not null,
  label text not null,
  canonical_path text not null unique,
  primary_keyword text not null,
  seo_title text not null,
  seo_description text not null,
  intro_content text not null,
  index_policy text not null default 'HOLD' check (index_policy in ('INDEX','HOLD','NOINDEX','RETIRED')),
  seo_ready boolean not null default false,
  effective_index_policy text not null default 'HOLD' check (effective_index_policy in ('INDEX','HOLD','NOINDEX','RETIRED')),
  current_stock_count integer not null default 0,
  historical_listing_count integer not null default 0,
  distinct_brand_count integer not null default 0,
  gsc_impressions_28d numeric not null default 0,
  gsc_clicks_28d numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (dimension, token)
);

alter table public.commerce_spec_pages enable row level security;
grant select, insert, update, delete on public.commerce_spec_pages to service_role;

create or replace function private.normalize_commerce_spec_token(p_dimension text, p_raw text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, private
as $
declare
  v text := lower(coalesce(p_raw,''));
  m text[];
begin
  if p_dimension = 'GPU' then
    m := regexp_match(v, 'rtx[[:space:]]*(50[0-9]{2})');
    if m is not null then return 'rtx-'||m[1]; end if;
    m := regexp_match(v, 'rtx[[:space:]]*(40[0-9]{2})');
    if m is not null then return 'rtx-'||m[1]; end if;
    m := regexp_match(v, 'rtx[[:space:]]*(30[0-9]{2})');
    if m is not null then return 'rtx-'||m[1]; end if;
    m := regexp_match(v, 'rtx[[:space:]]*(20[0-9]{2})');
    if m is not null then return 'rtx-'||m[1]; end if;
    m := regexp_match(v, 'gtx[[:space:]]*(16[0-9]{2})');
    if m is not null then return 'gtx-'||m[1]; end if;
    m := regexp_match(v, 'gtx[[:space:]]*(10[0-9]{2})');
    if m is not null then return 'gtx-'||m[1]; end if;
  elsif p_dimension = 'CPU' then
    m := regexp_match(v, '(i[3579]-[0-9]{4,5}[a-z]{0,2})');
    if m is not null then return 'intel-'||m[1]; end if;
    m := regexp_match(v, '(ryzen[[:space:]]+[3579][[:space:]]+[0-9]{4}[a-z]{0,2})');
    if m is not null then return 'amd-'||replace(m[1],' ','-'); end if;
  elsif p_dimension = 'RAM' then
    if v ~ '32[[:space:]]*gb' then return '32gb'; end if;
    if v ~ '16[[:space:]]*gb' then return '16gb'; end if;
    if v ~ '8[[:space:]]*gb' or v ~ '^8$' then return '8gb'; end if;
    if v ~ '4[[:space:]]*gb' then return '4gb'; end if;
  elsif p_dimension = 'STORAGE' then
    if v ~ '2[[:space:]]*tb' then return '2tb'; end if;
    if v ~ '1[[:space:]]*tb' or v ~ '1024[[:space:]]*gb' then return '1tb'; end if;
    if v ~ '512[[:space:]]*gb' then return '512gb'; end if;
    if v ~ '256[[:space:]]*gb' then return '256gb'; end if;
  end if;
  return null;
end;
$;

revoke all on function private.normalize_commerce_spec_token(text,text) from public;
revoke all on function private.normalize_commerce_spec_token(text,text) from anon;
revoke all on function private.normalize_commerce_spec_token(text,text) from authenticated;
grant execute on function private.normalize_commerce_spec_token(text,text) to service_role;

create or replace function private.refresh_commerce_spec_pages()
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  with product_tokens as (
    select
      p.id,
      p.brand,
      p.status,
      pp.status as website_status,
      x.dimension,
      private.normalize_commerce_spec_token(x.dimension, x.raw_value) as token
    from public.products p
    left join public.product_publications pp
      on pp.product_id=p.id
     and pp.channel='website'
    cross join lateral (
      values
        ('GPU'::text, p.specs->>'gpu'),
        ('CPU'::text, p.specs->>'cpu'),
        ('RAM'::text, p.specs->>'ram'),
        ('STORAGE'::text, coalesce(p.specs->>'ssd',p.specs->>'storage'))
    ) x(dimension,raw_value)
  ),
  agg as (
    select
      dimension,
      token,
      count(*) filter(where website_status='published' and status in ('published','reserved'))::int as current_stock,
      count(*)::int as historical,
      count(distinct lower(nullif(btrim(brand),'')))
        filter(where website_status='published' and status in ('published','reserved'))::int as distinct_brands
    from product_tokens
    where token is not null
    group by dimension, token
  ),
  demand as (
    select
      a.dimension,
      a.token,
      coalesce(sum(g.impressions),0) as impressions,
      coalesce(sum(g.clicks),0) as clicks
    from agg a
    left join public.commerce_gsc_query_demand g
      on g.window_days=28
     and g.fetched_at >= now() - interval '3 days'
     and (
       lower(g.query) like '%'||replace(a.token,'-',' ')||'%'
       or lower(g.query) like '%'||replace(a.token,'-','')||'%'
     )
    group by a.dimension,a.token
  )
  insert into public.commerce_spec_pages(
    dimension,token,label,canonical_path,primary_keyword,seo_title,seo_description,intro_content,
    current_stock_count,historical_listing_count,distinct_brand_count,gsc_impressions_28d,gsc_clicks_28d,updated_at
  )
  select
    a.dimension,
    a.token,
    case
      when a.dimension='GPU' then upper(replace(a.token,'-',' '))
      when a.dimension='CPU' then replace(initcap(replace(a.token,'-',' ')),'Intel I','Intel i')
      when a.dimension='RAM' then upper(a.token)||' RAM'
      else upper(a.token)||' SSD'
    end,
    '/specs/'||lower(a.dimension)||'/'||a.token||'/',
    case
      when a.dimension='GPU' then upper(replace(a.token,'-',' '))||' มือสอง'
      when a.dimension='CPU' then replace(initcap(replace(a.token,'-',' ')),'Intel I','Intel i')||' มือสอง'
      when a.dimension='RAM' then upper(a.token)||' RAM มือสอง'
      else upper(a.token)||' SSD มือสอง'
    end,
    case
      when a.dimension='GPU' then upper(replace(a.token,'-',' '))||' มือสอง พร้อมราคาและสเปก | AMPHON TRADING'
      when a.dimension='CPU' then replace(initcap(replace(a.token,'-',' ')),'Intel I','Intel i')||' มือสอง พร้อมราคา | AMPHON TRADING'
      when a.dimension='RAM' then upper(a.token)||' RAM มือสอง พร้อมสินค้าไอทีจริง | AMPHON TRADING'
      else upper(a.token)||' SSD มือสอง พร้อมสินค้าไอทีจริง | AMPHON TRADING'
    end,
    'รวมสินค้าไอทีมือสองที่มีสเปก '||
      case
        when a.dimension='GPU' then upper(replace(a.token,'-',' '))
        when a.dimension='CPU' then replace(initcap(replace(a.token,'-',' ')),'Intel I','Intel i')
        when a.dimension='RAM' then upper(a.token)||' RAM'
        else upper(a.token)||' SSD'
      end||
      ' จากสต๊อกจริง พร้อมราคา รูป สภาพและรายละเอียดรายเครื่อง',
    'หน้านี้รวบรวมจากสินค้าที่มีข้อมูลสเปกจริงในระบบ AMPHON SHOP เท่านั้น สินค้าแต่ละชิ้นเป็นของมือสองรายเครื่อง จึงควรดูรูป สภาพ Product Evidence และสถานะล่าสุดก่อนสั่งซื้อ',
    a.current_stock,
    a.historical,
    a.distinct_brands,
    d.impressions,
    d.clicks,
    now()
  from agg a
  join demand d using(dimension,token)
  on conflict (dimension,token) do update set
    label=excluded.label,
    canonical_path=excluded.canonical_path,
    primary_keyword=excluded.primary_keyword,
    seo_title=excluded.seo_title,
    seo_description=excluded.seo_description,
    intro_content=excluded.intro_content,
    current_stock_count=excluded.current_stock_count,
    historical_listing_count=excluded.historical_listing_count,
    distinct_brand_count=excluded.distinct_brand_count,
    gsc_impressions_28d=excluded.gsc_impressions_28d,
    gsc_clicks_28d=excluded.gsc_clicks_28d,
    updated_at=now();

  update public.commerce_spec_pages
  set
    seo_ready = case
      when dimension='GPU' then current_stock_count>=3 and historical_listing_count>=3 and distinct_brand_count>=2
      when dimension='CPU' then current_stock_count>=3 and historical_listing_count>=4 and distinct_brand_count>=2
      when dimension='RAM' then current_stock_count>=10 and historical_listing_count>=12 and distinct_brand_count>=4 and gsc_impressions_28d>=20
      when dimension='STORAGE' then current_stock_count>=12 and historical_listing_count>=15 and distinct_brand_count>=4 and gsc_impressions_28d>=20
      else false
    end,
    effective_index_policy = case
      when index_policy in ('NOINDEX','RETIRED') then index_policy
      when (
        (dimension='GPU' and current_stock_count>=3 and historical_listing_count>=3 and distinct_brand_count>=2)
        or (dimension='CPU' and current_stock_count>=3 and historical_listing_count>=4 and distinct_brand_count>=2)
        or (dimension='RAM' and current_stock_count>=10 and historical_listing_count>=12 and distinct_brand_count>=4 and gsc_impressions_28d>=20)
        or (dimension='STORAGE' and current_stock_count>=12 and historical_listing_count>=15 and distinct_brand_count>=4 and gsc_impressions_28d>=20)
      ) then 'INDEX'
      else 'HOLD'
    end,
    index_policy = case
      when index_policy in ('NOINDEX','RETIRED') then index_policy
      when (
        (dimension='GPU' and current_stock_count>=3 and historical_listing_count>=3 and distinct_brand_count>=2)
        or (dimension='CPU' and current_stock_count>=3 and historical_listing_count>=4 and distinct_brand_count>=2)
        or (dimension='RAM' and current_stock_count>=10 and historical_listing_count>=12 and distinct_brand_count>=4 and gsc_impressions_28d>=20)
        or (dimension='STORAGE' and current_stock_count>=12 and historical_listing_count>=15 and distinct_brand_count>=4 and gsc_impressions_28d>=20)
      ) then 'INDEX'
      else 'HOLD'
    end,
    updated_at=now();
end;
$$;

revoke all on function private.refresh_commerce_spec_pages() from public;
revoke all on function private.refresh_commerce_spec_pages() from anon;
revoke all on function private.refresh_commerce_spec_pages() from authenticated;
grant execute on function private.refresh_commerce_spec_pages() to service_role;

create or replace view public.commerce_public_spec_page_v
with (security_invoker=true)
as
select
  id,dimension,token,label,canonical_path,primary_keyword,seo_title,seo_description,intro_content,
  index_policy,seo_ready,effective_index_policy,current_stock_count,historical_listing_count,
  distinct_brand_count,gsc_impressions_28d,gsc_clicks_28d,updated_at
from public.commerce_spec_pages;

grant select on public.commerce_public_spec_page_v to service_role;

select private.refresh_commerce_spec_pages();

do $$
declare existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'commerce-seo-governance-15m'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end
$$;

select cron.schedule(
  'commerce-seo-governance-15m',
  '*/15 * * * *',
  'select private.sync_commerce_model_longtails(); select private.apply_commerce_seo_governance(); select private.refresh_commerce_spec_pages();'
);
