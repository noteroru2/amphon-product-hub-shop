\set ON_ERROR_STOP on

-- Disposable PostgreSQL 16 schema simulation for SQL privilege/migration checks.
-- This is NOT Supabase Production/Staging and contains synthetic records only.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
-- Match real Supabase default grants in public.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;

CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),active boolean NOT NULL,role text NOT NULL);
CREATE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$SELECT p.role FROM public.profiles p WHERE p.id=auth.uid() AND p.active=true LIMIT 1$$;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;

CREATE TABLE public.commerce_seo_sites(id text PRIMARY KEY,origin text NOT NULL,enabled boolean NOT NULL);
CREATE TABLE public.commerce_seo_portfolio_projects(site_id text PRIMARY KEY, mapping_status text,
 production_repo text, production_branch text);
CREATE TABLE public.commerce_seo_portfolio_keyword_roles(site_id text,keyword text,
 approval_status text,target_page text);
CREATE TABLE public.commerce_seo_content_jobs(id bigint PRIMARY KEY,site_id text,
 page text,focus_query text,evidence_id bigint,status text);
CREATE TABLE public.commerce_seo_content_evidence(id bigint PRIMARY KEY,job_id bigint,
 source_url text,source_at timestamptz);
CREATE TABLE public.seo_connector_receipts(id uuid PRIMARY KEY,actor uuid,site_id text,
 query_request jsonb,created_at timestamptz);

INSERT INTO auth.users(id) VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333');
INSERT INTO public.profiles(id,active,role) VALUES
 ('11111111-1111-4111-8111-111111111111',true,'owner'),
 ('22222222-2222-4222-8222-222222222222',true,'admin'),
 ('33333333-3333-4333-8333-333333333333',true,'staff');
INSERT INTO public.commerce_seo_sites VALUES ('amphon','https://amphon.co.th',true);
INSERT INTO public.commerce_seo_portfolio_projects
VALUES ('amphon','VERIFIED','noteroru2/amphon.co.th','release/cloudflare-production');
INSERT INTO public.commerce_seo_portfolio_keyword_roles
VALUES ('amphon','รับซื้อโน๊ตบุ๊ค','APPROVED','https://amphon.co.th/services/notebook');
INSERT INTO public.commerce_seo_content_jobs
VALUES (16,'amphon','https://amphon.co.th/services/notebook','รับซื้อโน๊ตบุ๊ค',20,'EVIDENCE_READY');
INSERT INTO public.commerce_seo_content_evidence
VALUES (20,16,'https://amphon.co.th/services/notebook',now()-interval '1 day');
INSERT INTO public.seo_connector_receipts
VALUES ('711d5aba-710a-4db7-a1d9-d1df4558ec40',
'11111111-1111-4111-8111-111111111111','amphon',
jsonb_build_object('page','https://amphon.co.th/services/notebook','query','รับซื้อโน๊ตบุ๊ค'),now()-interval '1 hour');

\ir ../../supabase/migrations/20261123094500_seo_source_change_requests.sql
\ir ../../supabase/migrations/20261123103000_seo_source_change_pr_runs.sql

-- Schema ACL must never grant runtime/browser mutation of reviewed requests.
DO $$
BEGIN
 IF has_table_privilege('authenticated','public.commerce_seo_source_change_requests','INSERT')
 OR has_table_privilege('authenticated','public.commerce_seo_source_change_requests','UPDATE')
 OR has_table_privilege('authenticated','public.commerce_seo_source_change_requests','DELETE')
 OR has_table_privilege('service_role','public.commerce_seo_source_change_requests','UPDATE')
 OR has_table_privilege('service_role','public.commerce_seo_source_change_requests','DELETE')
 OR has_table_privilege('service_role','public.commerce_seo_source_change_requests','DELETE')
 OR has_table_privilege('service_role','public.commerce_seo_source_change_pr_runs','UPDATE')
 OR has_table_privilege('service_role','public.commerce_seo_source_change_pr_runs','DELETE')
 OR has_table_privilege('service_role','public.commerce_seo_source_change_pr_runs','DELETE')
 OR has_table_privilege('anon','public.commerce_seo_source_change_requests','SELECT')
 THEN RAISE EXCEPTION 'SQL privilege contract violated'; END IF;
 IF has_function_privilege('anon','public.review_seo_source_change_request(uuid,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'ANON_RPC_EXECUTE_EXPOSED'; END IF;
END $$;

INSERT INTO public.commerce_seo_source_change_requests
 (id,site_id,job_id,evidence_id,gsc_receipt_id,target_page,focus_query,
 target_repository,target_branch,expected_base_sha,requested_paths,change_kind,
 summary,rationale,proposed_change,requested_by,request_fingerprint)
VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','amphon',16,20,
 '711d5aba-710a-4db7-a1d9-d1df4558ec40',
 'https://amphon.co.th/services/notebook','รับซื้อโน๊ตบุ๊ค',
 'noteroru2/amphon.co.th','release/cloudflare-production',
 repeat('a',40),ARRAY['src/pages/notebook.astro'],'CONTENT',
 'Improve notebook-specific inspection explanation with real process details',
 'The page currently lacks the shop condition-check workflow and buyer trust cues',
 '{"schema":"amphon.seo.literal-edits.v1","edits":[]}',
 '11111111-1111-4111-8111-111111111111',repeat('f',64));

-- No PR receipt before OWNER review, even for service role.
SET ROLE service_role;
DO $$
DECLARE actual text;
BEGIN
 BEGIN
  INSERT INTO public.commerce_seo_source_change_pr_runs
  (request_id,site_id,repository,target_branch,base_commit_sha,draft_branch,
   pr_number,pr_url,pr_head_sha,change_sha256,changed_paths)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','amphon',
    'noteroru2/amphon.co.th','release/cloudflare-production',repeat('a',40),
    'seo/owner-reviewed-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',18,
    'https://github.com/noteroru2/amphon.co.th/pull/18',repeat('b',40),
    repeat('e',64),ARRAY['src/pages/notebook.astro']);
  RAISE EXCEPTION 'BYPASS: insert unapproved PR receipt succeeded';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual = MESSAGE_TEXT;
  IF actual <> 'SEO_SOURCE_DRAFT_PR_OWNER_APPROVAL_REQUIRED' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;

-- Authenticated STAFF can neither read the owner queue nor review it.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
DO $$
DECLARE actual text;
BEGIN
 IF (SELECT count(*) FROM public.commerce_seo_source_change_requests) <> 0
 THEN RAISE EXCEPTION 'BYPASS: STAFF could read queue'; END IF;
 BEGIN
  PERFORM public.review_seo_source_change_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','APPROVE_FOR_DRAFT_PR');
  RAISE EXCEPTION 'BYPASS: STAFF approved';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual = MESSAGE_TEXT;
  IF actual <> 'SEO_SOURCE_OWNER_REQUIRED' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;

-- ADMIN can view only, cannot approve.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
DO $$
DECLARE actual text;
BEGIN
 IF (SELECT count(*) FROM public.commerce_seo_source_change_requests) <> 1
 THEN RAISE EXCEPTION 'Admin should be able to view source queue'; END IF;
 BEGIN
  PERFORM public.review_seo_source_change_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','APPROVE_FOR_DRAFT_PR');
  RAISE EXCEPTION 'BYPASS: ADMIN approved';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual = MESSAGE_TEXT;
  IF actual <> 'SEO_SOURCE_OWNER_REQUIRED' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;

-- OWNER alone can approve, and only once; direct SQL updates remain denied.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $$
DECLARE actual text;
BEGIN
 IF (SELECT count(*) FROM public.commerce_seo_source_change_requests) <> 1
 THEN RAISE EXCEPTION 'Owner cannot read source queue'; END IF;
 BEGIN
  UPDATE public.commerce_seo_source_change_requests SET status='REJECTED';
  RAISE EXCEPTION 'BYPASS: direct owner update succeeded';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual = MESSAGE_TEXT;
  IF position('permission denied' in actual) = 0 THEN RAISE; END IF;
 END;
END $$;
SELECT public.review_seo_source_change_request(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','APPROVE_FOR_DRAFT_PR','Reviewed exact path and GSC evidence');
DO $$
DECLARE actual text;
BEGIN
 BEGIN
  PERFORM public.review_seo_source_change_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','REJECT');
  RAISE EXCEPTION 'BYPASS: reviewed twice';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual = MESSAGE_TEXT;
  IF actual <> 'SEO_SOURCE_ALREADY_REVIEWED' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;

-- SERVICE ROLE can only append the one bound Draft PR receipt.
SET ROLE service_role;
INSERT INTO public.commerce_seo_source_change_pr_runs
(request_id,site_id,repository,target_branch,base_commit_sha,draft_branch,
 pr_number,pr_url,pr_head_sha,change_sha256,changed_paths)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','amphon',
 'noteroru2/amphon.co.th','release/cloudflare-production',repeat('a',40),
 'seo/owner-reviewed-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',18,
 'https://github.com/noteroru2/amphon.co.th/pull/18',repeat('b',40),
 repeat('e',64),ARRAY['src/pages/notebook.astro']);
DO $$
DECLARE actual text;
BEGIN
 BEGIN
  INSERT INTO public.commerce_seo_source_change_pr_runs
  (request_id,site_id,repository,target_branch,base_commit_sha,draft_branch,
   pr_number,pr_url,pr_head_sha,change_sha256,changed_paths)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','amphon',
    'noteroru2/amphon.co.th','release/cloudflare-production',repeat('a',40),
    'seo/owner-reviewed-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',18,
    'https://github.com/noteroru2/amphon.co.th/pull/18',repeat('b',40),
    repeat('e',64),ARRAY['src/pages/notebook.astro']);
  RAISE EXCEPTION 'BYPASS: duplicate receipt';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual = MESSAGE_TEXT;
  IF position('duplicate key' in actual) = 0 THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;

-- Anon users cannot read PR receipts.
SET ROLE anon;
DO $$
DECLARE actual text;
BEGIN
 BEGIN
  PERFORM count(*) FROM public.commerce_seo_source_change_pr_runs;
  RAISE EXCEPTION 'BYPASS: anon read receipt';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual = MESSAGE_TEXT;
  IF position('permission denied' in actual) = 0 THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;

\echo 'PASS: isolated PostgreSQL Source Change OWNER/ADMIN/STAFF/ANON/RLS/PR receipt migration contract'
