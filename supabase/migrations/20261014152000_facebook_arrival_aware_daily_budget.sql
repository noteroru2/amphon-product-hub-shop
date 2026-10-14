-- Budget normal ROTATION against all Facebook posts already published on the page.
-- NEW_ARRIVAL intentionally bypasses daily budget to preserve <=10 minute arrivals.
-- Claim newest due arrivals before rotation to avoid delay during stock intake bursts.
-- Source: approved Facebook posting plan; no deletion/recreation of external posts.
CREATE OR REPLACE FUNCTION public.facebook_rotation_claim_due(max_jobs integer DEFAULT 3)
 RETURNS SETOF facebook_rotation_queue
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.facebook_rotation_settings%rowtype; j public.facebook_rotation_queue%rowtype; picked integer:=0;
begin
 select * into s from public.facebook_rotation_settings where id=true for update;
 if not s.enabled or s.dry_run then return; end if;
 for j in select q.* from public.facebook_rotation_queue q join public.products p on p.id=q.product_id
 where q.status in ('PLANNED','FAILED') and q.scheduled_at<=now()
 and coalesce(q.next_attempt_at,q.scheduled_at)<=now() and q.attempts<3
 and (s.canary_job_id is null or q.id=s.canary_job_id)
 and (s.canary_job_id is not null or (q.connection_key=any(s.active_connection_keys) and not(q.connection_key=any(s.paused_connection_keys))))
 and p.one_availability='IN_STOCK' and p.status in ('ready_to_list','published','reserved')
 order by case when q.lane='NEW_ARRIVAL' then 0 else 1 end,q.scheduled_at,q.id for update of q skip locked
 loop
  if exists(select 1 from public.facebook_rotation_queue x where x.connection_key=j.connection_key and x.status='CLAIMED') then continue; end if;
  if j.post_id is null then
   if exists(select 1 from public.facebook_post_ledger l where l.product_id=j.product_id and l.connection_key=j.connection_key and l.status<>'DELETED' and l.published_at>now()-make_interval(hours=>s.min_product_gap_hours)) then continue; end if;
   if exists(select 1 from public.facebook_rotation_queue x where x.product_id=j.product_id and x.connection_key=j.connection_key and x.post_id is not null and x.posted_at>now()-make_interval(hours=>s.min_product_gap_hours)) then continue; end if;
   if j.lane='ROTATION' then
    if exists(select 1 from public.facebook_rotation_queue x where x.connection_key=j.connection_key and x.post_id is not null and x.posted_at>now()-make_interval(mins=>s.min_page_gap_minutes)) then continue; end if;
    if (select count(*) from public.facebook_rotation_queue x where x.connection_key=j.connection_key and x.post_id is not null and (x.posted_at at time zone s.timezone)::date=(now() at time zone s.timezone)::date)>=s.page_daily_budget then continue; end if;
   end if;
  end if;
  update public.facebook_rotation_queue set status='CLAIMED',claimed_at=now(),claim_token=gen_random_uuid(),attempts=attempts+1 where facebook_rotation_queue.id=j.id returning * into j;
  return next j; picked:=picked+1;
  exit when picked>=greatest(1,least(max_jobs,10));
 end loop;
end $function$

