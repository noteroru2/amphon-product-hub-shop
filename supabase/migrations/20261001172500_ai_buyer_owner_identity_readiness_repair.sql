-- Normalize deterministic owner-identity facts into the canonical value
-- shapes used by replay/pricing and repair stale case readiness metadata.

update public.ai_buyer_product_observations o
set confirmed =
  coalesce(o.confirmed,'{}'::jsonb)
  || case
       when o.confirmed ? 'storageGb'
       then jsonb_build_object('storage',(o.confirmed->>'storageGb') || ' GB')
       else '{}'::jsonb
     end
  || case
       when o.confirmed ? 'ramGb'
       then jsonb_build_object('ram',(o.confirmed->>'ramGb') || ' GB')
       else '{}'::jsonb
     end
where o.source='SYSTEM'
  and exists (
    select 1
    from jsonb_array_elements(coalesce(o.evidence,'[]'::jsonb)) e
    where e->>'source'='OWNER_MODEL_DETERMINISTIC_TEXT'
  );

-- Exact SKU + sufficient explicit owner/customer evidence.
update public.ai_buyer_valuation_cases
set state='READY_TO_PRICE',
    control_mode='AUTO',
    pricing_readiness=greatest(coalesce(pricing_readiness,0),0.95),
    metadata=coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'readinessReason','READY_BY_OWNER_EXACT_IDENTITY',
        'lastRequestedInputs','[]'::jsonb,
        'ownerCalibrationReady',true
      )
where id in (
  '4b91f6cd-1fa8-4e0d-a879-7eb5beeb06f2',
  '6eec094c-f5c9-4d3e-bbea-13bbb15127a3'
);

update public.ai_buyer_conversations c
set control_mode='AUTO'
where c.id in (
  select conversation_id
  from public.ai_buyer_valuation_cases
  where id in (
    '4b91f6cd-1fa8-4e0d-a879-7eb5beeb06f2',
    '6eec094c-f5c9-4d3e-bbea-13bbb15127a3'
  )
);

-- Sony model identity is exact, but owner quote did not establish body/kit/lens
-- configuration. Keep this intentionally human-reviewed instead of forcing price.
update public.ai_buyer_valuation_cases
set state='HUMAN_REVIEW',
    control_mode='HUMAN_REQUIRED',
    pricing_readiness=least(coalesce(pricing_readiness,0.40),0.49),
    metadata=coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'readinessReason','BUNDLE_CONFIGURATION_AMBIGUOUS',
        'lastRequestedInputs','[]'::jsonb,
        'lastFlags',
          coalesce(metadata->'lastFlags','[]'::jsonb)
          || '["EXACT_VARIANT_UNCONFIRMED"]'::jsonb,
        'pricingReviewReason','BUNDLE_CONFIGURATION_AMBIGUOUS'
      )
where id='bd11e73a-73f4-4574-9061-c277dd68f56c';

update public.ai_buyer_conversations c
set control_mode='HUMAN_REQUIRED'
where c.id=(
  select conversation_id from public.ai_buyer_valuation_cases
  where id='bd11e73a-73f4-4574-9061-c277dd68f56c'
);

-- iPad identity/chip are known, capacity is not. Ask only the missing variant.
update public.ai_buyer_valuation_cases
set state='NEED_MORE_INFO',
    control_mode='AUTO',
    pricing_readiness=least(greatest(coalesce(pricing_readiness,0),0.55),0.79),
    metadata=coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'readinessReason','MISSING_STORAGE_VARIANT',
        'lastRequestedInputs','["STORAGE_VARIANT"]'::jsonb
      )
where id='2b90f4e9-addb-4213-aeac-24e6fe1d75f9';

update public.ai_buyer_conversations c
set control_mode='AUTO'
where c.id=(
  select conversation_id from public.ai_buyer_valuation_cases
  where id='2b90f4e9-addb-4213-aeac-24e6fe1d75f9'
);
