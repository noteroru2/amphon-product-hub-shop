-- P0 semantic missing-info cleanup.
-- Replace "wait for photos" with the single material fact that actually blocks pricing.

with storage_cases(case_id) as (
  values
    ('a7bd099a-91b6-4908-8584-d5f0cfec5ac2'::uuid),
    ('5f264390-3066-4b89-9611-f9b8c537105b'::uuid),
    ('c876bbf2-27c3-4f4c-b0ae-a6301814c2de'::uuid),
    ('ef468402-261b-4d37-b181-757a7de69fa6'::uuid),
    ('f06a313f-7417-4cb4-9f17-19005f4c375e'::uuid),
    ('74a3a101-aca0-4ba0-af07-97947bb2bac3'::uuid)
)
update public.ai_buyer_valuation_cases c
set state='NEED_MORE_INFO',
    control_mode='AUTO',
    metadata=coalesce(c.metadata,'{}'::jsonb) || jsonb_build_object(
      'lastRequestedInputs','["STORAGE_VARIANT"]'::jsonb,
      'readinessReason','MISSING_STORAGE_VARIANT',
      'semanticMissingInfoAt',now()
    ),
    updated_at=now()
from storage_cases s
where c.id=s.case_id
  and c.state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED','ACCEPTED','ACTION_REQUIRED');

-- Cases that need a model/spec fact, not generic accessory photos.
update public.ai_buyer_valuation_cases
set state='NEED_MORE_INFO',
    control_mode='AUTO',
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'lastRequestedInputs','["MODEL"]'::jsonb,
      'readinessReason','MISSING_MODEL',
      'semanticMissingInfoAt',now()
    ),
    updated_at=now()
where id in (
  '8a4804b5-cf30-4b70-88f6-875d2b96e440'::uuid,
  'b386fc60-b841-4b27-8d80-ab09c9b1f3cf'::uuid
)
and state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED','ACCEPTED','ACTION_REQUIRED');

update public.ai_buyer_valuation_cases
set state='NEED_MORE_INFO',
    control_mode='AUTO',
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'lastRequestedInputs','["CORE_SPEC"]'::jsonb,
      'readinessReason','MISSING_CORE_SPEC',
      'semanticMissingInfoAt',now()
    ),
    updated_at=now()
where id='a5f8f29e-3205-41a3-ad13-5ad9fd471e16'
  and state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED','ACCEPTED','ACTION_REQUIRED');

update public.ai_buyer_valuation_cases
set state='NEED_MORE_INFO',
    control_mode='AUTO',
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'lastRequestedInputs','["MODEL","CORE_SPEC"]'::jsonb,
      'readinessReason','MISSING_CORE_SPEC',
      'semanticMissingInfoAt',now()
    ),
    updated_at=now()
where id='e274da53-5304-49d5-8a6b-87b2d84afc65'
  and state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED','ACCEPTED','ACTION_REQUIRED');

update public.ai_buyer_valuation_cases
set state='NEED_MORE_INFO',
    control_mode='AUTO',
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'lastRequestedInputs','["MODEL","STORAGE_VARIANT"]'::jsonb,
      'readinessReason','MISSING_CORE_SPEC',
      'semanticMissingInfoAt',now()
    ),
    updated_at=now()
where id='fde3f925-db5a-4a08-8944-28cd0a21a71a'
  and state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED','ACCEPTED','ACTION_REQUIRED');

-- These conversations are not active sell-item valuations.
update public.ai_buyer_valuation_cases
set state='CANCELLED',
    completed_at=coalesce(completed_at,now()),
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'cancelReason',
      case id
        when '245bb6ef-f38a-4ca7-b99a-a5a4c04188b1'::uuid then 'NON_SELLER_PAWN_OR_DEPOSIT_INQUIRY'
        when '647f1dc2-63ed-4036-9363-7120321b9056'::uuid then 'NON_SELLER_PAWN_INQUIRY'
        when 'a50b4f61-0f47-4214-a49f-25a45a3ab878'::uuid then 'LOGISTICS_ONLY_NO_ACTIVE_PRODUCT'
        when '4cb0e1ad-e7bb-45af-b657-0246dd6eb30a'::uuid then 'STICKER_ONLY_NO_PRODUCT'
        else 'NON_VALUATION'
      end,
      'cancelledAt',now()
    ),
    updated_at=now()
where id in (
  '245bb6ef-f38a-4ca7-b99a-a5a4c04188b1'::uuid,
  '647f1dc2-63ed-4036-9363-7120321b9056'::uuid,
  'a50b4f61-0f47-4214-a49f-25a45a3ab878'::uuid,
  '4cb0e1ad-e7bb-45af-b657-0246dd6eb30a'::uuid
)
and state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED','ACCEPTED','ACTION_REQUIRED');
