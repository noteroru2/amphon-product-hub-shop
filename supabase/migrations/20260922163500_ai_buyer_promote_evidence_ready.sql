-- P0 promote evidence-ready cases while AI remains paused.
-- These cases have sufficient identity/spec evidence under current policy.
-- No outbound offers are sent by this migration.

with promote(case_id,reason_code) as (
  values
    ('6b50df44-5b7e-4aff-8cfe-b45f5bad2910'::uuid,'READY_BY_MODEL_CODE'),
    ('cb30cab5-d7bb-40f8-9a1c-d52a079196e5'::uuid,'READY_BY_MODEL_CODE'),
    ('7d4fa572-8069-486c-acca-ec30eaaf2653'::uuid,'READY_BY_MODEL_IDENTITY'),
    ('b3c7f82d-b85f-4944-8099-22289cfc3b03'::uuid,'READY_BY_MODEL_CODE'),
    ('145ce434-bc82-42a5-a1ac-dd87298bcb20'::uuid,'READY_BY_COMPLETE_SPEC'),
    ('fe1a34ba-a842-4cfc-94ef-f3bfc7f6a0ba'::uuid,'READY_BY_COMPLETE_SPEC'),
    ('0d3ccb0f-9bde-4ce9-b8fe-414e4b51e8aa'::uuid,'READY_BY_MODEL_CODE'),
    ('eb31cd76-f511-4ca3-824f-72a63d5a6431'::uuid,'READY_BY_MODEL_CODE'),
    ('80741cac-5a1a-479f-b862-b5f449fe9872'::uuid,'READY_BY_MODEL_CODE'),
    ('1f441860-498e-47be-b64f-0a40d784c1ef'::uuid,'READY_BY_MODEL_CODE'),
    ('1fcae414-f315-4154-bc49-f7284e2363a0'::uuid,'READY_BY_MODEL_IDENTITY'),
    ('254f5381-e4e4-4c9f-b7dd-831bb8285af1'::uuid,'READY_BY_MODEL_CODE'),
    ('a4ecf322-cf4f-452e-aad1-a9125f289417'::uuid,'READY_BY_MODEL_CODE'),
    ('a6747df7-ffec-4bd2-8951-80c8e9b11401'::uuid,'READY_BY_MODEL_IDENTITY')
)
update public.ai_buyer_valuation_cases c
set state='READY_TO_PRICE',
    control_mode='AUTO',
    pricing_readiness=greatest(coalesce(c.pricing_readiness,0),0.90),
    metadata=(
      (coalesce(c.metadata,'{}'::jsonb)
        - 'pricingReviewReason'
        - 'pricingReviewDetail')
      || jsonb_build_object(
        'lastRequestedInputs','[]'::jsonb,
        'readinessReason',p.reason_code,
        'p0EvidenceReadyPromotedAt',now()
      )
    ),
    updated_at=now()
from promote p
where c.id=p.case_id
  and c.state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED','ACCEPTED','ACTION_REQUIRED');

-- Make replaced-back evidence sticky in the case metadata too.
update public.ai_buyer_valuation_cases
set metadata=jsonb_set(
      coalesce(metadata,'{}'::jsonb),
      '{lastPricingTags}',
      (
        select to_jsonb(array_agg(distinct x))
        from unnest(
          array_append(
            coalesce(array(select jsonb_array_elements_text(coalesce(metadata->'lastPricingTags','[]'::jsonb))),array[]::text[]),
            'BACK_PANEL_REPLACED'
          )
        ) x
      ),
      true
    ),
    updated_at=now()
where id='80741cac-5a1a-479f-b862-b5f449fe9872';
