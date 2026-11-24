-- Ephemeral PostgreSQL 17 CI ONLY. Synthetic schema; NO production connection or PII.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.trade_evidence(id uuid PRIMARY KEY);
CREATE TABLE public.trade_evidence_images(id uuid PRIMARY KEY,evidence_id uuid NOT NULL REFERENCES public.trade_evidence(id));
CREATE TABLE public.commerce_seo_sites(id text PRIMARY KEY);
INSERT INTO auth.users(id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.trade_evidence(id) VALUES ('dd8cbc49-1caf-477c-b579-955007517b61');
INSERT INTO public.trade_evidence_images(id,evidence_id) VALUES ('8ebfb3f2-1d13-404f-9cfa-93ef40672f16','dd8cbc49-1caf-477c-b579-955007517b61');
INSERT INTO public.commerce_seo_sites(id) VALUES ('amphon');
