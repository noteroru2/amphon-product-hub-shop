-- Keep Owner Model learning alive after the initial five-day capture.
-- The next window starts exactly when the 5D window ends, so the capture
-- trigger never writes the same message into both windows.

insert into public.ai_buyer_learning_windows(
  name,purpose,starts_at,ends_at,status,source_policy,metadata,created_at,updated_at
)
select
  'LINE Owner Continuous Learning V1',
  'PRICE_AND_CONVERSATION_STYLE',
  w.ends_at,
  w.ends_at + interval '365 days',
  'CAPTURING',
  'LINE_CONTINUOUS_OWNER_V1',
  jsonb_build_object(
    'aiPausedForLearning',false,
    'goal','Continuously learn owner conversation style, price quotes, negotiation decisions and final deal economics',
    'priceLabelPolicy','Verified Hub offer prices first; deterministic text extraction is candidate evidence only',
    'ownerModel','V1',
    'shadowOnly',true
  ),
  w.created_at - interval '1 second',
  now()
from public.ai_buyer_learning_windows w
where w.name='LINE Owner Learning 5D 2026-09-22'
  and not exists (
    select 1
    from public.ai_buyer_learning_windows x
    where x.name='LINE Owner Continuous Learning V1'
  )
limit 1;

