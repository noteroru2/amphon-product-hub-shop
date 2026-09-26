-- Owner Model V1.3: deterministic identity extraction from explicit chat text
-- plus negotiation-path learning. No inferred identity is promoted when the
-- customer text is ambiguous.

create or replace function public.ai_buyer_parse_owner_product_identity(p_text text)
returns table(
  category text,
  brand text,
  model_name text,
  model_code text,
  specs jsonb,
  confidence numeric,
  pattern text
)
language plpgsql
immutable
security invoker
set search_path=public
as $$
declare
  t text := coalesce(p_text,'');
  m text[];
  v_model text;
  v_code text;
  v_specs jsonb := '{}'::jsonb;
  v_storage text[];
  v_cpu text[];
  v_ram text[];
begin
  -- Sony camera family with explicit model code.
  if t ~* 'sony[[:space:]]+zv[-[:space:]]?e10' then
    return query select
      'CAMERA'::text,'Sony'::text,'Sony ZV-E10'::text,'ZV-E10'::text,
      '{}'::jsonb,0.99::numeric,'SONY_ZVE10_EXPLICIT'::text;
    return;
  end if;

  -- Acer notebook: preserve the explicit commercial model code.
  m := regexp_match(t,'(?i)(AL[0-9]{2}-[0-9A-Z]+-[0-9A-Z]+)');
  if t ~* 'acer' and m is not null then
    v_code := upper(m[1]);
    v_model := case
      when t ~* 'aspire[[:space:]]+lite[[:space:]]+16' then 'Acer Aspire Lite 16'
      else 'Acer Notebook ' || v_code
    end;

    v_cpu := regexp_match(t,'(?i)(Intel[[:space:]]+Core[[:space:]]+Ultra[[:space:]]+[3579][[:space:]]+[0-9A-Z]+)');
    v_ram := regexp_match(t,'(?i)RAM[[:space:]:]*([0-9]{1,3})[[:space:]]*GB');
    v_storage := regexp_match(t,'(?i)SSD[[:space:]:]*([0-9]{2,4})[[:space:]]*GB');

    if v_cpu is not null then v_specs := v_specs || jsonb_build_object('cpu',v_cpu[1]); end if;
    if v_ram is not null then v_specs := v_specs || jsonb_build_object('ramGb',(v_ram[1])::int); end if;
    if v_storage is not null then v_specs := v_specs || jsonb_build_object('storageGb',(v_storage[1])::int); end if;

    return query select
      'NOTEBOOK'::text,'Acer'::text,v_model,v_code,v_specs,
      0.99::numeric,'ACER_MODEL_CODE_EXPLICIT'::text;
    return;
  end if;

  -- iPhone family. Exact marketing model is explicit; A-number may be unknown.
  m := regexp_match(t,'(?i)iPhone[[:space:]]*([0-9]{1,2})[[:space:]]*(Pro[[:space:]]*Max|Pro|Plus)?');
  if m is not null then
    v_model := 'Apple iPhone ' || m[1]
      || case when nullif(trim(coalesce(m[2],'')),'') is not null
        then ' ' || regexp_replace(initcap(lower(trim(m[2]))),'Pro Max','Pro Max','g')
        else '' end;
    v_model := replace(replace(v_model,'Pro Max','Pro Max'),'Pro','Pro');

    v_storage := regexp_match(t,'(?i)([0-9]{2,4})[[:space:]]*GB');
    if v_storage is not null then
      v_specs := v_specs || jsonb_build_object('storageGb',(v_storage[1])::int);
    end if;

    return query select
      'SMARTPHONE'::text,'Apple'::text,v_model,null::text,v_specs,
      0.97::numeric,'IPHONE_MODEL_EXPLICIT'::text;
    return;
  end if;

  -- iPad Air with chip generation and optional screen size.
  m := regexp_match(t,'(?i)iPad[[:space:]]+Air[[:space:]]*([0-9]{1,2})?[[:space:]]*(M[0-9])');
  if m is not null then
    v_model := 'Apple iPad Air'
      || case when nullif(coalesce(m[1],''),'') is not null then ' ' || m[1] || '-inch' else '' end
      || ' ' || upper(m[2]);
    v_specs := jsonb_build_object('chip',upper(m[2]));
    if nullif(coalesce(m[1],''),'') is not null then
      v_specs := v_specs || jsonb_build_object('screenInches',(m[1])::int);
    end if;

    return query select
      'TABLET'::text,'Apple'::text,v_model,null::text,v_specs,
      0.96::numeric,'IPAD_AIR_EXPLICIT'::text;
    return;
  end if;

  -- Generic 2022 M2 iPad is not enough to distinguish exact Pro size/model.
  if t ~* '(iPad|ไอแพด).*M2.*(2022|ปี[[:space:]]*2022)' then
    return query select
      'TABLET'::text,'Apple'::text,'Apple iPad M2 (2022)'::text,null::text,
      jsonb_build_object('chip','M2','year',2022),
      0.65::numeric,'IPAD_M2_2022_AMBIGUOUS'::text;
    return;
  end if;

  return;
end;
$$;

revoke all on function public.ai_buyer_parse_owner_product_identity(text)
from public,anon,authenticated;
grant execute on function public.ai_buyer_parse_owner_product_identity(text)
to service_role;

create or replace function public.ai_buyer_backfill_owner_identity_from_text()
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_upserted integer := 0;
begin
  with contexts as (
    select distinct on (c.case_id)
      c.case_id,
      c.context_text,
      c.evidence_event_ids,
      c.owner_quote_at
    from public.ai_buyer_owner_price_context_v c
    where coalesce(c.context_text,'') <> ''
    order by c.case_id,c.owner_quote_at desc
  ),
  parsed as (
    select
      c.case_id,c.evidence_event_ids,
      p.category,p.brand,p.model_name,p.model_code,p.specs,p.confidence,p.pattern
    from contexts c
    cross join lateral public.ai_buyer_parse_owner_product_identity(c.context_text) p
  ),
  changed as (
    insert into public.ai_buyer_owner_identity_enrichment(
      case_id,category,brand,model_name,model_code,specs,confidence,
      evidence_event_ids,source,review_status,provider_model,rationale,updated_at
    )
    select
      p.case_id,p.category,p.brand,p.model_name,p.model_code,p.specs,p.confidence,
      coalesce(p.evidence_event_ids,'{}'::uuid[]),
      'SYSTEM_OBSERVATION',
      'CANDIDATE',
      null,
      jsonb_build_object(
        'pattern',p.pattern,
        'method','DETERMINISTIC_CHAT_IDENTITY_V1',
        'explicitOnly',true
      ),
      now()
    from parsed p
    on conflict (case_id) do update
      set category=excluded.category,
          brand=excluded.brand,
          model_name=excluded.model_name,
          model_code=excluded.model_code,
          specs=excluded.specs,
          confidence=excluded.confidence,
          evidence_event_ids=excluded.evidence_event_ids,
          source=excluded.source,
          rationale=excluded.rationale,
          updated_at=now()
      where public.ai_buyer_owner_identity_enrichment.review_status <> 'APPROVED'
        and excluded.confidence > public.ai_buyer_owner_identity_enrichment.confidence
    returning 1
  )
  select count(*)::int into v_upserted from changed;

  return jsonb_build_object('ok',true,'upserted',v_upserted,'generatedAt',now());
end;
$$;

revoke all on function public.ai_buyer_backfill_owner_identity_from_text()
from public,anon,authenticated;
grant execute on function public.ai_buyer_backfill_owner_identity_from_text()
to service_role;

select public.ai_buyer_backfill_owner_identity_from_text();

create or replace view public.ai_buyer_owner_case_price_v
with (security_invoker=true) as
select
  d.case_id,
  (array_agg(d.conversation_id order by d.owner_quote_at asc))[1] as conversation_id,
  max(d.category) as category,
  max(d.title) as title,
  max(d.model_name) as model_name,
  max(d.model_code) as model_code,
  (array_agg(d.owner_amount order by d.owner_quote_at asc))[1] as first_owner_offer,
  (array_agg(d.owner_amount order by d.owner_quote_at desc))[1] as last_owner_offer,
  min(d.owner_amount_min) as owner_floor,
  max(d.owner_amount_max) as owner_ceiling,
  count(*)::int as owner_quote_count,
  bool_or(d.owner_label_verified) as has_verified_owner_quote,
  max(d.owner_label_confidence) as best_owner_label_confidence,
  max(d.engine_opening_offer) as engine_opening_offer,
  max(d.engine_target_buy) as engine_target_buy,
  max(d.engine_hard_max) as engine_hard_max,
  max(d.estimated_resale) as estimated_resale,
  max(d.engine_pricing_confidence) as engine_pricing_confidence,
  min(d.owner_quote_at) as first_owner_quote_at,
  max(d.owner_quote_at) as last_owner_quote_at,
  (array_agg(d.owner_amount order by d.owner_quote_at asc)
    filter (where d.high_confidence_owner_quote))[1] as first_high_conf_owner_offer,
  (array_agg(d.owner_amount order by d.owner_quote_at desc)
    filter (where d.high_confidence_owner_quote))[1] as last_high_conf_owner_offer,
  min(d.owner_amount_min) filter (where d.high_confidence_owner_quote) as high_conf_owner_floor,
  max(d.owner_amount_max) filter (where d.high_confidence_owner_quote) as high_conf_owner_ceiling,
  count(*) filter (where d.high_confidence_owner_quote)::int as high_conf_owner_quote_count,
  max(d.enriched_brand) as enriched_brand,
  max(d.identity_confidence) as owner_identity_confidence
from public.ai_buyer_owner_price_dataset_v d
group by d.case_id;
revoke all on public.ai_buyer_owner_case_price_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_case_price_v to service_role;

create or replace view public.ai_buyer_owner_pricebook_candidates_v
with (security_invoker=true) as
select
  p.case_id,p.category,p.title,p.model_name,p.model_code,
  p.first_high_conf_owner_offer as suggested_opening_offer,
  greatest(p.first_high_conf_owner_offer,p.last_high_conf_owner_offer) as suggested_target_buy,
  greatest(p.high_conf_owner_ceiling,p.last_high_conf_owner_offer) as suggested_hard_max,
  p.high_conf_owner_floor as owner_floor,
  p.high_conf_owner_ceiling as owner_ceiling,
  p.high_conf_owner_quote_count as owner_quote_count,
  p.has_verified_owner_quote,
  p.best_owner_label_confidence,
  case
    when p.model_code is not null and p.has_verified_owner_quote then 'HIGH'
    when p.owner_identity_confidence >= 0.95 and p.best_owner_label_confidence >= 0.95 then 'HIGH'
    when p.owner_identity_confidence >= 0.90 and p.best_owner_label_confidence >= 0.90 then 'MEDIUM'
    else 'LOW'
  end as candidate_confidence,
  case
    when p.high_conf_owner_quote_count = 0 then false
    when p.model_code is not null and p.owner_identity_confidence >= 0.90 then true
    when p.model_name is not null
      and p.owner_identity_confidence >= 0.90
      and p.best_owner_label_confidence >= 0.90 then true
    else false
  end as ready_for_pricebook_review,
  p.first_owner_quote_at,
  p.last_owner_quote_at,
  p.enriched_brand as brand,
  p.owner_identity_confidence
from public.ai_buyer_owner_case_price_v p
where p.first_high_conf_owner_offer is not null;
revoke all on public.ai_buyer_owner_pricebook_candidates_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_pricebook_candidates_v to service_role;

create or replace view public.ai_buyer_owner_negotiation_path_v
with (security_invoker=true) as
select
  p.case_id,
  p.category,
  p.title,
  p.enriched_brand as brand,
  p.model_name,
  p.model_code,
  p.first_high_conf_owner_offer as opening_offer_observed,
  p.last_owner_offer as last_owner_quote_observed,
  p.owner_ceiling as max_owner_quote_observed,
  case
    when p.first_high_conf_owner_offer is not null and p.last_owner_offer is not null
    then p.last_owner_offer-p.first_high_conf_owner_offer
  end as concession_amount,
  case
    when p.first_high_conf_owner_offer > 0 and p.last_owner_offer is not null
    then round(((p.last_owner_offer-p.first_high_conf_owner_offer)/p.first_high_conf_owner_offer)*100,2)
  end as concession_pct,
  p.owner_quote_count,
  p.high_conf_owner_quote_count,
  p.has_verified_owner_quote,
  p.best_owner_label_confidence,
  p.owner_identity_confidence,
  p.first_owner_quote_at,
  p.last_owner_quote_at,
  (p.owner_quote_count >= 2 and p.last_owner_quote_at > p.first_owner_quote_at) as has_observed_negotiation
from public.ai_buyer_owner_case_price_v p
where p.first_high_conf_owner_offer is not null;

revoke all on public.ai_buyer_owner_negotiation_path_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_negotiation_path_v to service_role;

create or replace view public.ai_buyer_owner_model_status_v
with (security_invoker=true) as
select
  (select count(*)::int from public.ai_buyer_owner_conversation_pairs_v) as conversation_pairs,
  (select count(*)::int from public.ai_buyer_owner_price_dataset_v) as price_labels,
  (select count(*)::int from public.ai_buyer_owner_price_dataset_v where owner_label_verified) as verified_price_labels,
  (select count(distinct case_id)::int from public.ai_buyer_owner_price_dataset_v) as priced_cases,
  (select count(*)::int from public.ai_buyer_owner_pricebook_candidates_v where ready_for_pricebook_review) as pricebook_candidates,
  (select count(*)::int from public.ai_buyer_owner_case_price_v where engine_target_buy is not null and last_high_conf_owner_offer is not null) as engine_owner_pairs,
  (select count(*)::int from public.ai_buyer_owner_calibration_v where ready_for_shadow) as shadow_ready_categories,
  (select count(*)::int from public.ai_buyer_owner_calibration_v where ready_for_runtime_review) as runtime_review_ready_categories,
  now() as generated_at,
  (select count(*)::int from public.ai_buyer_owner_price_dataset_v where high_confidence_owner_quote) as high_conf_price_labels,
  (select count(*)::int from public.ai_buyer_owner_price_context_v where coalesce(context_text,'') <> '') as priced_contexts,
  (select count(*)::int from public.ai_buyer_owner_identity_enrichment where review_status <> 'REJECTED') as identity_enrichments,
  (select count(*)::int from public.ai_buyer_owner_negotiation_path_v where has_observed_negotiation) as negotiation_cases;
revoke all on public.ai_buyer_owner_model_status_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_model_status_v to service_role;

