-- Bridge real direct-GSC snapshots to legacy action measurement input, not synthetic freshness.
-- Only the exact verified AMPHON main-site snapshot (not Shop or unrelated properties).
-- Preserve original Google source capture time for Measurement Integrity Guard.
create or replace function private.sync_amphon_gsc_direct_demand()
returns integer language plpgsql security invoker set search_path='' as $$
declare s public.commerce_seo_network_snapshots%rowtype; n integer := 0;
begin
  if not exists (
    select 1 from public.commerce_seo_sites site
    where site.id='amphon' and site.gsc_property='sc-domain:amphon.co.th'
      and site.gsc_state='READY'
  ) then return 0; end if;

  select snap.* into s
  from public.commerce_seo_network_snapshots snap
  where snap.site_id='amphon' and snap.window_days=28
    and snap.coverage='SITE_TOTAL' and snap.query_truncated=false
    and snap.source_at <= now() and snap.source_at > now()-interval '5 days'
    and jsonb_typeof(snap.queries)='array'
  order by snap.source_at desc,snap.id desc limit 1;
  if not found then return 0; end if;
  if exists (
    select 1 from public.commerce_gsc_query_demand d
    where d.property='sc-domain:amphon.co.th' and d.source='gsc-direct'
      and d.fetched_at >= s.source_at limit 1
  ) then return 0; end if;

  insert into public.commerce_gsc_query_demand
    (property,window_days,query,page,clicks,impressions,ctr,position,source,fetched_at)
  select 'sc-domain:amphon.co.th',28,
    item.value->>'query', item.value->>'page',
    (item.value->>'clicks')::numeric,(item.value->>'impressions')::numeric,
    case when (item.value->>'impressions')::numeric>0
      then (item.value->>'clicks')::numeric/(item.value->>'impressions')::numeric else 0 end,
    (item.value->>'position')::numeric,'gsc-direct',s.source_at
  from jsonb_array_elements(s.queries) item(value)
  where coalesce(item.value->>'query','') <> ''
    and (item.value->>'page' like 'https://amphon.co.th/%'
      or item.value->>'page' like 'https://www.amphon.co.th/%')
    and jsonb_typeof(item.value->'clicks')='number'
    and jsonb_typeof(item.value->'impressions')='number'
    and jsonb_typeof(item.value->'position')='number'
    and (item.value->>'clicks')::numeric >= 0
    and (item.value->>'impressions')::numeric >= 0
    and (item.value->>'position')::numeric >= 0
  on conflict (property,window_days,query,page) do update set
    clicks=excluded.clicks,impressions=excluded.impressions,
    ctr=excluded.ctr,position=excluded.position,
    source=excluded.source,fetched_at=excluded.fetched_at
  where public.commerce_gsc_query_demand.fetched_at < excluded.fetched_at;
  get diagnostics n=row_count;
  return n;
end $$;

-- The main-site 7D/14D integrity window is 48 hours; a 72-hour pull guarantees false stale alerts.
-- Match it with a 30-hour freshness interval on new successful fetches, without changing other sites.
create or replace function private.gsc_amphon_measurement_schedule_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.site_id='amphon' and new.last_success_at is not null
    and new.last_success_at is distinct from old.last_success_at then
    new.next_at:=least(new.next_at,new.last_success_at+interval '30 hours');
 end if;
 return new;
end $$;
drop trigger if exists trg_gsc_amphon_measurement_schedule_guard on public.commerce_gsc_sync_jobs;
create trigger trg_gsc_amphon_measurement_schedule_guard
before update of last_success_at on public.commerce_gsc_sync_jobs
for each row execute function private.gsc_amphon_measurement_schedule_guard();

update public.commerce_gsc_sync_jobs
set next_at=least(next_at,last_success_at+interval '30 hours')
where site_id='amphon' and last_success_at is not null and next_at>last_success_at+interval '30 hours';

-- Every batch is idempotent by snapshot source_at; never override newer data with older snapshots.
select private.sync_amphon_gsc_direct_demand();
select cron.schedule('gsc-direct-action-measurement-bridge','10,40 * * * *',
  'select private.sync_amphon_gsc_direct_demand();');
