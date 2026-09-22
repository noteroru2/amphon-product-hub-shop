-- P0 deterministic text backfill for cases received while OpenAI intake is paused.
-- Uses customer-provided text only; no AI/API calls.

create temp table tmp_ai_buyer_text_backfill on commit drop as
with active_cases as (
  select c.id,c.conversation_id,c.metadata
  from public.ai_buyer_valuation_cases c
  where c.category is null
    and c.state not in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED')
),
texts as (
  select a.id case_id,a.conversation_id,a.metadata,
         string_agg(coalesce(m.text_content,''), E'\n' order by m.created_at) as txt
  from active_cases a
  join public.ai_buyer_messages m
    on m.conversation_id=a.conversation_id
   and m.direction='INBOUND'
   and m.message_type='TEXT'
   and m.text_content is not null
  group by a.id,a.conversation_id,a.metadata
),
base as (
  select *,
    lower(txt) lower_txt,
    case
      when txt ~* 'จอแตก|หน้าจอแตก|screen[[:space:]]*(is[[:space:]]*)?(cracked|broken)' then true
      else false
    end screen_defect,
    case
      when txt ~* 'เปิดไม่ติด|เครื่องไม่ติด|บูตไม่ขึ้น|เปิดเครื่องไม่ได้|does[[:space:]]*not[[:space:]]*boot|not[[:space:]]*booting' then true
      else false
    end not_booting,
    case
      when txt ~* 'โดนน้ำ|น้ำเข้า|น้ำหก|liquid[[:space:]]*damage|water[[:space:]]*damage' then true
      else false
    end liquid_damage
  from texts
),
classified as (
  select *,
    case
      when lower_txt ~ 'dell[[:space:]]+precision[[:space:]]+5820' then 'DESKTOP_PC'
      when lower_txt ~ 'ipad[[:space:]]*air[[:space:]]*5|ไอแพด[[:space:]]*air[[:space:]]*5' then 'TABLET'
      when lower_txt ~ 'ipad[[:space:]]*(gen[[:space:]]*)?9|ไอแพด[[:space:]]*(gen[[:space:]]*)?9' then 'TABLET'
      when lower_txt ~ 'matepad[[:space:]]*t[[:space:]]*10s|matepad[[:space:]]*t10s' then 'TABLET'
      when lower_txt ~ 'iphone[[:space:]]*xr|ไอโฟน[[:space:]]*xr' then 'SMARTPHONE'
      when lower_txt ~ 'insta[[:space:]]*360[[:space:]]*(one[[:space:]]*)?x2' then 'CAMERA'
      when lower_txt ~ 'dji[[:space:]]*(osmo[[:space:]]*)?action[[:space:]]*3' then 'CAMERA'
      when lower_txt ~ 'apple[[:space:]]*watch|แอ[ป๊]?เปิ้ล.*watch|นาฬิกา.*(apple|แอ[ป๊]?เปิ้ล)|smart[[:space:]]*watch' then 'OTHER'
      when lower_txt ~ 'เครื่องเกม|nintendo|นินเท|playstation|xbox' then 'OTHER'
      when lower_txt ~ 'จอพกพา|portable[[:space:]]*monitor|รับซื้อทีวี|(^|[^a-z])tv([^a-z]|$)|โทรทัศน์' then 'OTHER'
      when lower_txt ~ 'กล้องส่องทางไกล|binocular' then 'OTHER'
      when lower_txt ~ 'เหล้า|whisk(y|ey)|cognac|บรั่นดี|(^|[^a-z])xo([^a-z]|$)' then 'OTHER'
      when lower_txt ~ 'macbook' then 'MACBOOK'
      when lower_txt ~ 'iphone|ไอโฟน' then 'SMARTPHONE'
      when lower_txt ~ 'ipad|ไอแพด|tablet|แท็บเล็ต|matepad|galaxy[[:space:]]*tab' then 'TABLET'
      when lower_txt ~ 'notebook|โน้ตบุ๊ก|โน๊ตบุ๊ค|laptop' then 'NOTEBOOK'
      when lower_txt ~ 'workstation|desktop|คอมตั้งโต๊ะ|คอมพิวเตอร์|precision[[:space:]]+[0-9]{4}' then 'DESKTOP_PC'
      when lower_txt ~ 'กล้อง|camera|cyber-shot|powershot|instax|dji[[:space:]]*(osmo[[:space:]]*)?action' then 'CAMERA'
      else null
    end category_hint,
    case
      when lower_txt ~ 'dell[[:space:]]+precision[[:space:]]+5820' then 'Dell Precision 5820'
      when lower_txt ~ 'ipad[[:space:]]*air[[:space:]]*5|ไอแพด[[:space:]]*air[[:space:]]*5' then 'Apple iPad Air 5'
      when lower_txt ~ 'ipad[[:space:]]*(gen[[:space:]]*)?9|ไอแพด[[:space:]]*(gen[[:space:]]*)?9' then 'Apple iPad 9th Gen'
      when lower_txt ~ 'matepad[[:space:]]*t[[:space:]]*10s|matepad[[:space:]]*t10s' then 'Huawei MatePad T10s'
      when lower_txt ~ 'iphone[[:space:]]*xr|ไอโฟน[[:space:]]*xr' then 'Apple iPhone XR'
      when lower_txt ~ 'insta[[:space:]]*360[[:space:]]*(one[[:space:]]*)?x2' then 'Insta360 ONE X2'
      when lower_txt ~ 'dji[[:space:]]*(osmo[[:space:]]*)?action[[:space:]]*3' then 'DJI Osmo Action 3'
      when lower_txt ~ 'apple[[:space:]]*watch.*series[[:space:]]*10' then 'Apple Watch Series 10'
      when lower_txt ~ 'apple[[:space:]]*watch|แอ[ป๊]?เปิ้ล.*watch|นาฬิกา.*(apple|แอ[ป๊]?เปิ้ล)|smart[[:space:]]*watch' then 'Smartwatch'
      when lower_txt ~ 'เครื่องเกม|nintendo|นินเท|playstation|xbox' then 'Game console'
      when lower_txt ~ 'จอพกพา|portable[[:space:]]*monitor' then 'Portable monitor'
      when lower_txt ~ 'รับซื้อทีวี|(^|[^a-z])tv([^a-z]|$)|โทรทัศน์' then 'Television'
      when lower_txt ~ 'กล้องส่องทางไกล|binocular' then 'Binoculars'
      when lower_txt ~ 'เหล้า|whisk(y|ey)|cognac|บรั่นดี|(^|[^a-z])xo([^a-z]|$)' then 'Alcoholic beverage'
      when lower_txt ~ 'macbook' then 'Apple MacBook'
      when lower_txt ~ 'iphone|ไอโฟน' then 'Apple iPhone'
      when lower_txt ~ 'ipad|ไอแพด|tablet|แท็บเล็ต|matepad|galaxy[[:space:]]*tab' then 'Tablet'
      when lower_txt ~ 'notebook|โน้ตบุ๊ก|โน๊ตบุ๊ค|laptop' then 'Notebook'
      when lower_txt ~ 'workstation|desktop|คอมตั้งโต๊ะ|คอมพิวเตอร์|precision[[:space:]]+[0-9]{4}' then 'Desktop PC'
      when lower_txt ~ 'กล้อง|camera|cyber-shot|powershot|instax|dji[[:space:]]*(osmo[[:space:]]*)?action' then 'Camera'
      else null
    end title_hint
  from base
),
enriched as (
  select *,
    case
      when title_hint='Dell Precision 5820' then 'Dell Precision 5820'
      when title_hint='Apple iPad Air 5' then 'iPad Air 5'
      when title_hint='Apple iPad 9th Gen' then 'iPad 9th Gen'
      when title_hint='Huawei MatePad T10s' then 'Huawei MatePad T10s'
      when title_hint='Apple iPhone XR' then 'iPhone XR'
      when title_hint='Insta360 ONE X2' then 'Insta360 ONE X2'
      when title_hint='DJI Osmo Action 3' then 'DJI Osmo Action 3'
      when title_hint='Apple Watch Series 10' then 'Apple Watch Series 10'
      else null
    end model_name,
    case
      when title_hint='Dell Precision 5820' then '5820'
      when title_hint='Insta360 ONE X2' then 'X2'
      when title_hint='DJI Osmo Action 3' then 'ACTION3'
      else null
    end model_code,
    case
      when lower_txt ~ '(^|[^0-9])64[[:space:]]*(gb|g)([^a-z]|$)' then '64 GB'
      when lower_txt ~ '(^|[^0-9])128[[:space:]]*(gb|g)([^a-z]|$)' then '128 GB'
      when lower_txt ~ '(^|[^0-9])256[[:space:]]*(gb|g)([^a-z]|$)' then '256 GB'
      when lower_txt ~ '(^|[^0-9])512[[:space:]]*(gb|g)([^a-z]|$)' then '512 GB'
      else null
    end storage_hint
  from classified
  where category_hint is not null
),
final as (
  select *,
    case
      when title_hint='Dell Precision 5820' then
        jsonb_strip_nulls(jsonb_build_object(
          'brand','Dell','model','Precision 5820','series','Precision',
          'cpu',case when lower_txt ~ 'w-2223' then 'Intel Xeon W-2223' end,
          'ram',case when lower_txt ~ '32[[:space:]]*gb' then '32 GB' end,
          'storage',case when lower_txt ~ '256[[:space:]]*gb' and lower_txt ~ '2[[:space:]]*tb' then '256 GB NVMe + 2 TB NVMe' end,
          'gpu',case when lower_txt ~ 'a2000' then 'NVIDIA Quadro RTX A2000 6GB' end
        ))
      when title_hint='Apple iPad Air 5' then jsonb_strip_nulls(jsonb_build_object('brand','Apple','model','iPad Air 5','storage',storage_hint))
      when title_hint='Apple iPad 9th Gen' then jsonb_strip_nulls(jsonb_build_object('brand','Apple','model','iPad 9th Gen','storage',storage_hint))
      when title_hint='Huawei MatePad T10s' then jsonb_strip_nulls(jsonb_build_object('brand','Huawei','model','MatePad T10s','storage',storage_hint))
      when title_hint='Apple iPhone XR' then jsonb_strip_nulls(jsonb_build_object('brand','Apple','model','iPhone XR','storage',storage_hint))
      when title_hint='Insta360 ONE X2' then jsonb_build_object('brand','Insta360','model','ONE X2')
      when title_hint='DJI Osmo Action 3' then jsonb_build_object('brand','DJI','model','Osmo Action 3')
      when title_hint='Apple Watch Series 10' then jsonb_build_object('brand','Apple','model','Watch Series 10')
      else '{}'::jsonb
    end confirmed,
    to_jsonb(array_remove(array[
      case when screen_defect then 'SCREEN_DEFECT' end,
      case when not_booting then 'DEVICE_NOT_BOOTING' end,
      case when liquid_damage then 'LIQUID_DAMAGE_HISTORY' end
    ]::text[],null)) pricing_tags,
    case
      when category_hint='OTHER' then 'HUMAN_REVIEW'
      when not_booting or liquid_damage then 'HUMAN_REVIEW'
      when title_hint='Dell Precision 5820' then 'READY_TO_PRICE'
      when title_hint in ('Insta360 ONE X2','DJI Osmo Action 3') then 'READY_TO_PRICE'
      when title_hint in ('Apple iPad Air 5','Apple iPad 9th Gen','Huawei MatePad T10s','Apple iPhone XR')
        and storage_hint is not null then 'READY_TO_PRICE'
      when model_name is not null then 'NEED_MORE_INFO'
      else 'IDENTIFYING_PRODUCT'
    end next_state,
    case
      when category_hint='OTHER' or not_booting or liquid_damage then 'HUMAN_REQUIRED'
      else 'AUTO'
    end next_control_mode,
    case
      when title_hint in ('Dell Precision 5820','Insta360 ONE X2','DJI Osmo Action 3') then 0.99
      when model_name is not null then 0.98
      else 0.82
    end identity_confidence,
    case
      when title_hint='Dell Precision 5820' then 0.86
      when title_hint in ('Insta360 ONE X2','DJI Osmo Action 3') then 0.86
      when model_name is not null and storage_hint is not null then 0.90
      when model_name is not null then 0.65
      else 0.20
    end spec_completeness,
    case when screen_defect or not_booting or liquid_damage then 0.90 else 0.20 end condition_completeness,
    case
      when category_hint='OTHER' then 0.10
      when not_booting or liquid_damage then 0.35
      when title_hint in ('Dell Precision 5820','Insta360 ONE X2','DJI Osmo Action 3') then 0.92
      when model_name is not null and storage_hint is not null then 0.92
      when model_name is not null then 0.50
      else 0.20
    end pricing_readiness,
    case
      when category_hint='OTHER' then 'UNSUPPORTED_CATEGORY'
      when not_booting then 'DEVICE_NOT_BOOTING'
      when liquid_damage then 'HUMAN_REVIEW_REQUIRED'
      when title_hint in ('Dell Precision 5820','Insta360 ONE X2','DJI Osmo Action 3') then 'READY_BY_MODEL_CODE'
      when model_name is not null and storage_hint is not null then 'READY_BY_MODEL_IDENTITY'
      when model_name is not null and category_hint in ('SMARTPHONE','TABLET') then 'MISSING_STORAGE_VARIANT'
      else 'MISSING_MODEL'
    end readiness_reason,
    case
      when category_hint='OTHER' or not_booting or liquid_damage then '[]'::jsonb
      when title_hint in ('Dell Precision 5820','Insta360 ONE X2','DJI Osmo Action 3') then '[]'::jsonb
      when model_name is not null and storage_hint is not null then '[]'::jsonb
      when model_name is not null and category_hint in ('SMARTPHONE','TABLET') then '["STORAGE_VARIANT"]'::jsonb
      else '["MODEL"]'::jsonb
    end requested_inputs
  from enriched
)
select * from final;

insert into public.ai_buyer_product_observations(
  case_id,source,confirmed,inferred,unknown_fields,evidence,
  model_name,model_code,category,identity_confidence
)
select
  t.case_id,
  'CUSTOMER_TEXT',
  t.confirmed,
  '{}'::jsonb,
  case
    when t.readiness_reason='MISSING_STORAGE_VARIANT' then '["storage"]'::jsonb
    when t.readiness_reason='MISSING_MODEL' then '["model"]'::jsonb
    else '[]'::jsonb
  end,
  jsonb_build_array(jsonb_build_object(
    'type','DETERMINISTIC_TEXT_BACKFILL',
    'policy','P0_TEXT_CLASSIFIER_V1'
  )),
  t.model_name,t.model_code,t.category_hint,t.identity_confidence
from tmp_ai_buyer_text_backfill t
where not exists (
  select 1 from public.ai_buyer_product_observations o
  where o.case_id=t.case_id
    and o.source='CUSTOMER_TEXT'
    and o.evidence @> '[{"type":"DETERMINISTIC_TEXT_BACKFILL"}]'::jsonb
);

update public.ai_buyer_valuation_cases c
set category=t.category_hint,
    title=coalesce(c.title,t.title_hint),
    state=t.next_state,
    control_mode=t.next_control_mode,
    identity_confidence=greatest(coalesce(c.identity_confidence,0),t.identity_confidence),
    spec_completeness=greatest(coalesce(c.spec_completeness,0),t.spec_completeness),
    condition_completeness=greatest(coalesce(c.condition_completeness,0),t.condition_completeness),
    pricing_readiness=case
      when t.next_state='HUMAN_REVIEW' then least(greatest(coalesce(c.pricing_readiness,0),t.pricing_readiness),0.49)
      else greatest(coalesce(c.pricing_readiness,0),t.pricing_readiness)
    end,
    metadata=coalesce(c.metadata,'{}'::jsonb)
      || jsonb_build_object(
        'lastRequestedInputs',t.requested_inputs,
        'lastPricingTags',t.pricing_tags,
        'lastFlags',to_jsonb(array['DETERMINISTIC_TEXT_CLASSIFICATION','P0_TEXT_BACKFILL']),
        'readinessReason',t.readiness_reason,
        'deterministicTextBackfillAt',now()
      ),
    updated_at=now()
from tmp_ai_buyer_text_backfill t
where c.id=t.case_id;

update public.ai_buyer_conversations conv
set control_mode='HUMAN_REQUIRED'
where exists (
  select 1
  from tmp_ai_buyer_text_backfill t
  where t.conversation_id=conv.id
    and t.next_control_mode='HUMAN_REQUIRED'
);
