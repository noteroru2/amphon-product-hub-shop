-- Final compatibility after facebook_false_skip_reconciliation.
-- Restore up to the strategy-required weekly count (2 for normal, 3 for age >30).

create or replace function public.facebook_rotation_reconcile_false_skips()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare n integer;
begin
  with eligible as (
    select
      q.id,q.product_id,q.week_key,q.scheduled_at,
      case when coalesce(p.one_stock_age_days,0)>30 then 3 else 2 end as target_n,
      (
        select count(*)
        from public.facebook_rotation_queue x
        where x.product_id=q.product_id
          and x.week_key=q.week_key
          and x.status in('PLANNED','CLAIMED','POSTED')
      ) active_n
    from public.facebook_rotation_queue q
    join public.products p on p.id=q.product_id
    where q.status='SKIPPED_SOLD'
      and q.last_error='STOCK_AUTHORITY_NOT_IN_STOCK'
      and p.status in('ready_to_list','published','reserved')
      and p.one_availability='IN_STOCK'
      and q.scheduled_at>=now()-interval '6 hours'
  ),
  ranked as (
    select *,
      row_number() over(partition by product_id,week_key order by scheduled_at,id) rn
    from eligible
  )
  update public.facebook_rotation_queue q
  set status='PLANNED',last_error=null,attempts=0,claim_token=null,
      claimed_at=null,next_attempt_at=null
  from ranked r
  where q.id=r.id
    and r.active_n+r.rn<=r.target_n;
  get diagnostics n=row_count;
  return n;
end
$$;

revoke all on function public.facebook_rotation_reconcile_false_skips() from public,anon,authenticated;
grant execute on function public.facebook_rotation_reconcile_false_skips() to service_role;
