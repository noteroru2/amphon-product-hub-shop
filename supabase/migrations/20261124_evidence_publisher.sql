-- AMPHON Evidence Publisher V1: gated source-request queue, never an automatic deploy.
-- Apply only after PR review and explicit owner migration approval.
create table if not exists public.commerce_evidence_publication_requests (
 id uuid primary key default gen_random_uuid(),
 evidence_id uuid not null references public.trade_evidence(id) on delete restrict,
 image_id uuid not null references public.trade_evidence_images(id) on delete restrict,
 site_id text not null references public.commerce_seo_sites(id),
 page_path text not null,
 public_media_key text not null,
 public_media_url text not null,
 claim_kind text not null check (claim_kind in ('ASSESSMENT_ONLY','VERIFIED_TRANSACTION')),
 status text not null default 'PENDING_SOURCE_PR'
    check (status in ('PENDING_SOURCE_PR','DRAFT_PR_OPEN','RELEASED','CANCELLED')),
 requested_by uuid not null references auth.users(id),
 requested_at timestamptz not null default now(),
 draft_pr_url text,
 release_commit_sha text,
 released_at timestamptz,
 unique (evidence_id, image_id, site_id, page_path),
 check (page_path like '/%' and length(page_path)<=2048),
 check (public_media_key like 'evidence/%'),
 check (status <> 'RELEASED' or (release_commit_sha is not null and released_at is not null))
);
alter table public.commerce_evidence_publication_requests enable row level security;
revoke all on public.commerce_evidence_publication_requests from anon, authenticated;
-- Writes only through server after bearer auth owner role and explicit checks.
-- No client-side ability to set RELEASED or change published receipt.
create index if not exists evidence_publication_pending_by_site
on public.commerce_evidence_publication_requests (site_id, status, requested_at desc);
