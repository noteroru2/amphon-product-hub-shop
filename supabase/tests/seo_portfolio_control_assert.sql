-- Run as privileged maintenance role after applying the portfolio migrations.
-- Read-only assertions; does not touch production data.
do $$
declare n int;
begin
  select count(*) into n from public.commerce_seo_portfolio_projects;
  if n <> 14 then raise exception 'Expected 14 registered projects, got %',n; end if;

  select count(*) into n from public.commerce_seo_portfolio_projects where central_deploy_allowed;
  if n <> 0 then raise exception 'Central SEO control plane must not have deploy permissions'; end if;

  select count(*) into n from public.commerce_seo_portfolio_keyword_roles
    where keyword='รับซื้อโน๊ตบุ๊ค' and site_id='amphon'
      and role='PRIMARY' and approval_status='APPROVED';
  if n <> 1 then raise exception 'Expected owner-confirmed primary notebook keyword role'; end if;

  select count(*) into n from public.commerce_seo_portfolio_keyword_roles
    where keyword='รับซื้อโน๊ตบุ๊ค' and site_id='notebook'
      and role='SUPPORTING' and approval_status='APPROVED';
  if n <> 1 then raise exception 'Expected owner-confirmed supporting notebook keyword role'; end if;

  select count(distinct site_id) into n
    from public.commerce_seo_portfolio_gsc_windows_v
    where window_days=7 and dates_present=7;
  if n <> 14 then raise exception 'Expected 7 final GSC daily dates for 14 websites, got %',n; end if;

  select count(distinct site_id) into n from public.commerce_seo_portfolio_query_page_28d_v;
  if n <> 14 then raise exception 'Expected GSC page/query samples from all 14 sites, got %',n; end if;

  select count(*) into n from public.commerce_seo_portfolio_release_events
    where event_kind='PRODUCTION_VERIFIED' and provider='GITHUB_AUDIT';
  if n <> 0 then raise exception 'GitHub audit must not be treated as provider-confirmed deployment'; end if;
end $$;

-- Security probes (inspect grants and RLS).
select c.relname,c.relrowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname like 'commerce_seo_portfolio_%'
  and c.relkind='r'
order by c.relname;
