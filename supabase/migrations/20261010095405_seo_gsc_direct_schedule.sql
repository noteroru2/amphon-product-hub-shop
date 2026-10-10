select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'seo_gsc_scheduler_key');
create function private.dispatch_gsc_sync() returns bigint language plpgsql set search_path='' as $$
declare key text;
begin
  if not exists(select 1 from public.commerce_gsc_sync_jobs j join public.commerce_gsc_connections c on c.id=j.connection_id
    where c.state='READY' and j.next_at<=now() and (j.lease_until is null or j.lease_until<now())) then return null; end if;
  select decrypted_secret into key from vault.decrypted_secrets where name='seo_gsc_scheduler_key';
  return net.http_post(url:='https://mfpdtlxwdbxitgfzdape.supabase.co/functions/v1/seo-gsc',
    headers:=jsonb_build_object('Content-Type','application/json','x-gsc-scheduler-key',key),
    body:='{"action":"run"}'::jsonb,timeout_milliseconds:=60000);
end $$;

update public.commerce_seo_sites set gsc_state='UNCONNECTED',gsc_note='เชื่อม Google Search Console โดยตรงเพื่อดึงข้อมูลใหม่ทุก 3 วัน';

create or replace view public.commerce_seo_network_overview_v with(security_invoker=true) as
select s.id,s.label,s.origin,s.gsc_property,s.tracked_queries,s.enabled,s.interval_hours,s.next_check_at,s.gsc_state,s.gsc_note,g.source_at,g.captured_at,g.clicks,g.impressions,g.ctr,g.position,g.query_rows,g.coverage,
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
    when r.status_code>=400 or m.status_code>=400 or r.error is not null or m.error is not null then 'ATTENTION' else 'OK' end health_state,
  s.sitemap_path,g.data_start_date,g.data_end_date,g.last_data_date
from public.commerce_seo_sites s
left join lateral(select * from public.commerce_seo_network_snapshots x where x.site_id=s.id order by x.source_at desc limit 1) g on true
left join lateral(select * from public.commerce_seo_network_snapshots x where x.site_id=s.id and x.source_at<=g.source_at-interval '3 days' and x.coverage=g.coverage order by x.source_at desc limit 1) p on true
left join lateral(select * from public.commerce_seo_health_checks x where x.site_id=s.id and x.resource='HOME' order by x.id desc limit 1) h on true
left join lateral(select * from public.commerce_seo_health_checks x where x.site_id=s.id and x.resource='ROBOTS' order by x.id desc limit 1) r on true
left join lateral(select * from public.commerce_seo_health_checks x where x.site_id=s.id and x.resource='SITEMAP' order by x.id desc limit 1) m on true
where s.enabled;
revoke all on function private.dispatch_gsc_sync() from public,anon,authenticated;
grant execute on function private.dispatch_gsc_sync() to service_role;
select cron.schedule('seo-gsc-direct-dispatch','* * * * *','select private.dispatch_gsc_sync()');

-- Legacy Windsor samples must not supersede direct API snapshots.
create or replace function private.capture_seo_network_sources() returns integer language plpgsql set search_path='' as $$
declare n integer;
begin
  with latest as (
    select property,max(fetched_at) source_at from public.commerce_gsc_query_demand where window_days=28 group by property
  ), scoped as (
    select s.id site_id,l.source_at,d.* from public.commerce_seo_sites s
    join latest l on l.property=s.gsc_property
    join public.commerce_gsc_query_demand d on d.property=l.property and d.window_days=28
      and d.fetched_at between l.source_at-interval '15 minutes' and l.source_at
    where s.enabled and not exists(select 1 from public.commerce_gsc_sync_jobs j where j.site_id=s.id)
      and split_part(split_part(lower(d.page),'://',2),'/',1) in (replace(s.origin,'https://',''),'www.'||replace(s.origin,'https://',''))
  )
  insert into public.commerce_seo_network_snapshots(site_id,source_at,clicks,impressions,ctr,position,query_rows,queries)
  select site_id,source_at,sum(clicks),sum(impressions),sum(clicks)/nullif(sum(impressions),0),
    sum(case when position>0 then position*impressions end)/nullif(sum(case when position>0 then impressions end),0),count(*),
    jsonb_agg(jsonb_build_object('query',query,'page',page,'clicks',clicks,'impressions',impressions,'position',nullif(position,0)))
  from scoped group by site_id,source_at on conflict do nothing;
  get diagnostics n=row_count; return n;
end $$;
