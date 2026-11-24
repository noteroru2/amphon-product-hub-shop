-- P10/P11: immutable, release-SHA-pinned exception only.
-- Never rewrites commerce_seo_portfolio_projects.production_branch and never permits deploy.
-- A single explicit owner approval is not blanket authorization for future releases.
create table if not exists public.commerce_seo_release_branch_exceptions (
  site_id text not null references public.commerce_seo_sites(id) on delete restrict,
  repository text not null check (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  registered_branch text not null check (registered_branch ~ '^[A-Za-z0-9._/-]{1,120}$'),
  approved_branch text not null check (approved_branch ~ '^[A-Za-z0-9._/-]{1,120}$'),
  commit_sha text not null check (commit_sha ~ '^[a-f0-9]{40}$'),
  hosting_provider text not null check (hosting_provider = 'CLOUDFLARE'),
  worker_script text not null,
  worker_version text not null check (worker_version ~ '^[a-f0-9-]{36}$'),
  deployment_id text not null check (deployment_id ~ '^[a-f0-9-]{36}$'),
  build_id text not null check (build_id ~ '^[a-f0-9-]{36}$'),
  approved_at timestamptz not null default now(),
  approval_receipt_url text not null check (approval_receipt_url ~ '^https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/[0-9]+#issuecomment-[0-9]+$'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object'),
  primary key (site_id,deployment_id),
  unique (site_id,commit_sha,worker_version),
  check (registered_branch <> approved_branch)
);

create index if not exists commerce_seo_release_branch_exceptions_site_idx
  on public.commerce_seo_release_branch_exceptions(site_id, approved_at desc);
alter table public.commerce_seo_release_branch_exceptions enable row level security;
revoke all on public.commerce_seo_release_branch_exceptions
  from public, anon, authenticated, service_role;
-- Only the server's trusted service_role can read the immutable allowlist.
-- Neither clients nor the connector can create or revise an approval.
grant select on public.commerce_seo_release_branch_exceptions to service_role;

create or replace function public.deny_seo_release_branch_exception_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SEO_RELEASE_BRANCH_EXCEPTION_IMMUTABLE';
end;
$$;
revoke all on function public.deny_seo_release_branch_exception_mutation() from public, anon, authenticated, service_role;
drop trigger if exists deny_seo_release_branch_exception_mutation
  on public.commerce_seo_release_branch_exceptions;
create trigger deny_seo_release_branch_exception_mutation
before update or delete on public.commerce_seo_release_branch_exceptions
for each row execute function public.deny_seo_release_branch_exception_mutation();

comment on table public.commerce_seo_release_branch_exceptions is
  'Owner-approved, immutable, SHA/Worker version/Build/deployment scoped Production branch exceptions; no general branch migration or deploy permission.';
