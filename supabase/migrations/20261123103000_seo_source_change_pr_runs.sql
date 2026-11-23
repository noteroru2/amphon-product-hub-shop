-- P3: record ONLY draft Pull Requests resulting from owner-approved Source Change Requests.
-- Staged in GitHub; must run after 20261123094500_seo_source_change_requests.sql.
-- No GitHub secret stored, no Deploy permission granted.
create table if not exists public.commerce_seo_source_change_pr_runs (
  request_id uuid primary key references public.commerce_seo_source_change_requests(id),
  site_id text not null references public.commerce_seo_sites(id),
  repository text not null check (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  target_branch text not null,
  base_commit_sha text not null check (base_commit_sha ~ '^[a-f0-9]{40}$'),
  draft_branch text not null unique check (draft_branch ~ '^seo/owner-reviewed-[a-f0-9-]{36}$'),
  pr_number integer not null check (pr_number > 0),
  pr_url text not null unique check (pr_url ~ '^https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+$'),
  pr_head_sha text not null check (pr_head_sha ~ '^[a-f0-9]{40}$'),
  change_sha256 text not null check (change_sha256 ~ '^[a-f0-9]{64}$'),
  changed_paths text[] not null check (cardinality(changed_paths) between 1 and 8),
  created_at timestamptz not null default now()
);

create index if not exists commerce_seo_source_change_pr_runs_site_idx
  on public.commerce_seo_source_change_pr_runs(site_id, created_at desc);
alter table public.commerce_seo_source_change_pr_runs enable row level security;
revoke all on public.commerce_seo_source_change_pr_runs from public, anon, authenticated;
grant select on public.commerce_seo_source_change_pr_runs to authenticated;
grant select, insert on public.commerce_seo_source_change_pr_runs to service_role;

drop policy if exists seo_source_change_pr_owner_admin_read on public.commerce_seo_source_change_pr_runs;
create policy seo_source_change_pr_owner_admin_read on public.commerce_seo_source_change_pr_runs
 for select to authenticated
 using (public.current_user_role() in ('owner','admin'));

-- Defense-in-depth: disallow storing a PR receipt for a request that was not
-- owner-approved, has a changed target, mismatched file paths, or bad PR URL.
create or replace function public.validate_seo_source_change_pr_run()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v public.commerce_seo_source_change_requests%rowtype;
begin
  select * into v from public.commerce_seo_source_change_requests
    where id=new.request_id;
  if not found or v.status <> 'APPROVED_FOR_DRAFT_PR'
    or v.reviewed_by is null or v.reviewed_at is null then
    raise exception 'SEO_SOURCE_DRAFT_PR_OWNER_APPROVAL_REQUIRED';
  end if;
  if new.site_id <> v.site_id
    or new.repository <> v.target_repository
    or new.target_branch <> v.target_branch
    or new.base_commit_sha <> v.expected_base_sha
    or new.draft_branch <> 'seo/owner-reviewed-' || v.id::text
    or new.changed_paths <> v.requested_paths
    or new.pr_url <> 'https://github.com/' || v.target_repository || '/pull/' || new.pr_number::text then
    raise exception 'SEO_SOURCE_DRAFT_PR_RECEIPT_MISMATCH';
  end if;
  return new;
end;
$$;
drop trigger if exists validate_seo_source_change_pr_run on public.commerce_seo_source_change_pr_runs;
create trigger validate_seo_source_change_pr_run before insert
on public.commerce_seo_source_change_pr_runs
for each row execute function public.validate_seo_source_change_pr_run();

comment on table public.commerce_seo_source_change_pr_runs is
  'Immutable, owner-reviewed Draft PR receipts. No automatic merge or production deployment.';
