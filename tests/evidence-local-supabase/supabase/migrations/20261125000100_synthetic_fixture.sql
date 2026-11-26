-- Tests only: synthetic data schema with the same read-facing columns as
-- the verified AMPHON Production tables. Never imported into Production.
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
