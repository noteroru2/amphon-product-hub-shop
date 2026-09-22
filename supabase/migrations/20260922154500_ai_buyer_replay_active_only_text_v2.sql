-- P0 replay should report operational/non-terminal cases only.
create or replace function public.ai_buyer_run_offline_replay(
  p_policy_version text default 'AMPHON_AI_BUYER_OPTIMIZATION_V1'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_summary jsonb;
begin
  insert into public.ai_buyer_offline_replay_runs(policy_version)
  values (coalesce(nullif(trim(p_policy_version),''),'AMPHON_AI_BUYER_OPTIMIZATION_V1'))
  returning id into v_run_id;

  with latest_observation as (
    select distinct on (case_id)
      case_id,
      model_name,
      model_code,
      category as obs_category,
      identity_confidence as obs_identity,
      confirmed,
      inferred,
      unknown_fields,
      created_at
    from public.ai_buyer_product_observations
    order by case_id, created_at desc
  ),
  latest_decision as (
    select distinct on (case_id)
      case_id,
      id as decision_id,
      price_source,
      adjustments,
      created_at
    from public.ai_buyer_pricing_decisions
    order by case_id, created_at desc
  ),
  base as (
    select
      c.id as case_id,
      c.title,
      c.category,
      c.state as source_state,
      greatest(
        coalesce(c.identity_confidence,0),
        coalesce(o.obs_identity,0)
      )::numeric as id_conf,
      coalesce(c.spec_completeness,0)::numeric as spec_completeness,
      coalesce(c.condition_completeness,0)::numeric as condition_completeness,
      coalesce(o.model_name,'') as model_name,
      coalesce(o.model_code,'') as model_code,
      coalesce(o.confirmed,'{}'::jsonb) as confirmed,
      coalesce(c.metadata->'lastFlags','[]'::jsonb) as flags,
      coalesce(c.metadata->'lastPricingTags','[]'::jsonb) as tags,
      coalesce(c.metadata->'lastRequestedInputs','[]'::jsonb) as requested,
      nullif(c.metadata->>'pricingReviewReason','') as pricing_review_reason,
      lower(concat_ws(' ',c.title,o.model_name,o.model_code,o.confirmed::text)) as evidence_text,
      lower(coalesce((c.metadata->'lastFlags')::text,'')) as flags_text,
      lower(coalesce((c.metadata->'lastPricingTags')::text,'')) as tags_text,
      lower(coalesce(d.adjustments::text,'')) as decision_adjustments_text
    from public.ai_buyer_valuation_cases c
    left join latest_observation o on o.case_id=c.id
    left join latest_decision d on d.case_id=c.id
    where c.state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED')
  ),
  features as (
    select *,
      (
        model_name<>'' or model_code<>''
        or confirmed ? 'model'
        or confirmed ? 'model_name'
        or confirmed ? 'series'
      ) as has_model,
      (
        confirmed ? 'storage'
        or confirmed ? 'capacity'
        or confirmed ? 'ssd'
        or evidence_text ~ '\m(64|128|256|512)\s*gb\M|\m1\s*tb\M'
      ) as has_storage,
      (confirmed ? 'cpu' or confirmed ? 'processor') as has_cpu,
      (
        confirmed ? 'gpu'
        or confirmed ? 'graphics'
        or evidence_text ~ 'integrated|onboard|ออนบอร์ด'
      ) as has_gpu,
      (confirmed ? 'ram' or confirmed ? 'memory') as has_ram,
      (confirmed ? 'motherboard' or confirmed ? 'mainboard') as has_motherboard,
      (confirmed ? 'psu' or confirmed ? 'power_supply') as has_psu,
      (
        evidence_text ~ '\m(20[0-9]{2})\M|\bm[1-4]\b|core\s+i[3579]'
      ) as has_chip_or_year,
      (
        flags_text ~ 'multiple_devices|multiple_products|spec_to_device_mapping_ambiguous'
      ) as multiple_ambiguous,
      (
        flags_text ~ 'identity_conflict|model_spec_conflict|version_ambiguous|exact_variant_unconfirmed'
      ) as identity_conflict,
      (
        flags_text ~ 'pawn_ticket|ownership|active_installment|finance_status'
      ) as ownership_risk,
      (
        tags_text ~ 'locked|major_damage|device_not_booting|liquid_damage_history|board_repair_history|intermittent_power|port_multiple_defect'
      ) as critical_tag,
      (
        evidence_text ~ '(battery_health|battery_maximum_capacity)[^0-9]{0,20}([0-7]?[0-9])\s*%'
        or evidence_text ~ 'significantly degraded|service recommended|แบตเสื่อม|ไม่เก็บไฟ|หมดไว'
      ) as battery_bad_detected
    from base
  ),
  classified as (
    select *,
      case
        when category='OTHER' then 'C_HUMAN_REVIEW'
        when multiple_ambiguous or identity_conflict or ownership_risk or critical_tag then 'C_HUMAN_REVIEW'
        when category is null then 'B_NEEDS_INFO'
        when category='NOTEBOOK' and (
          (
            id_conf>=0.80
            and has_cpu and has_gpu and has_ram and has_storage
            and confirmed ? 'brand'
            and (confirmed ? 'series' or model_code<>'')
          )
          or (
            id_conf>=0.90
            and model_code<>''
            and spec_completeness>=0.35
          )
        ) then 'A_PRICE_NOW'
        when category='DESKTOP_PC' and (
          (
            id_conf>=0.65
            and has_cpu and has_gpu and has_ram and has_storage
            and has_motherboard and has_psu
          )
          or (
            id_conf>=0.90
            and model_code<>''
            and coalesce(title,'') !~* 'custom|ประกอบ'
            and spec_completeness>=0.35
          )
        ) then 'A_PRICE_NOW'
        when category in ('SMARTPHONE','TABLET')
          and id_conf>=0.90 and has_model and has_storage
          then 'A_PRICE_NOW'
        when category='MACBOOK'
          and id_conf>=0.90 and has_model and has_storage and has_chip_or_year
          then 'A_PRICE_NOW'
        when category='CAMERA'
          and id_conf>=0.90 and has_model
          then 'A_PRICE_NOW'
        else 'B_NEEDS_INFO'
      end as bucket,
      case
        when category='OTHER' then 'UNSUPPORTED_CATEGORY'
        when multiple_ambiguous then 'MULTIPLE_DEVICES_AMBIGUOUS'
        when identity_conflict then 'MODEL_SPEC_CONFLICT'
        when ownership_risk then 'OWNERSHIP_OR_FINANCE_REVIEW'
        when critical_tag then
          case
            when tags_text ~ 'locked' then 'LOCKED'
            when tags_text ~ 'device_not_booting' then 'DEVICE_NOT_BOOTING'
            when tags_text ~ 'major_damage' then 'MAJOR_DAMAGE'
            else 'HUMAN_REVIEW_REQUIRED'
          end
        when category is null then 'MISSING_PRODUCT_TYPE'
        when category in ('SMARTPHONE','TABLET') and not has_model then 'MISSING_MODEL'
        when category in ('SMARTPHONE','TABLET') and has_model and not has_storage then 'MISSING_STORAGE_VARIANT'
        when category='CAMERA' and not has_model then 'MISSING_MODEL'
        when category='MACBOOK' and not has_model then 'MISSING_MODEL'
        when category='MACBOOK' and not has_storage then 'MISSING_STORAGE_VARIANT'
        when category='MACBOOK' and not has_chip_or_year then 'MISSING_CORE_SPEC'
        when category='NOTEBOOK'
          and id_conf>=0.90 and model_code<>'' and spec_completeness>=0.35
          then 'READY_BY_MODEL_CODE'
        when category='NOTEBOOK'
          and id_conf>=0.80
          and has_cpu and has_gpu and has_ram and has_storage
          and confirmed ? 'brand'
          and (confirmed ? 'series' or model_code<>'')
          then 'READY_BY_COMPLETE_SPEC'
        when category='DESKTOP_PC'
          and id_conf>=0.65
          and has_cpu and has_gpu and has_ram and has_storage
          and has_motherboard and has_psu
          then 'READY_BY_COMPLETE_SPEC'
        when category='DESKTOP_PC'
          and id_conf>=0.90 and model_code<>''
          and coalesce(title,'') !~* 'custom|ประกอบ'
          and spec_completeness>=0.35
          then 'READY_BY_MODEL_CODE'
        when category in ('SMARTPHONE','TABLET','MACBOOK','CAMERA')
          and id_conf>=0.90 and has_model
          then case when model_code<>'' then 'READY_BY_MODEL_CODE' else 'READY_BY_MODEL_IDENTITY' end
        when category in ('NOTEBOOK','DESKTOP_PC') then 'MISSING_CORE_SPEC'
        else 'HUMAN_REVIEW_REQUIRED'
      end as reason_code,
      case
        when category='NOTEBOOK'
          and id_conf>=0.80
          and has_cpu and has_gpu and has_ram and has_storage
          and confirmed ? 'brand'
          and (confirmed ? 'series' or model_code<>'')
          and not (multiple_ambiguous or identity_conflict or ownership_risk or critical_tag)
          then 'SPEC'
        when category='DESKTOP_PC'
          and id_conf>=0.65
          and has_cpu and has_gpu and has_ram and has_storage
          and has_motherboard and has_psu
          and not (multiple_ambiguous or identity_conflict or ownership_risk or critical_tag)
          then 'SPEC'
        when category in ('NOTEBOOK','DESKTOP_PC','SMARTPHONE','TABLET','MACBOOK','CAMERA')
          then 'PRICE_BOOK_OR_MARKET'
        when category='OTHER' then 'HUMAN_REVIEW'
        else 'NEEDS_INFO'
      end as pricing_route
    from features
  ),
  enriched as (
    select *,
      case
        when bucket='A_PRICE_NOW' then 'READY_TO_PRICE'
        when bucket='B_NEEDS_INFO' then 'WAITING_REQUIRED_INFO'
        else 'HUMAN_REVIEW'
      end as expected_state,
      to_jsonb(array_remove(array[
        case when category in ('SMARTPHONE','TABLET','MACBOOK','CAMERA') and not has_model then 'model' end,
        case when category in ('SMARTPHONE','TABLET','MACBOOK') and has_model and not has_storage then 'storage_variant' end,
        case when category='MACBOOK' and has_model and has_storage and not has_chip_or_year then 'chip_or_year' end,
        case when category='NOTEBOOK' and not has_cpu then 'cpu' end,
        case when category='NOTEBOOK' and not has_gpu then 'gpu_or_integrated' end,
        case when category='NOTEBOOK' and not has_ram then 'ram' end,
        case when category='NOTEBOOK' and not has_storage then 'storage' end,
        case when category='DESKTOP_PC' and not has_cpu then 'cpu' end,
        case when category='DESKTOP_PC' and not has_gpu then 'gpu_or_integrated' end,
        case when category='DESKTOP_PC' and not has_ram then 'ram' end,
        case when category='DESKTOP_PC' and not has_storage then 'storage' end,
        case when category='DESKTOP_PC' and not has_motherboard then 'motherboard' end,
        case when category='DESKTOP_PC' and not has_psu then 'psu' end,
        case when category is null then 'product_type' end
      ]::text[],null)) as missing_fields,
      (tags_text ~ 'battery_bad') as existing_battery_bad_tag,
      (decision_adjustments_text ~ 'battery_bad') as battery_adjustment_applied
    from classified
  )
  insert into public.ai_buyer_offline_replay_results (
    run_id,case_id,title,category,source_state,expected_state,bucket,reason_code,pricing_route,
    identity_confidence,spec_completeness,condition_completeness,model_name,model_code,
    missing_fields,requested_inputs,flags,pricing_tags,
    detected_battery_bad,existing_battery_bad_tag,battery_adjustment_applied,
    latest_pricing_review_reason,regression_codes
  )
  select
    v_run_id,case_id,title,category,source_state,expected_state,bucket,reason_code,pricing_route,
    id_conf,spec_completeness,condition_completeness,
    nullif(model_name,''),nullif(model_code,''),
    missing_fields,requested,flags,tags,
    battery_bad_detected,existing_battery_bad_tag,battery_adjustment_applied,
    pricing_review_reason,
    to_jsonb(array_remove(array[
      case
        when expected_state='READY_TO_PRICE'
          and source_state in ('COLLECTING_PHOTOS','IDENTIFYING_PRODUCT','HUMAN_REVIEW')
          then 'READINESS_STATE_MISMATCH'
      end,
      case
        when expected_state='READY_TO_PRICE'
          and jsonb_array_length(requested)>0
          then 'UNNECESSARY_PREPRICE_REQUEST'
      end,
      case
        when battery_bad_detected and not existing_battery_bad_tag
          then 'BATTERY_TAG_MISSING'
      end,
      case
        when battery_bad_detected
          and source_state='PRICING'
          and decision_adjustments_text<>''
          and not battery_adjustment_applied
          then 'BATTERY_PRICED_NORMAL'
      end,
      case
        when expected_state='HUMAN_REVIEW'
          and source_state not in ('HUMAN_REVIEW','ACTION_REQUIRED')
          then 'RISK_ESCALATION_MISSING'
      end,
      case
        when expected_state='WAITING_REQUIRED_INFO'
          and source_state='HUMAN_REVIEW'
          then 'OVER_ESCALATED_TO_HUMAN'
      end,
      case
        when pricing_review_reason='SPEC_REQUIRED_COMPONENT_MISSING'
          and expected_state='READY_TO_PRICE'
          and reason_code='READY_BY_MODEL_CODE'
          then 'SPEC_ENGINE_FALSE_BLOCK'
      end
    ]::text[],null))
  from enriched;

  select jsonb_build_object(
    'total', count(*),
    'priceNow', count(*) filter (where bucket='A_PRICE_NOW'),
    'needsInfo', count(*) filter (where bucket='B_NEEDS_INFO'),
    'humanReview', count(*) filter (where bucket='C_HUMAN_REVIEW'),
    'regressions', count(*) filter (where jsonb_array_length(regression_codes)>0),
    'readinessStateMismatch', count(*) filter (where regression_codes ? 'READINESS_STATE_MISMATCH'),
    'unnecessaryPrepriceRequest', count(*) filter (where regression_codes ? 'UNNECESSARY_PREPRICE_REQUEST'),
    'batteryTagMissing', count(*) filter (where regression_codes ? 'BATTERY_TAG_MISSING'),
    'batteryPricedNormal', count(*) filter (where regression_codes ? 'BATTERY_PRICED_NORMAL'),
    'riskEscalationMissing', count(*) filter (where regression_codes ? 'RISK_ESCALATION_MISSING'),
    'overEscalatedToHuman', count(*) filter (where regression_codes ? 'OVER_ESCALATED_TO_HUMAN'),
    'specEngineFalseBlock', count(*) filter (where regression_codes ? 'SPEC_ENGINE_FALSE_BLOCK')
  )
  into v_summary
  from public.ai_buyer_offline_replay_results
  where run_id=v_run_id;

  update public.ai_buyer_offline_replay_runs
  set status='SUCCEEDED',
      total_cases=coalesce((v_summary->>'total')::integer,0),
      price_now_cases=coalesce((v_summary->>'priceNow')::integer,0),
      needs_info_cases=coalesce((v_summary->>'needsInfo')::integer,0),
      human_review_cases=coalesce((v_summary->>'humanReview')::integer,0),
      regression_cases=coalesce((v_summary->>'regressions')::integer,0),
      summary=v_summary,
      completed_at=now()
  where id=v_run_id;

  return v_run_id;
exception when others then
  if v_run_id is not null then
    update public.ai_buyer_offline_replay_runs
    set status='FAILED',error=left(sqlerrm,2000),completed_at=now()
    where id=v_run_id;
  end if;
  raise;
end;
$$;

revoke all on function public.ai_buyer_run_offline_replay(text) from public, anon, authenticated;
grant execute on function public.ai_buyer_run_offline_replay(text) to service_role;

comment on function public.ai_buyer_run_offline_replay(text) is
  'Deterministic offline replay from stored AI Buyer evidence only. Does not call OpenAI or mutate valuation case states.';


-- Backfill one fragmented Apple Watch conversation missed by V1 text regex.
with target as (
  select c.id,c.conversation_id,
         string_agg(coalesce(m.text_content,''), E'\n' order by m.created_at) txt
  from public.ai_buyer_valuation_cases c
  join public.ai_buyer_messages m
    on m.conversation_id=c.conversation_id
   and m.direction='INBOUND'
   and m.message_type='TEXT'
   and m.text_content is not null
  where c.category is null
    and c.state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED')
  group by c.id,c.conversation_id
),
watch_cases as (
  select *
  from target
  where lower(txt) ~ 'นาฬิกา|watc+h|watcch|apple[[:space:]]*watch'
)
insert into public.ai_buyer_product_observations(
  case_id,source,confirmed,inferred,unknown_fields,evidence,
  model_name,model_code,category,identity_confidence
)
select
  w.id,'CUSTOMER_TEXT',
  case when lower(w.txt) ~ 'series[[:space:]]*10'
    then jsonb_build_object('brand','Apple','model','Watch Series 10')
    else '{}'::jsonb end,
  '{}'::jsonb,'[]'::jsonb,
  jsonb_build_array(jsonb_build_object('type','DETERMINISTIC_TEXT_BACKFILL_V2','policy','P0_TEXT_CLASSIFIER_V2')),
  case when lower(w.txt) ~ 'series[[:space:]]*10' then 'Apple Watch Series 10' else null end,
  null,'OTHER',
  case when lower(w.txt) ~ 'series[[:space:]]*10' then 0.98 else 0.86 end
from watch_cases w
where not exists (
  select 1 from public.ai_buyer_product_observations o
  where o.case_id=w.id and o.source='CUSTOMER_TEXT'
    and o.evidence @> '[{"type":"DETERMINISTIC_TEXT_BACKFILL_V2"}]'::jsonb
);

with target as (
  select c.id,c.conversation_id,
         string_agg(coalesce(m.text_content,''), E'\n' order by m.created_at) txt
  from public.ai_buyer_valuation_cases c
  join public.ai_buyer_messages m
    on m.conversation_id=c.conversation_id
   and m.direction='INBOUND'
   and m.message_type='TEXT'
   and m.text_content is not null
  where c.category is null
    and c.state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED')
  group by c.id,c.conversation_id
),
watch_cases as (
  select *
  from target
  where lower(txt) ~ 'นาฬิกา|watc+h|watcch|apple[[:space:]]*watch'
)
update public.ai_buyer_valuation_cases c
set category='OTHER',
    title=case when lower(w.txt) ~ 'series[[:space:]]*10' then 'Apple Watch Series 10' else 'Smartwatch' end,
    state='HUMAN_REVIEW',
    control_mode='HUMAN_REQUIRED',
    identity_confidence=greatest(coalesce(c.identity_confidence,0),case when lower(w.txt) ~ 'series[[:space:]]*10' then 0.98 else 0.86 end),
    spec_completeness=greatest(coalesce(c.spec_completeness,0),0.20),
    condition_completeness=greatest(coalesce(c.condition_completeness,0),0.20),
    pricing_readiness=least(greatest(coalesce(c.pricing_readiness,0),0.10),0.49),
    metadata=coalesce(c.metadata,'{}'::jsonb) || jsonb_build_object(
      'lastRequestedInputs','[]'::jsonb,
      'lastPricingTags',coalesce(c.metadata->'lastPricingTags','[]'::jsonb),
      'lastFlags',to_jsonb(array['DETERMINISTIC_TEXT_CLASSIFICATION','P0_TEXT_BACKFILL_V2']),
      'readinessReason','UNSUPPORTED_CATEGORY',
      'deterministicTextBackfillAt',now()
    ),
    updated_at=now()
from watch_cases w
where c.id=w.id;

update public.ai_buyer_conversations conv
set control_mode='HUMAN_REQUIRED'
where exists (
  select 1 from public.ai_buyer_valuation_cases c
  where c.conversation_id=conv.id
    and c.category='OTHER'
    and c.state='HUMAN_REVIEW'
    and c.metadata->>'readinessReason'='UNSUPPORTED_CATEGORY'
);
