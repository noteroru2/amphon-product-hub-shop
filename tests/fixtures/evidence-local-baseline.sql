-- Tests only: synthetic data schema with the same read-facing columns as
-- the verified AMPHON Production tables. Never imported into Production.
do $$ begin
 if current_setting('amphon.synthetic_fixture',true) is distinct from 'local-only-20261127'
 then raise exception 'SYNTHETIC_LOCAL_RUNNER_REQUIRED'; end if;
end $$;
create schema amphon_synthetic_local_fixture;
create table public.profiles (
 id uuid primary key references auth.users(id),
 role text not null,
 active boolean not null default true
);
create table public.trade_evidence (
 id uuid primary key,
 kind text not null,
 status text not null,
 permission_confirmed boolean not null default false,
 privacy_reviewed boolean not null default false,
 approved_at timestamptz,
 transaction_verified boolean not null default false,
 title text not null,
 brand text,
 model text,
 specs_text text,
 condition_text text,
 city text
);
create table public.trade_evidence_images (
 id uuid primary key,
 evidence_id uuid not null references public.trade_evidence(id),
 storage_path text not null,
 approved_for_public boolean not null default false
);
create table public.commerce_seo_sites (
 id text primary key,
 origin text not null,
 enabled boolean not null default true
);
create table public.commerce_seo_portfolio_projects (
 site_id text primary key references public.commerce_seo_sites(id),
 production_repo text not null,
 production_branch text not null,
 mapping_status text not null,
 central_deploy_allowed boolean not null default false
);
-- No permanent users, purchases or photos are created in this fixture.
-- Fixtures must not allow authenticated users to promote their own profile.
-- Keep the server-facing evidence fixture private; this is not a full replay
-- of the historical Hub UI's owner/admin policies.
alter table public.profiles enable row level security;
alter table public.trade_evidence enable row level security;
alter table public.trade_evidence_images enable row level security;
alter table public.commerce_seo_sites enable row level security;
alter table public.commerce_seo_portfolio_projects enable row level security;
revoke all on public.profiles, public.trade_evidence, public.trade_evidence_images,
 public.commerce_seo_sites, public.commerce_seo_portfolio_projects from anon, authenticated;
grant select on public.profiles to authenticated;
create policy synthetic_profile_read_self on public.profiles for select to authenticated
using (id=(select auth.uid()));
