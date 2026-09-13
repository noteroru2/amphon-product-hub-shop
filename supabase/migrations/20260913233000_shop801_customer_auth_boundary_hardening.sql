-- AMPHON SHOP — SHOP-8.0.1 Customer Auth Boundary Hardening
-- Generated 2026-09-13
-- Required before exposing customer signup because customers and staff both use
-- Supabase's authenticated database role. Staff authorization remains anchored in
-- public.profiles/current_user_active()/current_user_role().

-- Trigger functions must never be callable through PostgREST/RPC. Triggers continue
-- to execute normally without caller EXECUTE grants.
revoke all on function public.assign_product_sku() from public, anon, authenticated;
revoke all on function public.auto_end_website_publication() from public, anon, authenticated;
revoke all on function public.hub6_product_status_task_sync() from public, anon, authenticated;
revoke all on function public.hub6_publication_task_sync() from public, anon, authenticated;
revoke all on function public.record_sales_channel_publication_event() from public, anon, authenticated;

-- Staff identity helpers are needed by authenticated staff/RLS, but anonymous callers
-- do not need them.
revoke execute on function public.current_user_active() from public, anon;
revoke execute on function public.current_user_role() from public, anon;
grant execute on function public.current_user_active() to authenticated;
grant execute on function public.current_user_role() to authenticated;

-- This report previously had no explicit staff guard. Keep it available to owner/admin
-- while preventing customer authenticated sessions from reading internal operational counts.
create or replace function public.hub6_cleanup_reconciliation_report()
returns table(metric text, value bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_user_active()
     or public.current_user_role() not in ('owner','admin') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return query
  select 'sold_products'::text,count(*)::bigint from public.products where status='sold'
  union all
  select 'actionable_active_publications'::text,count(*)::bigint
    from public.product_publications pp
    join public.sales_channel_cleanup_rules r using(channel)
    join public.products p on p.id=pp.product_id
   where p.status='sold' and pp.status='published' and r.sold_cleanup_enabled
  union all
  select 'existing_active_tasks'::text,count(*)::bigint
    from public.sales_channel_tasks where status in ('OPEN','IN_PROGRESS')
  union all
  select 'missing_tasks'::text,count(*)::bigint
    from public.product_publications pp
    join public.sales_channel_cleanup_rules r using(channel)
    join public.products p on p.id=pp.product_id
   where p.status='sold' and pp.status='published' and r.sold_cleanup_enabled
     and not exists(
       select 1 from public.sales_channel_tasks t
        where t.publication_id=pp.id
          and t.task_type=r.task_type
          and t.status in ('OPEN','IN_PROGRESS')
     )
  union all
  select 'conflicts'::text,count(*)::bigint
    from (
      select publication_id,task_type
        from public.sales_channel_tasks
       where status in ('OPEN','IN_PROGRESS')
       group by publication_id,task_type
      having count(*)>1
    ) x;
end;
$$;

revoke all on function public.hub6_cleanup_reconciliation_report() from public, anon;
grant execute on function public.hub6_cleanup_reconciliation_report() to authenticated, service_role;
