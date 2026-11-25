-- Verify migration safety/constraints using only fake objects in ephemeral CI DB.
DO $$
DECLARE
  rec uuid;
  expected_prefix text := 'evidence/dd8cbc49-1caf-477c-b579-955007517b61/8ebfb3f2-1d13-404f-9cfa-93ef40672f16.webp';
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.commerce_evidence_publication_requests'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.commerce_evidence_page_source_mappings'::regclass)
  THEN RAISE EXCEPTION 'RLS_MISSING'; END IF;
  IF NOT has_table_privilege('service_role','public.commerce_evidence_publication_requests','INSERT') OR
     NOT has_table_privilege('service_role','public.commerce_evidence_page_source_mappings','SELECT')
  THEN RAISE EXCEPTION 'SERVICE_ROLE_PERMISSION_MISSING'; END IF;
  IF has_table_privilege('anon','public.commerce_evidence_publication_requests','SELECT') OR
     has_table_privilege('authenticated','public.commerce_evidence_publication_requests','INSERT') OR
     has_table_privilege('anon','public.commerce_evidence_page_source_mappings','SELECT') OR
     has_table_privilege('authenticated','public.commerce_evidence_page_source_mappings','INSERT')
  THEN RAISE EXCEPTION 'DATA_API_ROLES_EXPOSED'; END IF;
  INSERT INTO public.commerce_evidence_publication_requests(
    evidence_id,image_id,site_id,page_path,private_media_key,claim_kind,requested_by
  ) VALUES(
    'dd8cbc49-1caf-477c-b579-955007517b61','8ebfb3f2-1d13-404f-9cfa-93ef40672f16',
    'amphon','/บริการ/รับซื้อโน๊ตบุ๊ค',expected_prefix,'ASSESSMENT_ONLY',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) RETURNING id INTO rec;
  IF rec IS NULL THEN RAISE EXCEPTION 'INSERT_FAILED'; END IF;
  BEGIN
    INSERT INTO public.commerce_evidence_publication_requests(
      evidence_id,image_id,site_id,page_path,private_media_key,claim_kind,requested_by
    ) VALUES ('dd8cbc49-1caf-477c-b579-955007517b61','8ebfb3f2-1d13-404f-9cfa-93ef40672f16',
      'amphon','/บริการ/รับซื้อโน๊ตบุ๊ค',expected_prefix,'ASSESSMENT_ONLY',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    RAISE EXCEPTION 'DUPLICATE_WAS_ACCEPTED';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    UPDATE public.commerce_evidence_publication_requests SET status='RELEASED' WHERE id=rec;
    RAISE EXCEPTION 'PREMATURE_RELEASE_WAS_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.commerce_evidence_publication_requests SET status='DRAFT_PR_OPEN' WHERE id=rec;
    RAISE EXCEPTION 'UNVERIFIED_DRAFT_PR_WAS_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.commerce_evidence_publication_requests SET private_media_key='https://public.example/photo.webp' WHERE id=rec;
    RAISE EXCEPTION 'PUBLIC_MEDIA_REFERENCE_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO public.commerce_evidence_page_source_mappings(
    site_id,page_path,source_path,insert_before,expected_base_sha
  ) VALUES ('amphon','/บริการ/รับซื้อโน๊ตบุ๊ค','src/content/services/รับซื้อโน๊ตบุ๊ค.md',
    '## ส่งรูปเช็กราคาโน๊ตบุ๊คก่อนตัดสินใจ',repeat('a',40));
  IF (SELECT enabled FROM public.commerce_evidence_page_source_mappings
      WHERE site_id='amphon') THEN RAISE EXCEPTION 'DEFAULT_MAPPING_ENABLED'; END IF;
  BEGIN
    UPDATE public.commerce_evidence_page_source_mappings SET enabled=true WHERE site_id='amphon';
    RAISE EXCEPTION 'UNREVIEWED_MAPPING_ENABLED';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'PASS: private queue, no client grants, idempotence, release gates, reviewed mappings';
END $$;
