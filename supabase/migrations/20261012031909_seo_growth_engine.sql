-- Read-only recommendations. These tables never feed the legacy auto-executor.
create function private.seo_keyword(value text) returns text language sql immutable set search_path='' as $$
 select lower(regexp_replace(trim(value),'\s+',' ','g'))
$$;
create function private.seo_page(site text, value text) returns text language sql stable set search_path='' as $$
 select s.origin||coalesce(nullif(regexp_replace(substring(value from '^https?://[^/]+(/.*)$'),'[?#].*$',''),''),'/')
 from public.commerce_seo_sites s where s.id=site and s.enabled
 and value ~ '^https?://[^/@?#]+(/[^[:cntrl:]]*)?$'
 and lower(split_part(value,'/',3)) in (split_part(s.origin,'/',3),'www.'||split_part(s.origin,'/',3),lower(s.label),'www.'||lower(s.label))
$$;

create table public.commerce_seo_keyword_owners (
 keyword text primary key check(length(keyword) between 1 and 200),
 site_id text not null references public.commerce_seo_sites(id),
 primary_page text not null,
 confirmed boolean not null default false,
 note text not null default '', updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
create table public.commerce_seo_lead_pages (
 id bigint generated always as identity primary key,
 site_id text not null references public.commerce_seo_sites(id), page text not null,
 basis text not null default 'GSC commercial intent candidate',
 confirmed boolean not null default false, enabled boolean not null default true,
 next_check_at timestamptz not null default now(), unique(site_id,page)
);
create index seo_lead_pages_due_idx on public.commerce_seo_lead_pages(next_check_at) where enabled;
create table public.commerce_seo_page_checks (
 id bigint generated always as identity primary key,
 page_id bigint not null references public.commerce_seo_lead_pages(id),
 request_id bigint not null unique, requested_at timestamptz not null default now(), completed_at timestamptz,
 status_code integer, error text, noindex boolean, canonical text, title text, h1_count integer,
 previous_noindex boolean, previous_canonical text, previous_title text,
 content_type text, changed boolean not null default false
);
create index seo_page_checks_latest_idx on public.commerce_seo_page_checks(page_id,id desc);
create table public.commerce_seo_growth_opportunities (
 id bigint generated always as identity primary key,
 site_id text not null references public.commerce_seo_sites(id), snapshot_id bigint not null references public.commerce_seo_network_snapshots(id),
 query text not null, page text not null,
 kind text not null check(kind in ('NEAR_FIRST_PAGE','LOW_CTR_REVIEW','OWNERSHIP_REVIEW')),
 impressions numeric not null, clicks numeric not null, position numeric, ctr numeric,
 priority integer not null, recommendation text not null,
 status text not null default 'OPEN' check(status in ('OPEN','REVIEWED','DISMISSED','STALE')),
 source_at timestamptz not null, updated_at timestamptz not null default now(),
 unique(site_id,query,page,kind)
);
create index seo_growth_priority_idx on public.commerce_seo_growth_opportunities(status,priority desc);

-- Initial map is a proposal, not an assertion of keyword ownership.
insert into public.commerce_seo_keyword_owners(keyword,site_id,primary_page)
select keyword,id,origin||'/' from (
 select private.seo_keyword(q) keyword,s.id,s.origin,row_number() over(partition by private.seo_keyword(q) order by
 case when s.id='amphon' and q in ('รับซื้อคอม','รับซื้อคอมมือสอง') then 0
 when s.id='notebook' and q='รับซื้อโน๊ตบุ๊ค' then 0
 when s.id='ubon' and q like '%อุบล%' then 0 else 1 end,s.id) rn
 from public.commerce_seo_sites s cross join lateral unnest(s.tracked_queries) q where s.enabled
) x where rn=1;

create view private.seo_growth_queries as
select site_id,origin,snapshot_id,source_at,query,page,sum(impressions) impressions,sum(clicks) clicks,
 sum(position*impressions) / nullif(sum(case when position is not null then impressions end),0) position,
 sum(clicks)/nullif(sum(impressions),0) ctr from (
select s.id site_id,s.origin,g.id snapshot_id,g.source_at,private.seo_keyword(q->>'query') query,
 private.seo_page(s.id,q->>'page') page,
 (q->>'impressions')::numeric impressions,(q->>'clicks')::numeric clicks,(q->>'position')::numeric position
from public.commerce_seo_sites s
join lateral(select * from public.commerce_seo_network_snapshots x where x.site_id=s.id order by source_at desc limit 1) g on true
cross join lateral jsonb_array_elements(g.queries) q
where s.enabled and s.gsc_state='READY' and g.coverage='SITE_TOTAL'
and g.source_at between now()-interval '4 days' and now()+interval '5 minutes'
and private.seo_page(s.id,q->>'page') is not null and length(q->>'query') between 1 and 200
) raw group by site_id,origin,snapshot_id,source_at,query,page;

create function private.refresh_seo_growth() returns integer language plpgsql set search_path='' as $$
declare n integer;
begin
 if not pg_try_advisory_xact_lock(hashtext('seo-growth-refresh')) then return 0; end if;
 -- Prefer observed matching landing pages, never overwrite a confirmed map.
 update public.commerce_seo_keyword_owners o set primary_page=x.page
 from (select distinct on (site_id,query) site_id,query,page from private.seo_growth_queries order by site_id,query,impressions desc,page) x
 where not o.confirmed and o.keyword=x.query and o.site_id=x.site_id;
 -- Propose up to three commercial landing pages per site. GSC clicks are not leads.
 insert into public.commerce_seo_lead_pages(site_id,page)
 select site_id,page from (
 select site_id,page,row_number() over(partition by site_id order by sum(clicks) desc,sum(impressions) desc,page) rn
 from private.seo_growth_queries where query ~ '(รับซื้อ|ขายฝาก|มือสอง|ราคา|ซื้อที่ไหน)' group by site_id,page
 ) x where rn<=3 on conflict do nothing;
 insert into public.commerce_seo_lead_pages(site_id,page,basis)
 select site_id,primary_page,'Keyword Ownership target' from public.commerce_seo_keyword_owners on conflict do nothing;
 -- Dismissals/reviews survive future imports; data and scoring refresh independently.
 with data as materialized(select * from private.seo_growth_queries), duplicates as (
 select query from data where impressions>=20 group by query having count(*)>1
 )
 insert into public.commerce_seo_growth_opportunities(site_id,snapshot_id,query,page,kind,impressions,clicks,position,ctr,priority,recommendation,source_at)
 select q.site_id,q.snapshot_id,q.query,q.page,k.kind,q.impressions,q.clicks,q.position,q.ctr,
 least(100,round(ln(1+q.impressions)*9+case when q.query ~ '(รับซื้อ|ขายฝาก|มือสอง)' then 15 else 0 end+case when o.confirmed and o.site_id=q.site_id then 10 else 0 end))::integer,
 case k.kind when 'NEAR_FIRST_PAGE' then 'ตรวจความตรงของหน้า คำตอบลูกค้า และ internal links ก่อนเสนอแก้ • ช่วงอันดับ 4–20 เป็นเกณฑ์คัดงาน ไม่ใช่การรับประกัน'
 when 'LOW_CTR_REVIEW' then 'ตรวจ Title/snippet และเจตนาค้นหา • CTR ต่ำกว่า 2% เป็นเกณฑ์เบื้องต้น ไม่ใช่ benchmark หรือยอดคลิกที่รับประกัน'
 else 'พบคำเดียวกันในหลายหน้า/เว็บ หรือไม่ตรงเจ้าของที่ยืนยัน • เป็นสัญญาณให้ตรวจ ไม่ใช่หลักฐานว่าแย่งอันดับกัน' end,q.source_at
 from data q left join public.commerce_seo_keyword_owners o on o.keyword=q.query
 cross join lateral (values
 ('NEAR_FIRST_PAGE',q.impressions>=50 and q.position between 4 and 20),
 ('LOW_CTR_REVIEW',q.impressions>=100 and q.position between 1 and 10 and q.ctr<0.02),
 ('OWNERSHIP_REVIEW',q.impressions>=20 and (exists(select 1 from duplicates d where d.query=q.query)
 or (o.confirmed and (o.site_id<>q.site_id or o.primary_page<>q.page))))) k(kind,eligible)
 where k.eligible
 on conflict(site_id,query,page,kind) do update set snapshot_id=excluded.snapshot_id,impressions=excluded.impressions,clicks=excluded.clicks,
 position=excluded.position,ctr=excluded.ctr,priority=excluded.priority,recommendation=excluded.recommendation,source_at=excluded.source_at,
 updated_at=now(),status=case when commerce_seo_growth_opportunities.status='STALE' then 'OPEN' else commerce_seo_growth_opportunities.status end;
 get diagnostics n=row_count;
 update public.commerce_seo_growth_opportunities o set status='STALE',updated_at=now()
 where o.status='OPEN' and (o.source_at<now()-interval '4 days' or not exists(select 1 from private.seo_growth_queries q where q.site_id=o.site_id and q.query=o.query and q.page=o.page and q.snapshot_id=o.snapshot_id));
 return n;
end $$;

create function private.enqueue_seo_lead_checks() returns integer language plpgsql set search_path='' as $$
declare p record; request bigint; n integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtext('seo-lead-checks')) then return 0; end if;
 for p in select l.* from public.commerce_seo_lead_pages l join public.commerce_seo_sites s on s.id=l.site_id and s.enabled
 where l.enabled and l.next_check_at<=now() and private.seo_page(l.site_id,l.page)=l.page
 order by l.confirmed desc,l.next_check_at,l.id limit 10 for update of l skip locked loop
 request:=net.http_get(url:=p.page,headers:='{"User-Agent":"AmphonSeoLeadGuard/1.0","Accept":"text/html"}'::jsonb,timeout_milliseconds:=15000);
 insert into public.commerce_seo_page_checks(page_id,request_id) values(p.id,request);
 update public.commerce_seo_lead_pages set next_check_at=now()+interval '72 hours' where id=p.id;
 n:=n+1;
 end loop;
 return n;
end $$;

create function private.collect_seo_lead_checks() returns integer language plpgsql set search_path='' as $$
declare c record; r record; old record; body text; ni boolean; can text; ttl text; n integer:=0;
begin
 for c in select * from public.commerce_seo_page_checks where completed_at is null order by id limit 100 for update skip locked loop
 select * into r from net._http_response where id=c.request_id;
 if not found then
 if c.requested_at<now()-interval '10 minutes' then update public.commerce_seo_page_checks set completed_at=now(),error='ไม่ได้รับผลภายใน 10 นาที' where id=c.id; end if;
 continue; end if;
 body:=left(coalesce(r.content,''),2000000);
 ni:=case when r.status_code between 200 and 299 then
 coalesce(r.headers->>'x-robots-tag','') ~* '(noindex|none)'
 or body ~* '<meta[^>]*(name\s*=\s*["''](robots|googlebot)["''][^>]*content\s*=\s*["''][^"'']*(noindex|none)|content\s*=\s*["''][^"'']*(noindex|none)[^>]*name\s*=\s*["''](robots|googlebot))' else null end;
 can:=coalesce(substring(body from '(?i)<link[^>]*rel\s*=\s*["'']canonical["''][^>]*href\s*=\s*["'']([^"'']+)'),substring(body from '(?i)<link[^>]*href\s*=\s*["'']([^"'']+)["''][^>]*rel\s*=\s*["'']canonical["'']'));
 ttl:=left(substring(body from '(?is)<title[^>]*>(.*?)</title>'),300);
 select * into old from public.commerce_seo_page_checks where page_id=c.page_id and id<c.id and completed_at is not null and error is null and status_code between 200 and 299 order by id desc limit 1;
 update public.commerce_seo_page_checks set completed_at=r.created,status_code=r.status_code,content_type=r.content_type,
 error=case when r.timed_out then 'หมดเวลารอเว็บ' when r.error_msg is not null then r.error_msg
 when r.status_code between 200 and 299 and coalesce(r.content_type,'') !~* 'html' then 'ผลตอบกลับไม่ใช่ HTML' else null end,
 noindex=ni,canonical=can,title=ttl,h1_count=(select count(*) from regexp_matches(body,'<h1(\s|>)','gi')),
 previous_noindex=old.noindex,previous_canonical=old.canonical,previous_title=old.title,
 changed=old.id is not null and r.status_code between 200 and 299 and (ni is distinct from old.noindex or can is distinct from old.canonical or ttl is distinct from old.title)
 where id=c.id; n:=n+1;
 end loop; return n;
end $$;

create view public.commerce_seo_lead_guard_v with(security_invoker=true) as
select p.*,c.requested_at,c.completed_at,c.status_code,c.error,c.noindex,c.canonical,c.title,c.h1_count,c.changed,c.previous_title,c.previous_canonical,
case when c.id is null then 'WAITING' when c.completed_at is null then 'RUNNING'
when c.error is not null or c.status_code is null or c.status_code>=400 or c.noindex then 'CRITICAL'
when c.status_code between 300 and 399 or c.canonical is null or c.title is null or c.h1_count<>1 or c.changed
or (c.canonical ~ '^https?://' and regexp_replace(c.canonical,'/$','')<>regexp_replace(p.page,'/$','')) then 'REVIEW'
when c.requested_at<now()-interval '4 days' then 'STALE' else 'HTTP_OK' end guard_state
from public.commerce_seo_lead_pages p left join lateral(select * from public.commerce_seo_page_checks c where c.page_id=p.id order by id desc limit 1)c on true where p.enabled;

-- Only owners/admins may see business data. Browser mutations go through checked RPCs.
do $$ declare t text; begin foreach t in array array['commerce_seo_keyword_owners','commerce_seo_lead_pages','commerce_seo_page_checks','commerce_seo_growth_opportunities'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy seo_growth_admin_read on public.%I for select to authenticated using(public.current_user_role() in (''owner'',''admin''))',t);
 end loop; end $$;
revoke all on public.commerce_seo_lead_guard_v from anon,authenticated;
grant select on public.commerce_seo_lead_guard_v to authenticated,service_role;
grant usage,select on sequence public.commerce_seo_lead_pages_id_seq,public.commerce_seo_page_checks_id_seq,public.commerce_seo_growth_opportunities_id_seq to service_role;

create function public.seo_growth_manage(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare keyword_value text; target text; role_name text; n integer;
begin
 select role into role_name from public.profiles where id=auth.uid() and active;
 if role_name is null or role_name not in ('owner','admin') then raise exception 'Owner/admin required' using errcode='42501'; end if;
 if p_action='refresh' then
 n:=private.refresh_seo_growth(); perform private.collect_seo_lead_checks(); perform private.enqueue_seo_lead_checks(); return jsonb_build_object('processed',n);
 elsif p_action='review' then
 if p_data->>'status' not in ('REVIEWED','DISMISSED','OPEN') or p_data->>'status' is null then raise exception 'Invalid status'; end if;
 update public.commerce_seo_growth_opportunities set status=p_data->>'status',updated_at=now() where id=(p_data->>'id')::bigint;
 elsif p_action='owner' then
 if role_name<>'owner' then raise exception 'Owner required' using errcode='42501'; end if;
 keyword_value:=private.seo_keyword(p_data->>'keyword'); target:=private.seo_page(p_data->>'site_id',p_data->>'page');
 if keyword_value is null or length(keyword_value) not between 1 and 200 or target is null then raise exception 'Keyword and same-site HTTPS page required'; end if;
 insert into public.commerce_seo_keyword_owners(keyword,site_id,primary_page,confirmed,note,updated_by)
 values(keyword_value,p_data->>'site_id',target,true,left(coalesce(p_data->>'note',''),1000),auth.uid())
 on conflict(keyword) do update set site_id=excluded.site_id,primary_page=excluded.primary_page,confirmed=true,note=excluded.note,updated_at=now(),updated_by=auth.uid();
 insert into public.commerce_seo_lead_pages(site_id,page,basis,confirmed) values(p_data->>'site_id',target,'Owner-confirmed keyword target',true)
 on conflict(site_id,page) do update set confirmed=true,enabled=true;
 elsif p_action='page' then
 if role_name<>'owner' then raise exception 'Owner required' using errcode='42501'; end if;
 target:=private.seo_page(p_data->>'site_id',p_data->>'page'); if target is null then raise exception 'Same-site HTTPS page required'; end if;
 insert into public.commerce_seo_lead_pages(site_id,page,basis,confirmed) values(p_data->>'site_id',target,'Owner-confirmed lead page',true)
 on conflict(site_id,page) do update set confirmed=true,enabled=true;
 else raise exception 'Unknown action'; end if;
 return '{"saved":true}'::jsonb;
end $$;
revoke all on function public.seo_growth_manage(text,jsonb) from public,anon;
grant execute on function public.seo_growth_manage(text,jsonb) to authenticated;
revoke all on function private.seo_keyword(text),private.seo_page(text,text),private.refresh_seo_growth(),private.enqueue_seo_lead_checks(),private.collect_seo_lead_checks() from public,anon,authenticated;
grant execute on function private.seo_keyword(text),private.seo_page(text,text),private.refresh_seo_growth(),private.enqueue_seo_lead_checks(),private.collect_seo_lead_checks() to service_role;
revoke all on private.seo_growth_queries from public,anon,authenticated;
grant select on private.seo_growth_queries to service_role;
select cron.schedule('seo-growth-refresh','*/10 * * * *','select private.refresh_seo_growth()');
select cron.schedule('seo-lead-guard-enqueue','* * * * *','select private.enqueue_seo_lead_checks()');
select cron.schedule('seo-lead-guard-collect','* * * * *','select private.collect_seo_lead_checks()');
select private.refresh_seo_growth();
