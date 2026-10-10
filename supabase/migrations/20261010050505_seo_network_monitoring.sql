-- Independent, read-only network monitoring. Experiments and executor remain separate.
create extension if not exists pg_net;

create table public.commerce_seo_sites (
  id text primary key,
  label text not null,
  origin text not null check (origin ~ '^https://[a-z0-9.-]+$'),
  gsc_property text not null,
  tracked_queries text[] not null default '{}',
  enabled boolean not null default true,
  interval_hours integer not null default 72 check (interval_hours >= 24),
  next_check_at timestamptz not null default now(),
  gsc_state text not null default 'BLOCKED' check (gsc_state in ('READY','BLOCKED','UNCONNECTED')),
  gsc_note text not null default 'Windsor ระงับการอ่าน: เชื่อม 15 บัญชี แต่ Free รองรับ 1 บัญชี'
);
insert into public.commerce_seo_sites(id,label,origin,gsc_property,tracked_queries) values
('amphon','amphon.co.th','https://amphon.co.th','sc-domain:amphon.co.th',array['รับซื้อคอม','รับซื้อคอมมือสอง','รับซื้อโน๊ตบุ๊ค']),
('shop','shop.amphon.co.th','https://shop.amphon.co.th','sc-domain:amphon.co.th',array['คอมมือสอง','โน๊ตบุ๊กมือสอง','สินค้าไอทีมือสอง']),
('amphontd','amphontd.com','https://amphontd.com','sc-domain:amphontd.com',array['อำพล เทรดดิ้ง']),
('camera','รับซื้อกล้องมือสอง.com','https://xn--12cman8e0bjt1czaccb9b1fg31ad.com','sc-domain:xn--12cman8e0bjt1czaccb9b1fg31ad.com',array['รับซื้อกล้อง','รับซื้อกล้องมือสอง']),
('buyhub','buyhubthai.com','https://buyhubthai.com','sc-domain:buyhubthai.com',array['รับซื้อโน๊ตบุ๊ค','รับซื้อคอม']),
('werab','เรารับซื้อ.com','https://xn--c3c3a0aa6cvaf8b9dze.com','sc-domain:xn--c3c3a0aa6cvaf8b9dze.com',array['รับซื้อคอม','รับซื้อไอที']),
('notebook','ร้านรับซื้อโน๊ตบุ๊ค.com','https://xn--42cn4aobed0eb6hubj4es0m5dhvd.com','sc-domain:xn--42cn4aobed0eb6hubj4es0m5dhvd.com',array['รับซื้อโน๊ตบุ๊ค','ร้านรับซื้อโน๊ตบุ๊ค']),
('iphone','ร้านรับซื้อไอโฟน.com','https://xn--c3c1abc0aub6fa0bi9d0h0a0eh.com','sc-domain:xn--c3c1abc0aub6fa0bi9d0h0a0eh.com',array['รับซื้อไอโฟน','ร้านรับซื้อไอโฟน']),
('ubon','รับซื้ออุบล.com','https://xn--c3c3ab7an0ca2a0dm8p.com','sc-domain:xn--c3c3ab7an0ca2a0dm8p.com',array['รับซื้อคอม อุบล','รับซื้อโน๊ตบุ๊ค อุบล']),
('khonkaen','รับซื้อไอทีขอนแก่น.com','https://xn--12cb0a0clbb5eueac5b7cya1nrb2eh.com','sc-domain:xn--12cb0a0clbb5eueac5b7cya1nrb2eh.com',array['รับซื้อคอม ขอนแก่น','รับซื้อโน๊ตบุ๊ค ขอนแก่น']),
('korat','รับซื้อไอทีโคราช.com','https://xn--42cmb2cn7ce1fa0bs7aw2n0a2f.com','sc-domain:xn--42cmb2cn7ce1fa0bs7aw2n0a2f.com',array['รับซื้อคอม โคราช','รับซื้อโน๊ตบุ๊ค โคราช']),
('winner','winnerit.in.th','https://winnerit.in.th','sc-domain:winnerit.in.th',array['รับซื้อคอม อุบล','คอมมือสอง อุบล']),
('webuy','webuy.in.th','https://webuy.in.th','https://webuy.in.th/',array['รับซื้อไอที']),
('pawn','จํานําไอโฟนอุบล.com','https://xn--82c8aaex2b0cc4bb4e0fya6jc.com','sc-domain:xn--82c8aaex2b0cc4bb4e0fya6jc.com',array['ขายฝากไอโฟน อุบล']);

create table public.commerce_seo_health_checks (
  id bigint generated always as identity primary key,
  site_id text not null references public.commerce_seo_sites(id),
  resource text not null check (resource in ('HOME','ROBOTS','SITEMAP')),
  request_id bigint not null unique,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  status_code integer,
  error text,
  noindex boolean,
  robots_blocks_all boolean,
  canonical text,
  content_hash text,
  previous_content_hash text,
  content_type text
);
create index commerce_seo_health_site_time_idx on public.commerce_seo_health_checks(site_id,resource,requested_at desc);

create table public.commerce_seo_network_snapshots (
  id bigint generated always as identity primary key,
  site_id text not null references public.commerce_seo_sites(id),
  source_at timestamptz not null,
  captured_at timestamptz not null default now(),
  window_days integer not null default 28,
  clicks numeric not null,
  impressions numeric not null,
  ctr numeric,
  position numeric,
  query_rows integer not null,
  queries jsonb not null,
  coverage text not null default 'QUERY_SAMPLE',
  unique(site_id,source_at)
);

-- No browser writes, no anonymous reads. Registry is an allowlist for HTTP requests.
alter table public.commerce_seo_sites enable row level security;
alter table public.commerce_seo_health_checks enable row level security;
alter table public.commerce_seo_network_snapshots enable row level security;
create policy seo_sites_admin_read on public.commerce_seo_sites for select to authenticated using(public.current_user_role() in ('owner','admin'));
create policy seo_health_admin_read on public.commerce_seo_health_checks for select to authenticated using(public.current_user_role() in ('owner','admin'));
create policy seo_snapshots_admin_read on public.commerce_seo_network_snapshots for select to authenticated using(public.current_user_role() in ('owner','admin'));
revoke all on public.commerce_seo_sites,public.commerce_seo_health_checks,public.commerce_seo_network_snapshots from anon,authenticated;
grant select on public.commerce_seo_sites,public.commerce_seo_health_checks,public.commerce_seo_network_snapshots to authenticated;
grant all on public.commerce_seo_sites,public.commerce_seo_health_checks,public.commerce_seo_network_snapshots to service_role;
grant usage,select on sequence public.commerce_seo_health_checks_id_seq,public.commerce_seo_network_snapshots_id_seq to service_role;

create function private.capture_seo_network_sources() returns integer language plpgsql set search_path='' as $$
declare n integer;
begin
  -- Capture only rows from the latest import batch, not stale leftovers from older upserts.
  with latest as (
    select property,max(fetched_at) source_at from public.commerce_gsc_query_demand where window_days=28 group by property
  ), scoped as (
    select s.id site_id,l.source_at,d.* from public.commerce_seo_sites s
    join latest l on l.property=s.gsc_property
    join public.commerce_gsc_query_demand d on d.property=l.property and d.window_days=28
      and d.fetched_at between l.source_at-interval '15 minutes' and l.source_at
    where s.enabled and split_part(split_part(lower(d.page),'://',2),'/',1) in (replace(s.origin,'https://',''),'www.'||replace(s.origin,'https://',''))
  )
  insert into public.commerce_seo_network_snapshots(site_id,source_at,clicks,impressions,ctr,position,query_rows,queries)
  select site_id,source_at,sum(clicks),sum(impressions),sum(clicks)/nullif(sum(impressions),0),
    sum(case when position>0 then position*impressions end)/nullif(sum(case when position>0 then impressions end),0),count(*),
    jsonb_agg(jsonb_build_object('query',query,'page',page,'clicks',clicks,'impressions',impressions,'position',nullif(position,0)))
  from scoped group by site_id,source_at on conflict do nothing;
  get diagnostics n=row_count;
  return n;
end $$;
revoke all on function private.capture_seo_network_sources() from public,anon,authenticated;
grant execute on function private.capture_seo_network_sources() to service_role;

create function private.enqueue_seo_network_checks() returns integer language plpgsql set search_path='' as $$
declare s record; r text; request bigint; n integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtext('seo-network-checks')) then return 0; end if;
  for s in select * from public.commerce_seo_sites where enabled and next_check_at<=now() order by id for update skip locked loop
    foreach r in array array['HOME','ROBOTS','SITEMAP'] loop
      request:=net.http_get(url:=s.origin||case r when 'HOME' then '/' when 'ROBOTS' then '/robots.txt' else '/sitemap.xml' end,
        headers:='{"User-Agent":"AmphonSeoMonitor/1.0","Accept":"text/html,application/xml,text/plain"}'::jsonb,timeout_milliseconds:=15000);
      insert into public.commerce_seo_health_checks(site_id,resource,request_id) values(s.id,r,request);
      n:=n+1;
    end loop;
    update public.commerce_seo_sites set next_check_at=now()+make_interval(hours=>s.interval_hours) where id=s.id;
  end loop;
  perform private.capture_seo_network_sources();
  return n;
end $$;
revoke all on function private.enqueue_seo_network_checks() from public,anon,authenticated;
grant execute on function private.enqueue_seo_network_checks() to service_role;

create function private.collect_seo_network_checks() returns integer language plpgsql set search_path='' as $$
declare c record; response record; n integer:=0; body text;
begin
  for c in select * from public.commerce_seo_health_checks where completed_at is null order by id limit 100 loop
    select * into response from net._http_response where id=c.request_id;
    if not found then
      if c.requested_at<now()-interval '10 minutes' then
        update public.commerce_seo_health_checks set completed_at=now(),error='ไม่ได้รับผลตรวจภายใน 10 นาที' where id=c.id;
      end if;
      continue;
    end if;
    body:=left(coalesce(response.content,''),2000000);
    update public.commerce_seo_health_checks set completed_at=response.created,status_code=response.status_code,
      error=case when response.timed_out then 'หมดเวลารอเว็บตอบกลับ'
        when response.error_msg is not null then response.error_msg
        when c.resource='SITEMAP' and response.status_code=200 and body !~* '<(urlset|sitemapindex)(\s|>)' then 'sitemap.xml ไม่ใช่รูปแบบ sitemap ที่ตรวจรองรับ'
        when c.resource='ROBOTS' and response.status_code=200 and response.content_type ~* 'text/html' then 'robots.txt ตอบกลับเป็น HTML'
        else null end,
      content_type=response.content_type,
      noindex=case when c.resource='HOME' and response.status_code between 200 and 299 then
        coalesce(response.headers->>'x-robots-tag','') ~* '(noindex|none)'
        or body ~* '<meta[^>]*(name\s*=\s*["''](robots|googlebot)["''][^>]*content\s*=\s*["''][^"'']*(noindex|none)|content\s*=\s*["''][^"'']*(noindex|none)[^>]*name\s*=\s*["''](robots|googlebot))' else null end,
      robots_blocks_all=case when c.resource='ROBOTS' and response.status_code=200 then
        body ~* 'user-agent:\s*\*\s*\r?\n\s*disallow:\s*/\s*(\r?\n|$)' else null end,
      canonical=case when c.resource='HOME' then substring(body from '(?i)<link[^>]*rel=["'']canonical["''][^>]*href=["'']([^"'']+)') else null end,
      content_hash=case when c.resource in ('ROBOTS','SITEMAP') and response.status_code=200 then md5(body) else null end,
      previous_content_hash=(select h.content_hash from public.commerce_seo_health_checks h where h.site_id=c.site_id and h.resource=c.resource and h.id<c.id and h.completed_at is not null order by h.id desc limit 1)
    where id=c.id;
    n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function private.collect_seo_network_checks() from public,anon,authenticated;
grant execute on function private.collect_seo_network_checks() to service_role;

create view public.commerce_seo_network_overview_v with(security_invoker=true) as
select s.*,g.source_at,g.captured_at,g.clicks,g.impressions,g.ctr,g.position,g.query_rows,g.coverage,
  p.source_at previous_source_at,
  case when g.source_at>=now()-interval '4 days' then g.clicks-p.clicks end clicks_delta,
  case when g.source_at>=now()-interval '4 days' then g.position-p.position end position_delta,
  h.requested_at last_check_at,h.completed_at,h.status_code home_status,h.error health_error,h.noindex,h.canonical,
  r.status_code robots_status,r.error robots_error,r.robots_blocks_all,
  r.content_hash is distinct from r.previous_content_hash and r.previous_content_hash is not null robots_changed,
  m.status_code sitemap_status,m.error sitemap_error,
  m.content_hash is distinct from m.previous_content_hash and m.previous_content_hash is not null sitemap_changed,
  case when h.requested_at is null then 'WAITING' when h.completed_at is null or r.completed_at is null or m.completed_at is null then 'RUNNING'
    when h.error is not null or h.status_code is null or h.status_code>=400 or h.noindex or r.robots_blocks_all then 'ATTENTION'
    when h.status_code between 300 and 399 then 'REDIRECT'
    when h.requested_at<now()-interval '4 days' then 'STALE'
    when r.status_code>=400 or m.status_code>=400 or r.error is not null or m.error is not null then 'ATTENTION' else 'OK' end health_state
from public.commerce_seo_sites s
left join lateral(select * from public.commerce_seo_network_snapshots x where x.site_id=s.id order by x.source_at desc limit 1) g on true
left join lateral(select * from public.commerce_seo_network_snapshots x where x.site_id=s.id and x.source_at<=g.source_at-interval '3 days' and x.coverage=g.coverage order by x.source_at desc limit 1) p on true
left join lateral(select * from public.commerce_seo_health_checks x where x.site_id=s.id and x.resource='HOME' order by x.id desc limit 1) h on true
left join lateral(select * from public.commerce_seo_health_checks x where x.site_id=s.id and x.resource='ROBOTS' order by x.id desc limit 1) r on true
left join lateral(select * from public.commerce_seo_health_checks x where x.site_id=s.id and x.resource='SITEMAP' order by x.id desc limit 1) m on true
where s.enabled;
revoke all on public.commerce_seo_network_overview_v from anon;
grant select on public.commerce_seo_network_overview_v to authenticated,service_role;

select private.capture_seo_network_sources();
select cron.schedule('seo-network-enqueue','*/15 * * * *','select private.enqueue_seo_network_checks();');
select cron.schedule('seo-network-collect','* * * * *','select private.collect_seo_network_checks();');
select private.enqueue_seo_network_checks();
