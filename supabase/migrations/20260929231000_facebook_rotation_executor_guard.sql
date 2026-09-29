alter table public.facebook_rotation_queue add column if not exists claimed_at timestamptz;
alter table public.facebook_rotation_queue add column if not exists claim_token uuid;
alter table public.facebook_rotation_queue add column if not exists next_attempt_at timestamptz;
create or replace function public.facebook_rotation_claim_due(max_jobs integer default 3)
returns setof public.facebook_rotation_queue language plpgsql security definer set search_path=public as $$
begin return query with due as (
 select q.id from public.facebook_rotation_queue q join public.facebook_rotation_settings s on s.id=true
 where s.enabled=true and s.dry_run=false and q.status in ('PLANNED','FAILED') and q.scheduled_at<=now()
 and coalesce(q.next_attempt_at,q.scheduled_at)<=now() and q.attempts<3 order by q.scheduled_at for update skip locked limit greatest(1,least(max_jobs,10))
), upd as (update public.facebook_rotation_queue q set status='CLAIMED',claimed_at=now(),claim_token=gen_random_uuid(),attempts=q.attempts+1 from due where q.id=due.id returning q.*) select * from upd; end $$;
revoke all on function public.facebook_rotation_claim_due(integer) from public,anon,authenticated; grant execute on function public.facebook_rotation_claim_due(integer) to service_role;
create or replace function public.facebook_rotation_recover_stale() returns integer language plpgsql security definer set search_path=public as $$
declare n integer; begin update public.facebook_rotation_queue set status='FAILED',next_attempt_at=now()+interval '15 minutes',last_error='STALE_CLAIM_RECOVERED',claim_token=null
where status='CLAIMED' and claimed_at<now()-interval '10 minutes'; get diagnostics n=row_count; return n; end $$;
revoke all on function public.facebook_rotation_recover_stale() from public,anon,authenticated; grant execute on function public.facebook_rotation_recover_stale() to service_role;