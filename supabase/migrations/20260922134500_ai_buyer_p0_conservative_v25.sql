-- P0 Pricing Coverage V2.5 Conservative Dealer Mode
-- User calibration: V2.4 buy prices were still slightly too high.
-- Clone V2.4, lower opening/target/hard-max for the new coverage rows,
-- and tighten market fallback percentages/risk reserves.

do $$
declare
  v_old uuid;
  v_new uuid;
begin
  select id into v_old
  from public.ai_buyer_price_book_versions
  where status='ACTIVE'
  order by activated_at desc nulls last, created_at desc
  limit 1;

  if v_old is null then
    raise exception 'AI Buyer active price book missing';
  end if;

  select id into v_new
  from public.ai_buyer_price_book_versions
  where version_name='AMPHON Master Price Book V2.5 Conservative'
  limit 1;

  if v_new is null then
    insert into public.ai_buyer_price_book_versions(
      version_name,status,source_name,source_checksum
    ) values (
      'AMPHON Master Price Book V2.5 Conservative',
      'DRAFT',
      'V2.4 P0 Coverage + conservative dealer calibration 2026-09-22',
      'p0-conservative-2026-09-22-v1'
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
      opening_discount_percent,risk_reserve,rounding_step,confidence_gate,metadata
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

    -- Conservative dealer buy prices: reduce target about 7–12% and hard max about 8–12%.
    update public.ai_buyer_price_book_entries
    set opening_offer=2100,target_buy=2300,hard_max=2600,updated_at=now()
    where version_id=v_new and category='CAMERA' and model='Digital IXUS 70';

    update public.ai_buyer_price_book_entries
    set opening_offer=2100,target_buy=2300,hard_max=2600,updated_at=now()
    where version_id=v_new and category='CAMERA' and model='PowerShot A3200 IS';

    update public.ai_buyer_price_book_entries
    set opening_offer=2000,target_buy=2200,hard_max=2500,updated_at=now()
    where version_id=v_new and category='CAMERA' and model='Osmo Action 4';

    update public.ai_buyer_price_book_entries
    set opening_offer=2200,target_buy=2500,hard_max=2800,updated_at=now()
    where version_id=v_new and category='CAMERA' and model='Instax Mini Evo';

    update public.ai_buyer_price_book_entries
    set opening_offer=6800,target_buy=7300,hard_max=8000,updated_at=now()
    where version_id=v_new and category='MACBOOK'
      and model='MacBook Pro 16-inch 2019 i7 32GB 512GB';

    update public.ai_buyer_price_book_entries
    set opening_offer=4900,target_buy=5300,hard_max=5700,updated_at=now()
    where version_id=v_new and category='NOTEBOOK' and model='ExpertBook B3402FE i5';

    update public.ai_buyer_price_book_entries
    set opening_offer=5900,target_buy=6300,hard_max=6800,updated_at=now()
    where version_id=v_new and category='NOTEBOOK'
      and model='Aspire Go 15 AG15-72P Core 5 120U 16GB';

    update public.ai_buyer_price_book_entries
    set opening_offer=1900,target_buy=2100,hard_max=2400,updated_at=now()
    where version_id=v_new and category='SMARTPHONE'
      and model='iPhone 11' and model_code='IPHONE11-64';

    update public.ai_buyer_price_book_entries
    set opening_offer=12000,target_buy=13000,hard_max=14500,updated_at=now()
    where version_id=v_new and category='SMARTPHONE'
      and model='iPhone 15 Pro Max' and model_code='IPHONE15PROMAX-256';

    update public.ai_buyer_price_book_entries
    set opening_offer=1200,target_buy=1400,hard_max=1600,updated_at=now()
    where version_id=v_new and category='TABLET'
      and model='MatePad T10s 3GB/64GB LTE';

    update public.ai_buyer_price_book_entries
    set opening_offer=6000,target_buy=6500,hard_max=7300,updated_at=now()
    where version_id=v_new and category='TABLET'
      and model='Pad 7 Pro 12GB/512GB';

    -- Preserve calibration provenance on cloned entries.
    insert into public.ai_buyer_price_calibration_sources(
      version_id,entry_id,source_url,source_title,source_kind,
      observed_price_thb,observed_at,note
    )
    select
      v_new,new_e.id,s.source_url,s.source_title,s.source_kind,
      s.observed_price_thb,s.observed_at,
      coalesce(s.note,'') || ' | carried forward to V2.5 conservative calibration'
    from public.ai_buyer_price_calibration_sources s
    join public.ai_buyer_price_book_entries old_e on old_e.id=s.entry_id
    join public.ai_buyer_price_book_entries new_e
      on new_e.version_id=v_new
     and new_e.category=old_e.category
     and new_e.model=old_e.model
     and coalesce(new_e.model_code,'')=coalesce(old_e.model_code,'')
     and new_e.condition_key=old_e.condition_key
    where s.version_id=v_old;

    -- Tighten all market-fallback categories so unseen models also follow dealer-first margins.
    update public.ai_buyer_category_pricing_rules
    set buyback_percent=0.50,hard_max_percent=0.57,risk_reserve=700,updated_at=now()
    where category='CAMERA';

    update public.ai_buyer_category_pricing_rules
    set buyback_percent=0.50,hard_max_percent=0.56,risk_reserve=800,updated_at=now()
    where category='DESKTOP_PC';

    update public.ai_buyer_category_pricing_rules
    set buyback_percent=0.54,hard_max_percent=0.60,risk_reserve=800,updated_at=now()
    where category='MACBOOK';

    update public.ai_buyer_category_pricing_rules
    set buyback_percent=0.53,hard_max_percent=0.58,risk_reserve=700,updated_at=now()
    where category='NOTEBOOK';

    update public.ai_buyer_category_pricing_rules
    set buyback_percent=0.55,hard_max_percent=0.62,risk_reserve=500,
        adjustments=coalesce(adjustments,'{}'::jsonb) || '{"BACK_PANEL_REPLACED":-2500}'::jsonb,
        updated_at=now()
    where category='SMARTPHONE';

    update public.ai_buyer_category_pricing_rules
    set buyback_percent=0.53,hard_max_percent=0.59,risk_reserve=600,updated_at=now()
    where category='TABLET';

    perform public.ai_buyer_activate_price_book(v_new);
  else
    perform public.ai_buyer_activate_price_book(v_new);
  end if;
end $$;
