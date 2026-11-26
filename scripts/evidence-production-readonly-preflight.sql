-- AMPHON Evidence Publisher: SELECT-only production preflight.
-- Safe to run via Supabase SQL editor or MCP execute_sql in read-only mode.
-- Do not modify roles, policies, tables, backups, credentials or real evidence.
-- All output is non-personal metadata.  NO DDL.  NO DML.

WITH existing AS (
 SELECT c.relname AS name,c.relrowsecurity AS rls_enabled
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname IN
 ('trade_evidence','trade_evidence_images','commerce_seo_sites',
  'commerce_seo_portfolio_projects','profiles')
), types AS (
 SELECT table_name,column_name,udt_name FROM information_schema.columns
 WHERE (table_schema='public' AND
   (table_name='trade_evidence' AND column_name='id' OR
    table_name='trade_evidence_images' AND column_name IN ('id','evidence_id') OR
    table_name='commerce_seo_sites' AND column_name='id' OR
    table_name='profiles' AND column_name='id'))
   OR (table_schema='auth' AND table_name='users' AND column_name='id')
)
SELECT
 current_setting('server_version') AS postgresql_version,
 (SELECT count(*)=5 AND bool_and(rls_enabled) FROM existing) AS five_source_tables_rls_enabled,
 (SELECT count(*)=6 AND
   bool_and(CASE WHEN table_name='commerce_seo_sites'
     THEN udt_name='text' ELSE udt_name='uuid' END) FROM types) AS exact_fk_key_types_match,
 to_regclass('public.commerce_evidence_publication_requests') IS NULL AS private_queue_absent,
 to_regclass('public.commerce_evidence_page_source_mappings') IS NULL AS reviewed_mapping_absent,
 EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') AS service_role_exists,
 EXISTS (SELECT 1 FROM pg_proc WHERE proname='gen_random_uuid') AS uuid_function_exists,
 EXISTS (SELECT 1 FROM storage.buckets
   WHERE name='trade-evidence-private' AND public=false) AS source_bucket_remains_private;
