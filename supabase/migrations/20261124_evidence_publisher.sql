-- DRAFT only. Must be separately approved and staged before any Production database change.
-- Private media staging; NO PUBLIC URL, and no client grants.
create table if not exists public.commerce_evidence_publication_requests (
 id uuid primary key default gen_random_uuid(),
 evidence_id uuid not null references public.trade_evidence(id) on delete restrict,
 image_id uuid not null references public.trade_evidence_images(id) on delete restrict,
 site_id text not null references public.commerce_seo_sites(id),
 page_path text not null,
 private_media_key text not null,
 claim_kind text not null check (claim_kind in ('ASSESSMENT_ONLY','VERIFIED_TRANSACTION')),
 status text not null default 'PENDING_SOURCE_PR'
   check (status in ('PENDING_SOURCE_PR','DRAFT_PR_OPEN','RELEASED','CANCELLED')),
 requested_by uuid not null references auth.users(id),
 requested_at timestamptz not null default now(),
 draft_pr_number integer,
 draft_pr_url text,
 draft_commit_sha text,
 release_commit_sha text,
 released_at timestamptz,
 unique (evidence_id,image_id,site_id,page_path),
 check (left(page_path,1)='/' and left(page_path,2)<>'//' and length(page_path)<=2048),
 check (private_media_key ~ '^evidence/[0-9a-f-]{36}/[0-9a-f-]{36}[.]webp$'),
 check ((status <> 'DRAFT_PR_OPEN') or (draft_pr_number > 0 and draft_pr_url is not null)),
 check ((status <> 'RELEASED') or (release_commit_sha is not null and released_at is not null))
);
alter table public.commerce_evidence_publication_requests enable row level security;
revoke all on public.commerce_evidence_publication_requests from PUBLIC, anon, authenticated;
create index if not exists evidence_publication_pending_by_site
 on public.commerce_evidence_publication_requests(site_id,status,requested_at desc);

-- Explicit site-page -> source file mapping. No user-supplied arbitrary repository or source file.
-- Privileged operators must independently verify every mapping against the live repo.
create table if not exists public.commerce_evidence_page_source_mappings (
 site_id text not null references public.commerce_seo_sites(id),
 page_path text not null,
 source_path text not null,
 insert_before text not null,
 expected_base_sha text not null,
 enabled boolean not null default false,
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 primary key(site_id,page_path),
 check (page_path like '/%' and length(page_path)<=2048),
 check (length(source_path) between 10 and 220),
 check (length(insert_before) between 10 and 300),
 check (expected_base_sha ~ '^[0-9a-f]{40}
 check (not enabled or (reviewed_by is not null and reviewed_at is not null))
);
alter table public.commerce_evidence_page_source_mappings enable row level security;
revoke all on public.commerce_evidence_page_source_mappings from PUBLIC, anon, authenticated;

-- NOTE: No mappings auto-enabled. Job #22 requires explicit review of target source
-- and registered production branch before any GitHub Draft PR automation.
),
 check (not enabled or (reviewed_by is not null and reviewed_at is not null))
);
alter table public.commerce_evidence_page_source_mappings enable row level security;
revoke all on public.commerce_evidence_page_source_mappings from PUBLIC, anon, authenticated;

-- NOTE: No mappings auto-enabled. Job #22 requires explicit review of target source
-- and registered production branch before any GitHub Draft PR automation.
