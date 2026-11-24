\set ON_ERROR_STOP on
-- ONLY for disposable postgres:16 CI. No customer records.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
DO $$
BEGIN
 CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
 CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
 CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$SELECT nullif(current_setting('app.auth_uid',true),'')::uuid$$;
CREATE FUNCTION public.current_user_role() RETURNS text LANGUAGE sql STABLE AS
  $$SELECT current_setting('app.user_role',true)$$;
CREATE TABLE storage.buckets (
 id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects (bucket_id text,name text);
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
  $$SELECT string_to_array($1,'/')$$;
SELECT set_config('app.auth_uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
SELECT set_config('app.user_role','owner',false);
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
\ir ../../supabase/migrations/20261118135133_trade_evidence_library.sql
\ir ../../supabase/migrations/20261118135336_trade_evidence_anon_revoke.sql
\ir ../../supabase/migrations/20261118135723_trade_evidence_approval_edit_guard.sql
\ir ../../supabase/migrations/20261124110000_trade_evidence_real_deal_economics.sql

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='public.trade_evidence_economics_v'::regclass
     AND 'security_invoker=true'=ANY(c.reloptions)) THEN
  RAISE EXCEPTION 'ECONOMICS_VIEW_NOT_INVOKER';
 END IF;
 IF has_table_privilege('anon','public.trade_evidence_economics_v','SELECT') OR
  NOT has_table_privilege('authenticated','public.trade_evidence_economics_v','SELECT')
 THEN RAISE EXCEPTION 'FINANCE_VIEW_ACL_FAILURE'; END IF;
 IF EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='trade_evidence_ai_ready_v'
      AND column_name IN ('transaction_amount','repair_cost','realized_gross_profit_after_direct_costs')
 ) THEN RAISE EXCEPTION 'PRIVATE_COST_LEAKS_TO_PUBLIC_AI'; END IF;
END $$;

-- Fake 1 unit. Purchase costs 10,000 + 300 repair + 200 inbound.
INSERT INTO public.trade_evidence
(id,kind,deal_code,occurred_on,title,quantity,transaction_amount,
 repair_cost,shipping_cost,verification_reference,customer_channel,channel_evidence)
VALUES
('bbbbbbbb-0000-4000-8000-000000000001','purchase','AMP-TEST-001','2026-11-24','Test laptop',1,10000,300,200,'PURCHASE-001','GOOGLE','CUSTOMER_STATED');

DO $$
BEGIN
 BEGIN
  UPDATE public.trade_evidence SET transaction_verified=true
  WHERE id='bbbbbbbb-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'VERIFIED_WITHOUT_PRIVATE_IMAGE';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
INSERT INTO public.trade_evidence_images(evidence_id,storage_path)
VALUES('bbbbbbbb-0000-4000-8000-000000000001',
       'bbbbbbbb-0000-4000-8000-000000000001/receipt.jpg');
SELECT set_config('app.user_role','admin',false);
DO $$
BEGIN
 BEGIN
  UPDATE public.trade_evidence SET transaction_verified=true
  WHERE id='bbbbbbbb-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'ADMIN_WAS_ALLOWED_TO_VERIFY';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
SELECT set_config('app.user_role','owner',false);
UPDATE public.trade_evidence SET transaction_verified=true
WHERE id='bbbbbbbb-0000-4000-8000-000000000001';

-- Admin cannot overwrite the owner/timestamp on an already verified receipt.
SELECT set_config('app.user_role','admin',false);
UPDATE public.trade_evidence SET transaction_verified_at='2000-01-01T00:00:00Z',
 transaction_verified_by='bbbbbbbb-0000-4000-8000-000000000099'
WHERE id='bbbbbbbb-0000-4000-8000-000000000001';
DO $
DECLARE r record;
BEGIN
 SELECT transaction_verified,transaction_verified_at,transaction_verified_by INTO r
 FROM public.trade_evidence WHERE id='bbbbbbbb-0000-4000-8000-000000000001';
 IF NOT r.transaction_verified OR r.transaction_verified_at<'2026-11-01'
   OR r.transaction_verified_by<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 THEN RAISE EXCEPTION 'VERIFICATION_METADATA_TAMPERED'; END IF;
END $;
SELECT set_config('app.user_role','owner',false);

-- Real 14k sale matched to purchase; shipping 80 + platform 420.
INSERT INTO public.trade_evidence
(id,kind,deal_code,occurred_on,title,quantity,transaction_amount,
 shipping_cost,platform_fee,verification_reference)
VALUES('bbbbbbbb-0000-4000-8000-000000000002','sale','AMP-TEST-001',
 '2026-11-24','Test laptop',1,14000,80,420,'SALE-001');
INSERT INTO public.trade_evidence_images(evidence_id,storage_path)
VALUES('bbbbbbbb-0000-4000-8000-000000000002',
       'bbbbbbbb-0000-4000-8000-000000000002/sale.jpg');
UPDATE public.trade_evidence SET transaction_verified=true
WHERE id='bbbbbbbb-0000-4000-8000-000000000002';

DO $$
DECLARE row record;
BEGIN
 SELECT * INTO row FROM public.trade_evidence_economics_v;
 IF (SELECT count(*) FROM public.trade_evidence_economics_v)<>1
   OR row.realized_gross_profit_after_direct_costs<>3000
   OR row.seo_attribution_proven<>false
   OR row.buyer_acquisition_channel<>'GOOGLE'
   OR row.buyer_channel_evidence<>'CUSTOMER_STATED'
 THEN RAISE EXCEPTION 'REALIZED_PROFIT_MUST_BE_3000_BUT_NOT_SEO_ATTRIBUTION';END IF;
END $$;

-- Duplicate unit sale is rejected, before any possibility of double counting.
DO $$
BEGIN
 BEGIN
  INSERT INTO public.trade_evidence(kind,deal_code,title,transaction_amount)
  VALUES('sale','amp-test-001','Duplicate sale',999);
  RAISE EXCEPTION 'DUPLICATE_SALE_CODE_ALLOWED';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $$;

-- Changing cost after verification must invalidate count until owner reverifies.
UPDATE public.trade_evidence SET repair_cost=600
WHERE id='bbbbbbbb-0000-4000-8000-000000000001';
DO $$
BEGIN
 IF (SELECT transaction_verified FROM public.trade_evidence WHERE id='bbbbbbbb-0000-4000-8000-000000000001')
 OR (SELECT count(*) FROM public.trade_evidence_economics_v)<>0
 THEN RAISE EXCEPTION 'COST_EDIT_DID_NOT_REVOKE_VERIFICATION';END IF;
END $$;
UPDATE public.trade_evidence SET transaction_verified=true
WHERE id='bbbbbbbb-0000-4000-8000-000000000001';

-- Partial lot sale never counts as complete gross profit.
UPDATE public.trade_evidence SET quantity=2
WHERE id='bbbbbbbb-0000-4000-8000-000000000002';
UPDATE public.trade_evidence SET transaction_verified=true
WHERE id='bbbbbbbb-0000-4000-8000-000000000002';
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM public.trade_evidence_economics_v)
 THEN RAISE EXCEPTION 'PARTIAL_LOT_INFLATED_PROFIT';END IF;
END $$;

-- Deleting image revokes transaction verification; public approval also reset.
DELETE FROM public.trade_evidence_images
WHERE evidence_id='bbbbbbbb-0000-4000-8000-000000000001';
DO $$BEGIN
 IF (SELECT transaction_verified FROM public.trade_evidence WHERE id='bbbbbbbb-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'IMAGE_REMOVAL_DID_NOT_REVOKE_VERIFICATION';END IF;
END $$;
\echo 'PASS: owner-only real trade verification, correct margin, RLS and no inferred SEO income'
