-- AMPHON Evidence Publisher V1: staging-only schema, NOT applied to Production.
-- Owner activation and nonzero Supabase Branch cost require separate explicit approval.
-- Queue and page mapping are private; all browser-accessible roles are denied.
CREATE TABLE IF NOT EXISTS public.commerce_evidence_publication_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- If a customer photo/evidence is deleted, its unpublished queue metadata must
  -- not block erasure. Removing queue rows never publishes or deletes media in R2.
  evidence_id uuid NOT NULL REFERENCES public.trade_evidence(id) ON DELETE CASCADE,
  image_id uuid NOT NULL REFERENCES public.trade_evidence_images(id) ON DELETE CASCADE,
  site_id text NOT NULL REFERENCES public.commerce_seo_sites(id),
  page_path text NOT NULL,
  private_media_key text NOT NULL,
  claim_kind text NOT NULL CHECK (claim_kind IN ('ASSESSMENT_ONLY','VERIFIED_TRANSACTION')),
  status text NOT NULL DEFAULT 'PENDING_SOURCE_PR'
    CHECK (status IN ('PENDING_SOURCE_PR','DRAFT_PR_OPEN','RELEASED','CANCELLED')),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  draft_pr_number integer,
  draft_pr_url text,
  draft_commit_sha text,
  release_commit_sha text,
  released_at timestamptz,
  UNIQUE (evidence_id,image_id,site_id,page_path),
  CHECK (left(page_path,1)='/' AND left(page_path,2)<>'//' AND length(page_path)<=2048),
  CHECK (private_media_key ~ '^evidence/[0-9a-f-]{36}/[0-9a-f-]{36}[.]webp$'),
  CHECK (status <> 'DRAFT_PR_OPEN' OR (draft_pr_number > 0 AND draft_pr_url IS NOT NULL)),
  CHECK (status <> 'RELEASED' OR (release_commit_sha IS NOT NULL AND released_at IS NOT NULL))
);
ALTER TABLE public.commerce_evidence_publication_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commerce_evidence_publication_requests FROM PUBLIC, anon, authenticated;
-- Service role API key is server-only; explicit grants are needed when the
-- Data API defaults to denying new objects to all roles.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commerce_evidence_publication_requests TO service_role;
CREATE INDEX IF NOT EXISTS evidence_publication_pending_by_site
  ON public.commerce_evidence_publication_requests (site_id,status,requested_at DESC);

-- Destination URL -> reviewed, exact content source file. Disabled by default.
-- Does NOT use trade_evidence's customer-acquisition attribution as destination.
CREATE TABLE IF NOT EXISTS public.commerce_evidence_page_source_mappings (
  site_id text NOT NULL REFERENCES public.commerce_seo_sites(id),
  page_path text NOT NULL,
  source_path text NOT NULL,
  insert_before text NOT NULL,
  expected_base_sha text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  PRIMARY KEY (site_id,page_path),
  CHECK (page_path LIKE '/%' AND left(page_path,2)<>'//' AND length(page_path)<=2048),
  CHECK (length(source_path) BETWEEN 10 AND 220),
  CHECK (length(insert_before) BETWEEN 10 AND 300),
  CHECK (expected_base_sha ~ '^[0-9a-f]{40}$'),
  CHECK (NOT enabled OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
ALTER TABLE public.commerce_evidence_page_source_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commerce_evidence_page_source_mappings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.commerce_evidence_page_source_mappings TO service_role;

-- No page mappings are enabled, no queue rows are inserted and no image is made
-- public merely by running this migration. Never merge migration into Production
-- without separate owner authorization.
