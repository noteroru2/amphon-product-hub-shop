-- A product may have multiple rotation posts. Keep every external post ID.
alter table public.facebook_post_ledger drop constraint if exists facebook_post_ledger_product_id_connection_key_key;
create unique index if not exists facebook_post_ledger_post_id_key on public.facebook_post_ledger(post_id);

-- Recover successful external publishes whose follow-up ledger write failed.
insert into public.facebook_post_ledger(product_id,connection_key,page_id,post_id,status,external_url,published_at,updated_at)
select q.product_id,q.connection_key,split_part(q.post_id,'_',1),q.post_id,'LIVE','https://www.facebook.com/'||q.post_id,coalesce(q.posted_at,q.created_at),now()
from public.facebook_rotation_queue q where q.post_id is not null
on conflict(post_id) do nothing;
update public.facebook_rotation_queue set status='POSTED',last_error=null,claim_token=null,next_attempt_at=null
where post_id is not null and status in ('FAILED','CLAIMED');

create or replace function public.facebook_sold_sync_candidates(max_posts integer default 20)
returns table(id uuid,product_id uuid,connection_key text,post_id text,sold_at timestamptz,sku text,title text)
language sql security invoker set search_path='' as $$
 select l.id,l.product_id,l.connection_key,l.post_id,l.sold_at,p.sku,p.title
 from public.facebook_post_ledger l join public.products p on p.id=l.product_id
 where (p.status='sold' or p.one_availability='SOLD') and l.status in ('LIVE','SOLD')
 and l.content_hash is distinct from 'SOLD_CONTENT_V2'
 order by l.updated_at,l.id limit greatest(1,least(max_posts,50))
$$;
revoke all on function public.facebook_sold_sync_candidates(integer) from public,anon,authenticated;
grant execute on function public.facebook_sold_sync_candidates(integer) to service_role;

-- Serialize claim selection, then reserve at most one job per page across sweeps.
create or replace function public.facebook_rotation_claim_due(max_jobs integer default 3)
returns setof public.facebook_rotation_queue language plpgsql security invoker set search_path='' as $$
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
 order by q.scheduled_at,q.id for update of q skip locked
 loop
  if exists(select 1 from public.facebook_rotation_queue x where x.connection_key=j.connection_key and x.status='CLAIMED') then continue; end if;
  if j.post_id is null then
   if exists(select 1 from public.facebook_post_ledger l where l.product_id=j.product_id and l.connection_key=j.connection_key and l.status<>'DELETED' and l.published_at>now()-make_interval(hours=>s.min_product_gap_hours)) then continue; end if;
   if exists(select 1 from public.facebook_rotation_queue x where x.product_id=j.product_id and x.connection_key=j.connection_key and x.post_id is not null and x.posted_at>now()-make_interval(hours=>s.min_product_gap_hours)) then continue; end if;
   if j.lane='ROTATION' then
    if exists(select 1 from public.facebook_rotation_queue x where x.connection_key=j.connection_key and x.post_id is not null and x.posted_at>now()-make_interval(mins=>s.min_page_gap_minutes)) then continue; end if;
    if (select count(*) from public.facebook_rotation_queue x where x.connection_key=j.connection_key and x.lane='ROTATION' and x.post_id is not null and (x.posted_at at time zone s.timezone)::date=(now() at time zone s.timezone)::date)>=s.page_daily_budget then continue; end if;
   end if;
  end if;
  update public.facebook_rotation_queue set status='CLAIMED',claimed_at=now(),claim_token=gen_random_uuid(),attempts=attempts+1 where facebook_rotation_queue.id=j.id returning * into j;
  return next j; picked:=picked+1;
  exit when picked>=greatest(1,least(max_jobs,10));
 end loop;
end $$;
revoke all on function public.facebook_rotation_claim_due(integer) from public,anon,authenticated;
grant execute on function public.facebook_rotation_claim_due(integer) to service_role;
