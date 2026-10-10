alter table public.commerce_seo_sites add column sitemap_path text not null default '/sitemap.xml'
  check (sitemap_path ~ '^/[^/][^[:space:]?#]*\.xml$');

create function private.discover_seo_network_sitemaps() returns integer language plpgsql set search_path='' as $$
declare s record; declared text; host text; path text; request bigint; n integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtext('seo-network-sitemaps')) then return 0; end if;
  for s in select x.*,r.content from public.commerce_seo_sites x
    join lateral(select * from public.commerce_seo_health_checks c where c.site_id=x.id and c.resource='ROBOTS' and c.status_code=200 order by c.id desc limit 1) c on true
    join net._http_response r on r.id=c.request_id where x.enabled loop
    declared:=substring(s.content from '(?im)^Sitemap:\s*([^\r\n[:space:]]+)');
    host:=regexp_replace(split_part(split_part(lower(declared),'://',2),'/',1),'^www\.','');
    path:=substring(declared from '^https?://[^/]+(/[^?#[:space:]]+)$');
    -- Keep requests on the existing HTTPS allowlist, including Unicode spelling of the same domain.
    if host not in (replace(s.origin,'https://',''),lower(s.label)) or path is null
      or path !~ '^/[^/][^[:space:]?#]*\.xml$' or path=s.sitemap_path then continue; end if;
    update public.commerce_seo_sites set sitemap_path=path where id=s.id;
    request:=net.http_get(url:=s.origin||path,headers:='{"User-Agent":"AmphonSeoMonitor/1.0"}'::jsonb,timeout_milliseconds:=15000);
    insert into public.commerce_seo_health_checks(site_id,resource,request_id) values(s.id,'SITEMAP',request);
    n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function private.discover_seo_network_sitemaps() from public,anon,authenticated;
grant execute on function private.discover_seo_network_sitemaps() to service_role;

create or replace function private.enqueue_seo_network_checks() returns integer language plpgsql set search_path='' as $$
declare s record; r text; request bigint; n integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtext('seo-network-checks')) then return 0; end if;
  for s in select * from public.commerce_seo_sites where enabled and next_check_at<=now() order by id for update skip locked loop
    foreach r in array array['HOME','ROBOTS','SITEMAP'] loop
      request:=net.http_get(url:=s.origin||case r when 'HOME' then '/' when 'ROBOTS' then '/robots.txt' else s.sitemap_path end,
        headers:='{"User-Agent":"AmphonSeoMonitor/1.0","Accept":"text/html,application/xml,text/plain"}'::jsonb,timeout_milliseconds:=15000);
      insert into public.commerce_seo_health_checks(site_id,resource,request_id) values(s.id,r,request);
      n:=n+1;
    end loop;
    update public.commerce_seo_sites set next_check_at=now()+make_interval(hours=>s.interval_hours) where id=s.id;
  end loop;
  perform private.capture_seo_network_sources();
  return n;
end $$;
select cron.schedule('seo-network-collect','* * * * *','select private.collect_seo_network_checks(); select private.discover_seo_network_sitemaps();');
select private.discover_seo_network_sitemaps();
