\set ON_ERROR_STOP on
-- Disposable PostgreSQL 16 only. Fake, non-customer records.
ALTER TABLE public.commerce_seo_sites ADD COLUMN IF NOT EXISTS label text;
UPDATE public.commerce_seo_sites SET label='AMPHON' WHERE id='amphon';
INSERT INTO public.commerce_seo_sites (id,origin,enabled,label)
VALUES ('shop','https://shop.amphon.co.th',true,'Shop');
CREATE TABLE public.commerce_seo_contact_events (
  id uuid primary key,
  site_id text not null,
  event_day date not null,
  source_channel text not null,
  confirmed_lead boolean not null default false,
  lead_reference text,
  sale_id uuid,
  created_at timestamptz not null default now()
);
CREATE TABLE public.commerce_seo_portfolio_attributions (
  id uuid primary key,
  site_id text not null,
  contact_event_id uuid,
  lead_reference text,
  attribution_status text not null default 'PENDING',
  purchase_verified_at timestamptz,
  sold_verified_at timestamptz,
  quantity int,
  sale_revenue numeric,
  acquisition_cost numeric,
  realized_gross_profit numeric,
  verification_source text not null default '',
  evidence_ref text not null default '',
  updated_at timestamptz not null default now()
);
ALTER TABLE public.commerce_seo_contact_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_seo_portfolio_attributions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.commerce_seo_sites,
 public.commerce_seo_contact_events,public.commerce_seo_portfolio_attributions TO service_role;
INSERT INTO public.commerce_seo_contact_events(id,site_id,event_day,source_channel,confirmed_lead)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001','amphon','2026-11-24','ORGANIC_SEARCH',false),
('aaaaaaaa-0000-4000-8000-000000000002','amphon','2026-11-24','UNKNOWN',false);
\ir ../../supabase/migrations/20261124035800_seo_portfolio_attribution_readiness.sql

DO $$
BEGIN
 IF has_table_privilege('anon','public.commerce_seo_portfolio_attribution_readiness_v','SELECT')
 OR has_table_privilege('authenticated','public.commerce_seo_portfolio_attribution_readiness_v','SELECT')
 OR has_table_privilege('anon','public.commerce_seo_portfolio_contact_source_daily_v','SELECT')
 OR has_table_privilege('authenticated','public.commerce_seo_portfolio_contact_source_daily_v','SELECT')
 OR NOT has_table_privilege('service_role','public.commerce_seo_portfolio_attribution_readiness_v','SELECT')
 OR NOT has_table_privilege('service_role','public.commerce_seo_portfolio_contact_source_daily_v','SELECT')
 THEN RAISE EXCEPTION 'ATTRIBUTION_READINESS_ACL_BROKEN';END IF;
 IF NOT EXISTS(
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='commerce_seo_portfolio_attribution_readiness_v'
   AND 'security_invoker=true'=ANY(c.reloptions)
 ) THEN RAISE EXCEPTION 'ATTRIBUTION_VIEW_NOT_SECURITY_INVOKER'; END IF;
END $$;

SET ROLE service_role;
DO $$
DECLARE row RECORD;
BEGIN
 SELECT * INTO row FROM public.commerce_seo_portfolio_attribution_readiness_v WHERE site_id='amphon';
 IF row.contact_click_events<>2 OR row.organic_search_labeled_clicks<>1
 OR row.unknown_channel_clicks<>1 OR row.owner_confirmed_leads<>0
 OR row.evidence_verified_sales<>0 OR row.evidence_verified_realized_gross_profit<>0
 OR row.evidence_stage<>'CLICK_ONLY_NO_CONFIRMED_LEAD'
 THEN RAISE EXCEPTION 'CLICK_ONLY_MUST_NOT_COUNT_AS_LEADS_OR_PROFIT';END IF;
 IF (SELECT sum(click_events) FROM public.commerce_seo_portfolio_contact_source_daily_v
      WHERE site_id='amphon' AND event_day='2026-11-24')<>2
 THEN RAISE EXCEPTION 'DAILY_CLICK_COUNT_MISMATCH';END IF;
END $$;
RESET ROLE;

INSERT INTO public.commerce_seo_portfolio_attributions
(id,site_id,contact_event_id,attribution_status,quantity,sale_revenue,
 acquisition_cost,realized_gross_profit,verification_source,evidence_ref)
VALUES ('aaaaaaaa-0000-4000-8000-000000000003','amphon',
 'aaaaaaaa-0000-4000-8000-000000000001','PENDING',1,1200,500,700,
 '','');
INSERT INTO public.commerce_seo_portfolio_attributions
(id,site_id,contact_event_id,attribution_status,purchase_verified_at,
 sold_verified_at,quantity,sale_revenue,acquisition_cost,realized_gross_profit,
 verification_source,evidence_ref)
VALUES ('aaaaaaaa-0000-4000-8000-000000000004','amphon',
 'aaaaaaaa-0000-4000-8000-000000000002','SOLD_VERIFIED',
 now()-interval '1 day',now(),1,1200,500,700,
 'OWNER_AUDITED','internal-proof-id');

SET ROLE service_role;
DO $$
DECLARE row RECORD;
BEGIN
 SELECT * INTO row FROM public.commerce_seo_portfolio_attribution_readiness_v WHERE site_id='amphon';
 IF row.contact_click_events<>2 OR row.owner_confirmed_leads<>0
 OR row.attribution_records<>2 OR row.attribution_pending<>1
 OR row.evidence_verified_purchases<>1 OR row.evidence_verified_sales<>1
 OR row.evidence_verified_units<>1 OR row.evidence_verified_realized_gross_profit<>700
 OR row.evidence_stage<>'REALIZED_SALE_EVIDENCED'
 THEN RAISE EXCEPTION 'STRICT_PROFIT_EVIDENCE_CONTRACT_BROKEN';END IF;
END $$;
RESET ROLE;

INSERT INTO public.commerce_seo_portfolio_attributions
(id,site_id,contact_event_id,attribution_status,purchase_verified_at,
 sold_verified_at,quantity,sale_revenue,acquisition_cost,realized_gross_profit,
 verification_source,evidence_ref)
VALUES ('aaaaaaaa-0000-4000-8000-000000000005','shop',
 'aaaaaaaa-0000-4000-8000-000000000001','SOLD_VERIFIED',
 now()-interval '1 day',now(),1,1200,500,700,'OWNER_AUDITED','');
SET ROLE service_role;
DO $$
DECLARE row RECORD;
BEGIN
 SELECT * INTO row FROM public.commerce_seo_portfolio_attribution_readiness_v WHERE site_id='shop';
 IF row.cross_site_contact_link_warnings<>1 OR row.evidence_verified_sales<>0
 OR row.evidence_verified_realized_gross_profit<>0
 OR row.evidence_stage<>'NO_CLICK_EVIDENCE'
 THEN RAISE EXCEPTION 'MISSING_EVIDENCE_MUST_NOT_INFLATE_PROFIT';END IF;
END $$;
RESET ROLE;
\echo 'PASS: synthetic strict SEO conversion attribution and no-PII view RLS contracts'
