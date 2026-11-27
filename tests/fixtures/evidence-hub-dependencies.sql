-- SYNTHETIC LOCAL ONLY: minimal unrelated Hub dependencies. Actual evidence
-- tables, triggers, RLS and Storage policies are replayed from root migrations.
do $$ begin
 if current_setting('amphon.synthetic_fixture',true) is distinct from 'local-only-20261127'
 then raise exception 'SYNTHETIC_LOCAL_RUNNER_REQUIRED'; end if;
end $$;
create schema amphon_synthetic_local_fixture;
create table public.profiles(id uuid primary key references auth.users(id),role text not null,active boolean not null default true);
alter table public.profiles enable row level security;
revoke all on public.profiles from public,anon,authenticated;
grant select on public.profiles to authenticated;
create policy synthetic_profile_read_self on public.profiles for select to authenticated using(id=auth.uid());
create function public.current_user_role() returns text language sql stable security definer set search_path='' as $$
 select p.role from public.profiles p where p.id=auth.uid() and p.active=true limit 1
$$;
create table public.commerce_seo_sites(id text primary key,origin text not null,enabled boolean not null default true);
create table public.commerce_seo_portfolio_projects(site_id text primary key references public.commerce_seo_sites(id),production_repo text not null,production_branch text not null,mapping_status text not null,central_deploy_allowed boolean not null default false);
alter table public.commerce_seo_sites enable row level security;
alter table public.commerce_seo_portfolio_projects enable row level security;
revoke all on public.commerce_seo_sites,public.commerce_seo_portfolio_projects from public,anon,authenticated;
