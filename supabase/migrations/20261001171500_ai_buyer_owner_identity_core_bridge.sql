-- Bridge high-confidence deterministic Owner Model identity back into the core
-- product evidence store. This is explicit customer-text evidence only; no guesses.

with eligible as (
  select e.*
  from public.ai_buyer_owner_identity_enrichment e
  where e.confidence >= 0.95
    and e.review_status <> 'REJECTED'
),
ins as (
  insert into public.ai_buyer_product_observations(
    case_id,source,confirmed,inferred,unknown_fields,evidence,
    model_name,model_code,category,identity_confidence
  )
  select
    e.case_id,
    'SYSTEM',
    coalesce(e.specs,'{}'::jsonb)
      || case when e.brand is not null then jsonb_build_object('brand',e.brand) else '{}'::jsonb end,
    '{}'::jsonb,
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'source','OWNER_MODEL_DETERMINISTIC_TEXT',
      'identityEnrichment',e.id,
      'evidenceEventIds',e.evidence_event_ids,
      'confidence',e.confidence
    )),
    e.model_name,
    e.model_code,
    e.category,
    e.confidence
  from eligible e
  where not exists (
    select 1
    from public.ai_buyer_product_observations o
    where o.case_id=e.case_id
      and o.model_name is not null
      and coalesce(o.identity_confidence,0) >= e.confidence
  )
  returning case_id
)
update public.ai_buyer_valuation_cases c
set
  category=coalesce(c.category,e.category),
  title=coalesce(nullif(c.title,''),e.model_name),
  identity_confidence=greatest(coalesce(c.identity_confidence,0),e.confidence),
  spec_completeness=greatest(
    coalesce(c.spec_completeness,0),
    case
      when e.category='NOTEBOOK'
       and e.specs ? 'cpu' and e.specs ? 'ramGb' and e.specs ? 'storageGb' then 0.60
      when e.category='SMARTPHONE' and e.specs ? 'storageGb' then 0.70
      when e.category='TABLET' and e.specs ? 'chip' then 0.55
      when e.category='CAMERA' then 0.40
      else 0.35
    end
  ),
  metadata=coalesce(c.metadata,'{}'::jsonb) || jsonb_build_object(
    'ownerIdentityBridge','OWNER_MODEL_DETERMINISTIC_V1',
    'ownerIdentityBridgeAt',now(),
    'ownerIdentityConfidence',e.confidence
  )
from eligible e
where c.id=e.case_id
  and (
    c.category is null
    or c.title is null
    or coalesce(c.identity_confidence,0) < e.confidence
    or coalesce(c.spec_completeness,0) < 0.35
  );
