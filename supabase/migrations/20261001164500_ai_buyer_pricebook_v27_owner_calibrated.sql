-- V2.7 Owner Calibrated
-- Clone V2.6, add only runtime-safe owner-derived variants, preserve ambiguous
-- owner candidates as inactive review evidence, then activate while AI remains paused.

do $$
declare
  v_old uuid;
  v_new uuid;
  v_entry uuid;
begin
  select id into v_old
  from public.ai_buyer_price_book_versions
  where status='ACTIVE'
  order by activated_at desc nulls last,created_at desc
  limit 1;

  if v_old is null then
    raise exception 'AI_BUYER_ACTIVE_PRICE_BOOK_MISSING';
  end if;

  select id into v_new
  from public.ai_buyer_price_book_versions
  where version_name='AMPHON Master Price Book V2.7 Owner Calibrated'
  limit 1;

  if v_new is null then
    insert into public.ai_buyer_price_book_versions(
      version_name,status,source_name,source_checksum
    ) values (
      'AMPHON Master Price Book V2.7 Owner Calibrated',
      'DRAFT',
      'V2.6 + owner manual quote learning 5D + Owner Model V2 calibration',
      'owner-v27-2026-10-01-v1'
    )
    returning id into v_new;

    insert into public.ai_buyer_price_book_entries(
      version_id,category,brand,model,model_code,aliases,spec_match,condition_key,
      estimated_resale,opening_offer,target_buy,hard_max,adjustments,active,
      normalized_brand,normalized_model,normalized_model_code,lookup_keys
    )
    select
      v_new,category,brand,model,model_code,aliases,spec_match,condition_key,
      estimated_resale,opening_offer,target_buy,hard_max,adjustments,active,
      normalized_brand,normalized_model,normalized_model_code,lookup_keys
    from public.ai_buyer_price_book_entries
    where version_id=v_old and active=true;

    insert into public.ai_buyer_spec_price_settings(
      version_id,category,base_value,target_buy_percent,hard_max_percent,
      opening_discount_percent,risk_reserve,rounding_step,confidence_gate,metadata
    )
    select
      v_new,category,base_value,target_buy_percent,hard_max_percent,
      opening_discount_percent,risk_reserve,rounding_step,confidence_gate,
      coalesce(metadata,'{}'::jsonb)
        || jsonb_build_object(
          'ownerCalibratedVersion','V2.7',
          'ownerCalibrationAt','2026-10-01'
        )
    from public.ai_buyer_spec_price_settings
    where version_id=v_old;

    insert into public.ai_buyer_spec_price_entries(
      version_id,category,component_type,lookup_key,normalized_key,numeric_value,
      confidence,metadata,active
    )
    select
      v_new,category,component_type,lookup_key,normalized_key,numeric_value,
      confidence,metadata,active
    from public.ai_buyer_spec_price_entries
    where version_id=v_old and active=true;

    insert into public.ai_buyer_price_calibration_sources(
      version_id,entry_id,source_url,source_title,source_kind,
      observed_price_thb,observed_at,note
    )
    select
      v_new,new_e.id,s.source_url,s.source_title,s.source_kind,
      s.observed_price_thb,s.observed_at,
      coalesce(s.note,'') || ' | carried forward to V2.7'
    from public.ai_buyer_price_calibration_sources s
    join public.ai_buyer_price_book_entries old_e on old_e.id=s.entry_id
    join public.ai_buyer_price_book_entries new_e
      on new_e.version_id=v_new
     and new_e.category=old_e.category
     and new_e.model=old_e.model
     and coalesce(new_e.model_code,'')=coalesce(old_e.model_code,'')
     and new_e.condition_key=old_e.condition_key
    where s.version_id=v_old;

    -- Runtime-safe owner-calibrated exact SKU:
    -- Acer Aspire Lite 16 AL16-71M-54E6, Core Ultra 5 125H / 16 / 512.
    insert into public.ai_buyer_price_book_entries(
      version_id,category,brand,model,model_code,aliases,spec_match,condition_key,
      estimated_resale,opening_offer,target_buy,hard_max,adjustments,active,
      normalized_brand,normalized_model,normalized_model_code,lookup_keys
    ) values (
      v_new,'NOTEBOOK','Acer',
      'Acer Aspire Lite 16 AL16-71M-54E6 Core Ultra 5 125H 16GB 512GB',
      'AL16-71M-54E6',
      '["Acer Aspire Lite 16 AL16-71M-54E6","Aspire Lite 16 AL16-71M-54E6"]'::jsonb,
      '{"cpu":"Intel Core Ultra 5 125H"}'::jsonb,
      'NORMAL',
      null,7000,8000,9000,'{}'::jsonb,true,
      'acer',
      'aceraspirelite16al1671m54e6coreultra5125h16gb512gb',
      'al1671m54e6',
      array[
        'aceraspirelite16al1671m54e6coreultra5125h16gb512gb',
        'aceraspirelite16al1671m54e6',
        'aspirelite16al1671m54e6',
        'al1671m54e6'
      ]
    )
    returning id into v_entry;

    insert into public.ai_buyer_price_calibration_sources(
      version_id,entry_id,source_url,source_title,source_kind,
      observed_price_thb,observed_at,note
    ) values
      (
        v_new,v_entry,'owner://case/4b91f6cd-1fa8-4e0d-a879-7eb5beeb06f2',
        'Owner manual offer: Acer Aspire Lite 16 AL16-71M-54E6',
        'OWNER_MANUAL_QUOTE',7000,date '2026-09-22',
        'Owner opening observed: 7,000-8,000 THB; calibrated opening=7,000 target=8,000 hard-max=9,000'
      ),
      (
        v_new,v_entry,'owner://case/4b91f6cd-1fa8-4e0d-a879-7eb5beeb06f2#negotiated',
        'Owner negotiated ceiling: Acer Aspire Lite 16 AL16-71M-54E6',
        'OWNER_NEGOTIATED_QUOTE',9000,date '2026-09-22',
        'Observed owner final quote after negotiation: 9,000 THB'
      );

    -- Runtime-safe storage-specific iPhone variant.
    insert into public.ai_buyer_price_book_entries(
      version_id,category,brand,model,model_code,aliases,spec_match,condition_key,
      estimated_resale,opening_offer,target_buy,hard_max,adjustments,active,
      normalized_brand,normalized_model,normalized_model_code,lookup_keys
    ) values (
      v_new,'SMARTPHONE','Apple',
      'Apple iPhone 17 Pro Max 256GB',
      'IPHONE17PROMAX-256',
      '["iPhone 17 Pro Max 256GB","Apple iPhone 17 Pro Max 256 GB"]'::jsonb,
      '{"storage":"256"}'::jsonb,
      'NORMAL',
      null,34000,34000,34000,'{}'::jsonb,true,
      'apple',
      'appleiphone17promax256gb',
      'iphone17promax256',
      array[
        'appleiphone17promax256gb',
        'iphone17promax256gb',
        'appleiphone17promax256',
        'iphone17promax256'
      ]
    )
    returning id into v_entry;

    insert into public.ai_buyer_price_calibration_sources(
      version_id,entry_id,source_url,source_title,source_kind,
      observed_price_thb,observed_at,note
    ) values (
      v_new,v_entry,'owner://case/6eec094c-f5c9-4d3e-bbea-13bbb15127a3',
      'Owner manual offer: iPhone 17 Pro Max 256GB',
      'OWNER_MANUAL_QUOTE',34000,date '2026-09-22',
      'Exact owner offer 34,000 THB; storage-specific row prevents cross-capacity matching'
    );

    -- Review-only evidence: exact camera model but bundle/lens content was not
    -- established. Keep inactive so it cannot price a kit/body variant blindly.
    insert into public.ai_buyer_price_book_entries(
      version_id,category,brand,model,model_code,aliases,spec_match,condition_key,
      estimated_resale,opening_offer,target_buy,hard_max,adjustments,active,
      normalized_brand,normalized_model,normalized_model_code,lookup_keys
    ) values (
      v_new,'CAMERA','Sony','Sony ZV-E10 Owner Review Candidate','ZV-E10',
      '["Sony ZV-E10","Sony ZVE10"]'::jsonb,
      '{}'::jsonb,'NORMAL',
      null,8000,8000,8000,'{}'::jsonb,false,
      'sony','sonyzve10ownerreviewcandidate','zve10',
      array['sonyzve10','sonyzve10ownerreviewcandidate','zve10']
    )
    returning id into v_entry;

    insert into public.ai_buyer_price_calibration_sources(
      version_id,entry_id,source_url,source_title,source_kind,
      observed_price_thb,observed_at,note
    ) values (
      v_new,v_entry,'owner://case/bd11e73a-73f4-4574-9061-c277dd68f56c',
      'Owner manual offer: Sony ZV-E10',
      'OWNER_MANUAL_QUOTE',8000,date '2026-09-22',
      'Inactive review evidence because body/kit/lens bundle was not confirmed'
    );

    -- Review-only evidence: M4 11-inch known, but storage variant unknown.
    insert into public.ai_buyer_price_book_entries(
      version_id,category,brand,model,model_code,aliases,spec_match,condition_key,
      estimated_resale,opening_offer,target_buy,hard_max,adjustments,active,
      normalized_brand,normalized_model,normalized_model_code,lookup_keys
    ) values (
      v_new,'TABLET','Apple','Apple iPad Air 11-inch M4 Owner Review Candidate',null,
      '["iPad Air 11 M4","Apple iPad Air 11-inch M4"]'::jsonb,
      '{"chip":"M4"}'::jsonb,'NORMAL',
      null,14000,14500,15000,'{}'::jsonb,false,
      'apple','appleipadair11inchm4ownerreviewcandidate',null,
      array['ipadair11m4','appleipadair11inchm4','appleipadair11inchm4ownerreviewcandidate']
    )
    returning id into v_entry;

    insert into public.ai_buyer_price_calibration_sources(
      version_id,entry_id,source_url,source_title,source_kind,
      observed_price_thb,observed_at,note
    ) values (
      v_new,v_entry,'owner://case/2b90f4e9-addb-4213-aeac-24e6fe1d75f9',
      'Owner manual range: iPad Air 11-inch M4',
      'OWNER_MANUAL_QUOTE',14000,date '2026-09-22',
      'Owner range 14,000-15,000 THB; inactive until storage variant is confirmed'
    );

    update public.ai_buyer_owner_pricebook_reviews
    set
      final_opening_offer=7000,
      final_target_buy=8000,
      final_hard_max=9000,
      status='APPROVED',
      reviewed_at=now(),
      review_note='Owner-directed V2.7 calibration: observed opening 7-8k and negotiated ceiling 9k; exact commercial SKU.'
    where case_id='4b91f6cd-1fa8-4e0d-a879-7eb5beeb06f2';

    update public.ai_buyer_owner_pricebook_reviews
    set
      final_opening_offer=34000,
      final_target_buy=34000,
      final_hard_max=34000,
      status='APPROVED',
      reviewed_at=now(),
      review_note='Owner-directed V2.7 calibration: exact 34k manual offer, storage-specific 256GB guard.'
    where case_id='6eec094c-f5c9-4d3e-bbea-13bbb15127a3';

    update public.ai_buyer_owner_pricebook_reviews
    set
      status='PENDING',
      review_note='V2.7 review-only: bundle/lens configuration must be confirmed before runtime activation.'
    where case_id='bd11e73a-73f4-4574-9061-c277dd68f56c';

    update public.ai_buyer_owner_pricebook_reviews
    set
      status='PENDING',
      review_note='V2.7 review-only: storage capacity must be confirmed before runtime activation.'
    where case_id='2b90f4e9-addb-4213-aeac-24e6fe1d75f9';
  end if;

  perform public.ai_buyer_activate_price_book(v_new);
end $$;
