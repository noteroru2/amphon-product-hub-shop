-- P0 Pricing Coverage V2.6: extend deterministic coverage for newly recovered READY_TO_PRICE cases.
-- Conservative dealer-first prices; AI remains paused.

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
  where version_name='AMPHON Master Price Book V2.6 Expanded Coverage'
  limit 1;

  if v_new is null then
    insert into public.ai_buyer_price_book_versions(
      version_name,status,source_name,source_checksum
    ) values (
      'AMPHON Master Price Book V2.6 Expanded Coverage',
      'DRAFT',
      'V2.5 Conservative + recovered-case coverage 2026-09-22',
      'p0-expanded-coverage-2026-09-22-v1'
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

    insert into public.ai_buyer_price_book_entries(
      version_id,category,brand,model,model_code,aliases,spec_match,condition_key,
      estimated_resale,opening_offer,target_buy,hard_max,adjustments,active,
      normalized_brand,normalized_model,normalized_model_code,lookup_keys
    ) values
    (
      v_new,'CAMERA','DJI','Osmo Action 3','ACTION3',
      '["DJI Osmo Action 3","DJI Action 3","Osmo Action 3 Standard"]'::jsonb,
      '{}'::jsonb,'NORMAL',
      7000,2500,2800,3200,'{}'::jsonb,true,
      'dji','osmoaction3','action3',
      array['osmoaction3','djiosmoaction3','djiaction3','action3']
    ),
    (
      v_new,'CAMERA','Insta360','ONE X2','X2',
      '["Insta360 ONE X2","Insta360 One X2","ONE X2"]'::jsonb,
      '{}'::jsonb,'NORMAL',
      7800,2800,3100,3500,'{}'::jsonb,true,
      'insta360','onex2','x2',
      array['onex2','insta360onex2','x2']
    ),
    (
      v_new,'TABLET','Apple','iPad Air 4 Wi-Fi 256GB','AIR4-WIFI-256',
      '["Apple iPad Air 4 256GB Wi-Fi","iPad Air 4 256GB WiFi","iPad Air (4th generation)"]'::jsonb,
      '{"storage":"256 GB"}'::jsonb,'NORMAL',
      9000,3400,3700,4200,'{}'::jsonb,true,
      'apple','ipadair4wifi256gb','air4wifi256',
      array['ipadair4wifi256gb','appleipadair4256gbwifi','ipadair4256gbwifi','ipadair4thgeneration','air4wifi256']
    ),
    (
      v_new,'MACBOOK','Apple','MacBook Air 13-inch M5 24GB 512GB','M5-13-512',
      '["MacBook Air 13-inch M5 (2026)","MacBook Air M5 24GB 512GB","MacBook Air 13 M5 24/512"]'::jsonb,
      '{"chip":"Apple M5","ram":"24 GB","storage":"512 GB"}'::jsonb,'NORMAL',
      38000,17500,18500,20500,'{}'::jsonb,true,
      'apple','macbookair13inchm524gb512gb','m513512',
      array['macbookair13inchm524gb512gb','macbookair13inchm52026','macbookairm524gb512gb','macbookair13m524512','m513512']
    ),
    (
      v_new,'DESKTOP_PC','Dell','Precision 5820 W-2223 RTX A2000','PRECISION5820-W2223-A2000',
      '["Dell Precision 5820","Precision 5820 W-2223 A2000","Dell 5820 W-2223 RTX A2000"]'::jsonb,
      '{"cpu":"W-2223","ram":"32 GB","gpu":"A2000"}'::jsonb,'NORMAL',
      25000,9500,10500,12000,'{}'::jsonb,true,
      'dell','precision5820w2223rtxa2000','precision5820w2223a2000',
      array['precision5820w2223rtxa2000','dellprecision5820','precision5820w2223a2000','dell5820w2223rtxa2000','precision5820w2223a2000']
    );

    -- Carry prior calibration evidence onto cloned rows.
    insert into public.ai_buyer_price_calibration_sources(
      version_id,entry_id,source_url,source_title,source_kind,
      observed_price_thb,observed_at,note
    )
    select
      v_new,new_e.id,s.source_url,s.source_title,s.source_kind,
      s.observed_price_thb,s.observed_at,
      coalesce(s.note,'') || ' | carried forward to V2.6 expanded coverage'
    from public.ai_buyer_price_calibration_sources s
    join public.ai_buyer_price_book_entries old_e on old_e.id=s.entry_id
    join public.ai_buyer_price_book_entries new_e
      on new_e.version_id=v_new
     and new_e.category=old_e.category
     and new_e.model=old_e.model
     and coalesce(new_e.model_code,'')=coalesce(old_e.model_code,'')
     and new_e.condition_key=old_e.condition_key
    where s.version_id=v_old;

    -- New market/reference evidence.
    insert into public.ai_buyer_price_calibration_sources(
      version_id,entry_id,source_url,source_title,source_kind,
      observed_price_thb,observed_at,note
    )
    select v_new,e.id,s.url,s.title,s.kind,s.price,date '2026-09-22',s.note
    from public.ai_buyer_price_book_entries e
    join (values
      ('osmoaction3','https://shopee.co.th/DJI-OSMO-Action-3-%E0%B8%A1%E0%B8%B7%E0%B8%AD%E0%B8%AA%E0%B8%AD%E0%B8%87-Action-Camera-i.55604807.28407684278','DJI Osmo Action 3 used','USED_MARKET',7590::numeric,'Thai used asking reference'),
      ('osmoaction3','https://shopee.co.th/-2nd-hand-DJI-OSMO-ACTION-3-Standard-%E0%B8%AA%E0%B8%A0%E0%B8%B2%E0%B8%9E%E0%B8%AA%E0%B8%A7%E0%B8%A2-%E0%B8%84%E0%B8%A3%E0%B8%9A%E0%B8%81%E0%B8%A5%E0%B9%88%E0%B8%AD%E0%B8%87-%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B8%81%E0%B8%B1%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%99-1-%E0%B9%80%E0%B8%94%E0%B8%B7%E0%B8%AD%E0%B8%99-i.18352867.29913446171','DJI Osmo Action 3 Standard used complete','USED_MARKET',6790::numeric,'Thai used shop reference'),
      ('onex2','https://shopee.co.th/%E0%B8%81%E0%B8%A5%E0%B9%89%E0%B8%AD%E0%B8%87%E0%B8%9E%E0%B8%B2%E0%B9%82%E0%B8%99%E0%B8%A3%E0%B8%B2%E0%B8%A1%E0%B8%B4%E0%B8%84-%E0%B8%AA%E0%B8%B3%E0%B8%AB%E0%B8%A3%E0%B8%B1%E0%B8%9A%E0%B8%81%E0%B8%A5%E0%B9%89%E0%B8%AD%E0%B8%87%E0%B9%81%E0%B8%AD%E0%B8%84%E0%B8%8A%E0%B8%B1%E0%B9%88%E0%B8%99-Insta360-ONE-X2-%E0%B8%A1%E0%B8%B7%E0%B8%AD%E0%B8%AA%E0%B8%AD%E0%B8%87-Panoramic-Camera-%E0%B8%81%E0%B8%A5%E0%B9%89%E0%B8%AD%E0%B8%87-Used-i.919854652.24359797128','Insta360 ONE X2 used','USED_MARKET',7881::numeric,'Current used asking reference'),
      ('ipadair4wifi256gb','https://www.kaidee.com/product-371566614','iPad Air 4 256GB Wi-Fi 84% battery','USED_MARKET',9500::numeric,'Current Thai used asking reference'),
      ('macbookair13inchm524gb512gb','https://mac2hand.com/detail/1000385/MacBook%2BAir%2B13-inch%2C%2BM5%2C%2B2026%2BM5%2B%2810-Core%2BCPU%2C%2B8-Core%2BGPU%29%2B%C2%B7%2BRAM%2B16GB%2B%C2%B7%2B512GB%2BSSD%2B%C2%B7%2BMidnight%2BMacbook%2BAir%2BM5%2B13%E0%B8%99%E0%B8%B4%E0%B9%89%E0%B8%A7%2BSSD%2B512%2BRam16%2B%E0%B8%AA%E0%B8%A0%E0%B8%B2%E0%B8%9E%E0%B9%80%E0%B8%AB%E0%B8%A1%E0%B8%B7%E0%B8%AD%E0%B8%99%E0%B9%83%E0%B8%AB%E0%B8%A1%E0%B9%88%2B%E0%B8%A8%E0%B8%B9%E0%B8%99%E0%B8%A2%E0%B9%8C%E0%B9%84%E0%B8%97%E0%B8%A2','MacBook Air M5 13 16GB/512GB used','NEIGHBOR_SPEC',39500::numeric,'Neighbor RAM variant upper reference; 24GB entry remains conservatively priced'),
      ('macbookair13inchm524gb512gb','https://mac2hand.com/detail/389322/Macbook%2BAir%2BM5%2B%2B13%2B%E0%B8%99%E0%B8%B4%E0%B9%89%E0%B8%A7%2BSSD%2B512%2BRam%2B16%2B%E0%B8%AA%E0%B8%A0%E0%B8%B2%E0%B8%9E%E0%B9%80%E0%B8%AB%E0%B8%A1%E0%B8%B7%E0%B8%AD%E0%B8%99%E0%B9%83%E0%B8%AB%E0%B8%A1%E0%B9%88%2B%E0%B8%A8%E0%B8%B9%E0%B8%99%E0%B8%A2%E0%B9%8C%E0%B9%84%E0%B8%97%E0%B8%A2%2B%2B%E0%B8%AA%E0%B8%B5%2B%2BMidnight%2B%E0%B8%AD%E0%B8%B2%E0%B8%A2%E0%B8%B8%2B6%2B%E0%B8%A7%E0%B8%B1%E0%B8%99%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B8%81%E0%B8%B1%E0%B8%99%E0%B8%A8%E0%B8%B9%E0%B8%99%E0%B8%A2%E0%B9%8C%E0%B9%80%E0%B8%81%E0%B8%B7%E0%B8%AD%E0%B8%9A%E0%B8%9B%E0%B8%B5%2B%2B33500%2B%E0%B8%9A%E0%B8%B2%E0%B8%97','MacBook Air M5 13 16GB/512GB near-new used','NEIGHBOR_SPEC',33500::numeric,'Neighbor RAM variant lower reference'),
      ('precision5820w2223rtxa2000','https://www.vbs-solutions.net/product/tag/dell-5820','Dell Precision 5820 used workstation range','USED_MARKET',22900::numeric,'Thai used workstation reference'),
      ('precision5820w2223rtxa2000','https://shopee.co.th/search?keyword=workstation','Dell Precision 5820 W-2140b RTX4000 used','NEIGHBOR_SPEC',28500::numeric,'Higher GPU/CPU neighboring build'),
      ('precision5820w2223rtxa2000','https://www.acmedevice.com/product/tag/dell-precision-5820-%E0%B8%A1%E0%B8%B7%E0%B8%AD%E0%B8%AA%E0%B8%AD%E0%B8%87','Dell Precision 5820 W-2223 T1000 used','NEIGHBOR_SPEC',23000::numeric,'Same CPU, lower GPU neighboring build')
    ) as s(model_key,url,title,kind,price,note)
      on e.version_id=v_new and e.normalized_model=s.model_key;

    perform public.ai_buyer_activate_price_book(v_new);
  else
    perform public.ai_buyer_activate_price_book(v_new);
  end if;
end $$;
