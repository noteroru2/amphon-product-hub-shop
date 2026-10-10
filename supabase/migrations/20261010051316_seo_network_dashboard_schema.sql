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
    when r.status_code>=400 or m.status_code>=400 or r.error is not null or m.error is not null then 'ATTENTION' else 'OK' end health_state,s.sitemap_path
from public.commerce_seo_sites s
left join lateral(select * from public.commerce_seo_network_snapshots x where x.site_id=s.id order by x.source_at desc limit 1) g on true
left join lateral(select * from public.commerce_seo_network_snapshots x where x.site_id=s.id and x.source_at<=g.source_at-interval '3 days' and x.coverage=g.coverage order by x.source_at desc limit 1) p on true
left join lateral(select * from public.commerce_seo_health_checks x where x.site_id=s.id and x.resource='HOME' order by x.id desc limit 1) h on true
left join lateral(select * from public.commerce_seo_health_checks x where x.site_id=s.id and x.resource='ROBOTS' order by x.id desc limit 1) r on true
left join lateral(select * from public.commerce_seo_health_checks x where x.site_id=s.id and x.resource='SITEMAP' order by x.id desc limit 1) m on true
where s.enabled;
