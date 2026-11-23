-- AMPHON SEO Source Change Requests: immutable proposal + owner approval only.
-- This migration is staged in GitHub; DO NOT apply or deploy until reviewed.
-- It neither modifies website sources nor grants any deployment capability.
create table if not exists public.commerce_seo_source_change_requests (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.commerce_seo_sites(id),
  job_id bigint not null references public.commerce_seo_content_jobs(id),
  evidence_id bigint not null references public.commerce_seo_content_evidence(id),
  gsc_receipt_id uuid not null references public.seo_connector_receipts(id),
  target_page text not null,
  focus_query text not null,
  target_repository text not null,
  target_branch text not null,
  expected_base_sha text not null check (expected_base_sha ~ '^[a-f0-9]{40}$'),
  requested_paths text[] not null check (cardinality(requested_paths) between 1 and 8),
  change_kind text not null check (change_kind in ('META','CONTENT','INTERNAL_LINK','SCHEMA','TECHNICAL_SEO')),
  summary text not null check (char_length(summary) between 30 and 1200),
  rationale text not null check (char_length(rationale) between 30 and 3000),
  proposed_change text not null check (char_length(proposed_change) between 30 and 12000),
  status text not null default 'REVIEW_REQUIRED'
    check (status in ('REVIEW_REQUIRED','APPROVED_FOR_DRAFT_PR','REJECTED')),
  requested_by uuid not null references auth.users(id),
  request_fingerprint text not null unique check (char_length(request_fingerprint) = 64),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  check (target_page ~ '^https://'),
  check (target_repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  check (target_branch ~ '^[A-Za-z0-9._/-]+$' and char_length(target_branch) <= 120)
);

create index if not exists commerce_seo_source_change_requests_site_created_idx
  on public.commerce_seo_source_change_requests(site_id, created_at desc);

alter table public.commerce_seo_source_change_requests enable row level security;
revoke all on public.commerce_seo_source_change_requests from public, anon, authenticated;
grant select on public.commerce_seo_source_change_requests to authenticated;
-- Service-role OAuth connector may create and read an immutable proposal only.
-- UPDATE/DELETE of source intent is never granted: owner review uses the
-- audited SECURITY DEFINER transition function below.
-- Supabase default ACL grants service_role ALL on new public tables.
-- Revoke its inherited default ACL explicitly before reducing to READ + INSERT.
revoke all on public.commerce_seo_source_change_requests from service_role;
grant select, insert on public.commerce_seo_source_change_requests to service_role;

drop policy if exists seo_source_change_owner_admin_read on public.commerce_seo_source_change_requests;
create policy seo_source_change_owner_admin_read on public.commerce_seo_source_change_requests
  for select to authenticated
  using (public.current_user_role() in ('owner','admin'));

-- Only an authenticated owner may approve a proposal, with provenance rechecked
-- inside the transaction. An approval merely allows a human-reviewed Draft PR.
-- No GitHub token, merge, deploy, or file edit is available to this function.
create or replace function public.review_seo_source_change_request(
  p_request_id uuid,
  p_decision text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.commerce_seo_source_change_requests%rowtype;
  v_next text;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'SEO_SOURCE_OWNER_REQUIRED';
  end if;
  if p_decision not in ('APPROVE_FOR_DRAFT_PR','REJECT') then
    raise exception 'SEO_SOURCE_INVALID_DECISION';
  end if;
  if char_length(coalesce(p_note,'')) > 2000 then
    raise exception 'SEO_SOURCE_REVIEW_NOTE_TOO_LONG';
  end if;
  select * into v
  from public.commerce_seo_source_change_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'SEO_SOURCE_REQUEST_NOT_FOUND';
  end if;
  if v.status <> 'REVIEW_REQUIRED' then
    raise exception 'SEO_SOURCE_ALREADY_REVIEWED';
  end if;
  if p_decision = 'APPROVE_FOR_DRAFT_PR' then
    if not exists (
      select 1 from public.commerce_seo_sites s
      join public.commerce_seo_portfolio_projects p on p.site_id = s.id
      where s.id = v.site_id and s.enabled = true
        and p.mapping_status = 'VERIFIED'
        and p.production_repo = v.target_repository
        and p.production_branch = v.target_branch
    ) then
      raise exception 'SEO_SOURCE_MAPPING_CHANGED';
    end if;
    if not exists (
      select 1 from public.commerce_seo_portfolio_keyword_roles k
      where k.site_id = v.site_id and k.keyword = v.focus_query
        and k.approval_status = 'APPROVED'
        and (k.target_page is null or k.target_page = v.target_page)
    ) then
      raise exception 'SEO_SOURCE_KEYWORD_NOT_APPROVED';
    end if;
    if not exists (
      select 1 from public.commerce_seo_content_jobs j
      join public.commerce_seo_content_evidence e
        on e.id = v.evidence_id and e.job_id = j.id
      where j.id = v.job_id and j.site_id = v.site_id
        and j.page = v.target_page and j.focus_query = v.focus_query
        and j.evidence_id = e.id and j.status <> 'DISMISSED'
        and e.source_url = v.target_page
        and e.source_at >= now() - interval '30 days'
    ) then
      raise exception 'SEO_SOURCE_PAGE_EVIDENCE_STALE';
    end if;
    if not exists (
      select 1 from public.seo_connector_receipts r
      where r.id = v.gsc_receipt_id and r.actor = v.requested_by
        and r.site_id = v.site_id and r.created_at >= now() - interval '7 days'
        and r.query_request ->> 'query' = v.focus_query
        and r.query_request ->> 'page' = v.target_page
    ) then
      raise exception 'SEO_SOURCE_GSC_RECEIPT_STALE';
    end if;
    v_next := 'APPROVED_FOR_DRAFT_PR';
  else
    v_next := 'REJECTED';
  end if;

  update public.commerce_seo_source_change_requests
  set status = v_next,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = coalesce(p_note,'')
  where id = p_request_id;

  return jsonb_build_object(
    'id', p_request_id, 'status', v_next,
    'source_patch_performed', false, 'github_pr_created', false,
    'production_deployed', false
  );
end;
$$;

revoke all on function public.review_seo_source_change_request(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.review_seo_source_change_request(uuid,text,text) to authenticated;
comment on table public.commerce_seo_source_change_requests is
  'Evidence-backed SEO change requests; approval is only for preparing a draft GitHub PR and never means production deployment.';
