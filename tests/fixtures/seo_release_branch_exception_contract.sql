\set ON_ERROR_STOP on
-- Run after seo_source_change_postgres_contract.sql in the same disposable postgres.
\ir ../../supabase/migrations/20261124030000_seo_release_branch_exceptions.sql
INSERT INTO public.commerce_seo_release_branch_exceptions
(site_id,repository,registered_branch,approved_branch,commit_sha,hosting_provider,
 worker_script,worker_version,deployment_id,build_id,approved_at,approval_receipt_url)
VALUES ('amphon','noteroru2/amphon.co.th','release/cloudflare-production',
 'release/cloudflare-unified-astro7-20261118',repeat('a',40),'CLOUDFLARE',
 'amphon-co-th-production','0f1bcef1-a1b7-44d4-bc50-8196cae41e02',
 'cc175707-9e96-427f-9569-591254f4524b',
 'da846848-ad1c-47ff-8bdf-ea6051bcf528',
 now()-interval '1 hour',
 'https://github.com/noteroru2/amphon-product-hub-shop/issues/163#issuecomment-7120512017');

DO $$
BEGIN
 IF has_table_privilege('anon','public.commerce_seo_release_branch_exceptions','SELECT')
 OR has_table_privilege('authenticated','public.commerce_seo_release_branch_exceptions','SELECT')
 OR has_table_privilege('authenticated','public.commerce_seo_release_branch_exceptions','INSERT')
 OR has_table_privilege('service_role','public.commerce_seo_release_branch_exceptions','INSERT')
 OR has_table_privilege('service_role','public.commerce_seo_release_branch_exceptions','UPDATE')
 OR has_table_privilege('service_role','public.commerce_seo_release_branch_exceptions','DELETE')
 OR NOT has_table_privilege('service_role','public.commerce_seo_release_branch_exceptions','SELECT')
 THEN RAISE EXCEPTION 'RELEASE_BRANCH_EXCEPTION_ACL_CONTRACT_BROKEN'; END IF;
END $$;

SET ROLE service_role;
DO $$
DECLARE msg text;
BEGIN
 IF (SELECT count(*) FROM public.commerce_seo_release_branch_exceptions) <> 1
 THEN RAISE EXCEPTION 'SERVICE_ROLE_MUST_READ_EXACT_EXCEPTION'; END IF;
 BEGIN
  INSERT INTO public.commerce_seo_release_branch_exceptions
   (site_id,repository,registered_branch,approved_branch,commit_sha,hosting_provider,
    worker_script,worker_version,deployment_id,build_id,approval_receipt_url)
  VALUES ('amphon','noteroru2/amphon.co.th','main','release/evil',
    repeat('b',40),'CLOUDFLARE','worker','0f1bcef1-a1b7-44d4-bc50-8196cae41e02',
    'dc175707-9e96-427f-9569-591254f4524b',
    'da846848-ad1c-47ff-8bdf-ea6051bcf528',
    'https://github.com/noteroru2/amphon-product-hub-shop/issues/163#issuecomment-7120512017');
  RAISE EXCEPTION 'SERVICE_ROLE_INSERT_BYPASS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF position('permission denied' in msg)=0 THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;

-- Even the table owner cannot update/delete an already approved record.
DO $$
DECLARE msg text;
BEGIN
 BEGIN
  UPDATE public.commerce_seo_release_branch_exceptions SET approved_branch='release/evil';
  RAISE EXCEPTION 'EXCEPTION_UPDATE_BYPASS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'SEO_RELEASE_BRANCH_EXCEPTION_IMMUTABLE' THEN RAISE; END IF;
 END;
 BEGIN
  DELETE FROM public.commerce_seo_release_branch_exceptions;
  RAISE EXCEPTION 'EXCEPTION_DELETE_BYPASS';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'SEO_RELEASE_BRANCH_EXCEPTION_IMMUTABLE' THEN RAISE; END IF;
 END;
END $$;
\echo 'PASS: immutable owner-approved release branch exception privileges and trigger'
