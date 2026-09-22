-- P0 Pricing Coverage V2.4
-- Clones V2.3, adds deterministic coverage for common evidence-ready models,
-- keeps spec pricing intact, and records calibration evidence.

create table if not exists public.ai_buyer_price_calibration_sources (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.ai_buyer_price_book_versions(id) on delete cascade,
  entry_id uuid not null references public.ai_buyer_price_book_entries(id) on delete cascade,
  source_url text not null,
  source_title text,
  source_kind text not null default 'USED_MARKET',
  observed_price_thb numeric,
  observed_at date,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists ai_buyer_price_calibration_sources_entry_idx
  on public.ai_buyer_price_calibration_sources(entry_id, created_at desc);

alter table public.ai_buyer_price_calibration_sources enable row level security;
revoke all on table public.ai_buyer_price_calibration_sources from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_buyer_price_calibration_sources to service_role;

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
  where version_name='AMPHON Master Price Book V2.4 P0 Coverage'
  limit 1;

  if v_new is null then
    insert into public.ai_buyer_price_book_versions(
      version_name,status,source_name,source_checksum
    ) values (
      'AMPHON Master Price Book V2.4 P0 Coverage',
      'DRAFT',
      'P0 Pricing Coverage 2026-09-22 + V2.3 clone',
      'p0-coverage-2026-09-22-v1'
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

    -- CAMERA: common, directly identifiable models.
    insert into public.ai_buyer_price_book_entries(
      version_id,category,brand,model,model_code,aliases,spec_match,condition_key,
      estimated_resale,opening_offer,target_buy,hard_max,adjustments,active,
      normalized_brand,normalized_model,normalized_model_code,lookup_keys
    ) values
    (
      v_new,'CAMERA','Canon','Digital IXUS 70','IXUS 70',
      '["Canon IXUS 70","IXY Digital 10","Canon IXY Digital 10"]'::jsonb,
      '{}'::jsonb,'NORMAL',
      5900,2500,2700,3100,'{}'::jsonb,true,
      'canon','digitalixus70','ixus70',
      array['digitalixus70','ixus70','canonixus70','ixydigital10','canonixydigital10']
    ),
    (
      v_new,'CAMERA','Canon','PowerShot A3200 IS','PC1590',
      '["Canon PowerShot A3200 IS","PowerShot A3200IS","A3200 IS"]'::jsonb,
      '{}'::jsonb,'NORMAL',
      5900,2500,2700,3100,'{}'::jsonb,true,
      'canon','powershota3200is','pc1590',
      array['powershota3200is','pc1590','canonpowershota3200is','a3200is']
    ),
    (
      v_new,'CAMERA','DJI','Osmo Action 4',null,
      '["DJI Osmo Action 4","Action 4"]'::jsonb,
      '{}'::jsonb,'NORMAL',
      5500,2300,2500,2900,'{}'::jsonb,true,
      'dji','osmoaction4',null,
      array['osmoaction4','djiosmoaction4','action4']
    ),
    (
      v_new,'CAMERA','Fujifilm','Instax Mini Evo',null,
      '["Fujifilm Instax Mini Evo","Fuji Instax Mini Evo","Instax mini EVO"]'::jsonb,
      '{}'::jsonb,'NORMAL',
      6200,2600,2900,3300,'{}'::jsonb,true,
      'fujifilm','instaxminievo',null,
      array['instaxminievo','fujifilminstaxminievo','fujiinstaxminievo']
    ),

    -- MACBOOK: exact generation/spec guard.
    (
      v_new,'MACBOOK','Apple','MacBook Pro 16-inch 2019 i7 32GB 512GB','A2141',
      '["MacBook Pro (16-inch, 2019)","MacBook Pro 16 2019","A2141 (likely)"]'::jsonb,
      '{"cpu":"Core i7","ram":"32 GB"}'::jsonb,'NORMAL',
      15000,7600,8100,9000,'{}'::jsonb,true,
      'apple','macbookpro16inch2019i732gb512gb','a2141',
      array['macbookpro16inch2019i732gb512gb','macbookpro16inch2019','macbookpro162019','a2141','a2141likely']
    ),

    -- NOTEBOOK: exact model-code with known CPU/RAM guard.
    (
      v_new,'NOTEBOOK','ASUS','ExpertBook B3402FE i5','B3402FE',
      '["ASUS ExpertBook B3402FE","ExpertBook B3402FE"]'::jsonb,
      '{"cpu":"Intel Core i5"}'::jsonb,'NORMAL',
      11000,5500,5900,6400,'{}'::jsonb,true,
      'asus','expertbookb3402fei5','b3402fe',
      array['expertbookb3402fei5','asusexpertbookb3402fe','expertbookb3402fe','b3402fe']
    ),
    (
      v_new,'NOTEBOOK','Acer','Aspire Go 15 AG15-72P Core 5 120U 16GB','AG15-72P',
      '["Acer Aspire Go 15 AG15-72P","Aspire Go 15","AG15-72P-550E"]'::jsonb,
      '{"cpu":"Core 5 120U","ram":"16 GB"}'::jsonb,'NORMAL',
      13000,6600,7100,7600,'{}'::jsonb,true,
      'acer','aspirego15ag1572pcore5120u16gb','ag1572p',
      array['aspirego15ag1572pcore5120u16gb','aceraspirego15ag1572p','aspirego15','ag1572p','ag1572p550e']
    ),

    -- SMARTPHONE: exact capacity rows. Existing 128GB iPhone 11 row remains guarded.
    (
      v_new,'SMARTPHONE','Apple','iPhone 11','IPHONE11-64',
      '["Apple iPhone 11 64GB","iPhone 11 64GB"]'::jsonb,
      '{"storage":"64 GB"}'::jsonb,'NORMAL',
      4400,2100,2300,2600,'{}'::jsonb,true,
      'apple','iphone11','iphone1164',
      array['iphone11','iphone1164','appleiphone1164gb','iphone1164gb']
    ),
    (
      v_new,'SMARTPHONE','Apple','iPhone 15 Pro Max','IPHONE15PROMAX-256',
      '["Apple iPhone 15 Pro Max 256GB","iPhone 15 Pro Max 256GB"]'::jsonb,
      '{"storage":"256 GB"}'::jsonb,'NORMAL',
      24000,13200,14100,15700,'{}'::jsonb,true,
      'apple','iphone15promax','iphone15promax256',
      array['iphone15promax','iphone15promax256','appleiphone15promax256gb','iphone15promax256gb']
    ),

    -- TABLET: exact model/variant rows.
    (
      v_new,'TABLET','Huawei','MatePad T10s 3GB/64GB LTE','AGS3-L09',
      '["Huawei MatePad T10s","Huawei AGS3-L09","MatePad T10s 64GB"]'::jsonb,
      '{"ram":"3.0 GB","storage":"64.00 GB"}'::jsonb,'NORMAL',
      3500,1500,1600,1800,'{}'::jsonb,true,
      'huawei','matepadt10s3gb64gblte','ags3l09',
      array['matepadt10s3gb64gblte','huaweimatepadt10s','huaweiags3l09','ags3l09','matepadt10s64gb']
    ),
    (
      v_new,'TABLET','Xiaomi','Pad 7 Pro 12GB/512GB','PAD7PRO-512',
      '["Xiaomi Pad 7 Pro 12GB/512GB","Xiaomi Pad 7 Pro"]'::jsonb,
      '{"ram":"12GB","storage":"512GB"}'::jsonb,'NORMAL',
      13000,6600,7100,8000,'{}'::jsonb,true,
      'xiaomi','pad7pro12gb512gb','pad7pro512',
      array['pad7pro12gb512gb','xiaomipad7pro12gb512gb','xiaomipad7pro','pad7pro512']
    );

    -- Pricing rule: repaired/replaced back panel materially reduces resale confidence/value.
    update public.ai_buyer_category_pricing_rules
    set adjustments=coalesce(adjustments,'{}'::jsonb) || '{"BACK_PANEL_REPLACED":-2000}'::jsonb
    where category='SMARTPHONE';

    -- Calibration evidence: current Thai used market / direct buyback / official ceiling.
    insert into public.ai_buyer_price_calibration_sources(
      version_id,entry_id,source_url,source_title,source_kind,observed_price_thb,observed_at,note
    )
    select v_new,e.id,s.url,s.title,s.kind,s.price,date '2026-09-22',s.note
    from public.ai_buyer_price_book_entries e
    join (values
      ('digitalixus70','https://shopee.co.th/Canon-Ixus-70-%28%E0%B8%81%E0%B8%A5%E0%B9%89%E0%B8%AD%E0%B8%87%E0%B8%94%E0%B8%B4%E0%B8%88%E0%B8%B4%E0%B8%95%E0%B8%AD%E0%B8%A5%E0%B8%A1%E0%B8%B7%E0%B8%AD%E0%B8%AA%E0%B8%AD%E0%B8%87%29-i.439629942.44478118847','Canon IXUS 70 used Thailand','USED_MARKET',5990::numeric,'Domestic used asking price'),
      ('powershota3200is','https://shopee.co.th/Canon-Powershot-a3200-IS-%28-rare-%E0%B8%AA%E0%B8%B8%E0%B8%94%E0%B9%86%29-%E0%B8%81%E0%B8%A5%E0%B9%89%E0%B8%AD%E0%B8%87%E0%B8%94%E0%B8%B4%E0%B8%88%E0%B8%B4%E0%B8%95%E0%B8%AD%E0%B8%A5-i.1866227.29312879520','Canon PowerShot A3200 IS used','USED_MARKET',4990::numeric,'Lower domestic used comp'),
      ('powershota3200is','https://shopee.co.th/Canon-Powershot-A3200IS%28%E0%B8%A3%E0%B8%B8%E0%B9%88%E0%B8%99%E0%B8%AB%E0%B8%B2%E0%B8%A2%E0%B8%B2%E0%B8%81%29-i.1142003527.29466814872','Canon PowerShot A3200 IS used','USED_MARKET',5904::numeric,'Domestic used comp'),
      ('powershota3200is','https://shopee.co.th/Canon-powershot-A3200-IS-%E0%B8%AA%E0%B8%B5%E0%B8%AB%E0%B8%B2%E0%B8%A2%E0%B8%B2%E0%B8%81-rare-item%29-i.1526515149.53110386633','Canon PowerShot A3200 IS used','USED_MARKET',7490::numeric,'Upper domestic used comp'),
      ('osmoaction4','https://shopee.co.th/DJI-OSMO-ACTION-4-%28%E0%B8%A1%E0%B8%B7%E0%B8%AD%E0%B8%AA%E0%B8%AD%E0%B8%87%E0%B8%AA%E0%B8%A0%E0%B8%B2%E0%B8%9E%E0%B8%94%E0%B8%B5%E0%B8%A1%E0%B8%B2%E0%B8%81%29-%E0%B8%82%E0%B8%AD%E0%B8%87%E0%B9%81%E0%B8%97%E0%B9%89%E0%B8%84%E0%B8%A3%E0%B8%9A%E0%B8%81%E0%B8%A5%E0%B9%88%E0%B8%AD%E0%B8%87-%E0%B8%A1%E0%B8%B5%E0%B8%82%E0%B8%AD%E0%B8%87%E0%B9%81%E0%B8%96%E0%B8%A1%E0%B8%9E%E0%B8%A3%E0%B9%89%E0%B8%AD%E0%B8%A1%E0%B9%83%E0%B8%8A%E0%B9%89%E0%B8%87%E0%B8%B2%E0%B8%99%E0%B9%84%E0%B8%94%E0%B9%89%E0%B8%95%E0%B8%B2%E0%B8%A1%E0%B8%9B%E0%B8%81%E0%B8%95%E0%B8%B4%E0%B8%97%E0%B8%B8%E0%B8%81%E0%B8%AD%E0%B8%A2%E0%B9%88%E0%B8%B2%E0%B8%87-i.1524803390.26738384944','DJI Osmo Action 4 used complete','USED_MARKET',5000::numeric,'Domestic used asking price'),
      ('instaxminievo','https://shopee.co.th/product/28310629/47454399751','Fujifilm Instax Mini Evo used','USED_MARKET',4790::numeric,'Lower domestic used comp'),
      ('instaxminievo','https://shopee.co.th/Fujifilm-Instax-mini-EVO-second-hand-%E0%B8%81%E0%B8%A5%E0%B9%89%E0%B8%AD%E0%B8%87%E0%B9%82%E0%B8%9E%E0%B8%A5%E0%B8%B2%E0%B8%A3%E0%B8%AD%E0%B8%A2%E0%B8%94%E0%B9%8C%E0%B8%A1%E0%B8%B7%E0%B8%AD%E0%B8%AA%E0%B8%AD%E0%B8%87-i.197344142.29391544898','Fujifilm Instax Mini Evo used','USED_MARKET',5999::numeric,'Domestic used comp'),
      ('instaxminievo','https://shopee.co.th/Fujifilm-Instax-Mini-Evo-%E0%B8%AA%E0%B8%A0%E0%B8%B2%E0%B8%9E%E0%B8%94%E0%B8%B5-%E0%B8%A1%E0%B8%B7%E0%B8%AD%E0%B8%AA%E0%B8%AD%E0%B8%87--i.119169558.23233939399','Fujifilm Instax Mini Evo used good','USED_MARKET',6590::numeric,'Domestic used comp'),
      ('macbookpro16inch2019i732gb512gb','https://mac2hand.com/search/Macbook%20Pro%2016/all?page=2','MacBook Pro 16-inch 2019 i7 16GB/512GB','NEIGHBOR_SPEC',11900::numeric,'Lower neighboring spec; 32GB case calibrated above this'),
      ('macbookpro16inch2019i732gb512gb','https://mac2hand.com/detail/1001497/MacBook%2BPro%2B16-inch%2C%2B2019%2B2.4GHz%2B8-Core%2BIntel%2BCore%2Bi9%2B%28i9-9980HK%2C%2BRadeon%2BPro%2B5500M_5600M%29%2B%C2%B7%2BRAM%2B32GB%2B%C2%B7%2B512GB%2BSSD%2B%C2%B7%2BSpace%2BGray%2BMacbbok%2BPro%2B16%22%2B2019%2BCTO%2BIntel%2Bi9-RAM32-FS512GB-AMD5500M%2B4GB','MacBook Pro 16-inch 2019 i9 32GB/512GB','NEIGHBOR_SPEC',18500::numeric,'Upper neighboring CPU; i7 32GB case calibrated below this'),
      ('expertbookb3402fei5','https://shopee.co.th/-used-Asus-ExpertBook-Flip-2-in-1-i7-1165G7-Ram16-SSD512-%28B3402FE%29-i.83900155.29190525097','ASUS ExpertBook B3402FE i7 16/512 used','NEIGHBOR_SPEC',20500::numeric,'i5 row intentionally discounted versus i7 market listing'),
      ('aspirego15ag1572pcore5120u16gb','https://shopee.co.th/ACER-ASPIRE-GO-15-AG15-72P-550E-NOTEBOOK-INTEL-CORE-5-120U-16GB-512GB-WIN11-OFF-2024-%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B8%81%E0%B8%B1%E0%B8%99%E0%B8%A8%E0%B8%B9%E0%B8%99%E0%B8%A2%E0%B9%8C-2-%E0%B8%9B%E0%B8%B5-OSS-i.163842744.57055661655','Acer Aspire Go 15 AG15-72P-550E new','NEW_REFERENCE',18890::numeric,'New retail ceiling; used resale discounted materially'),
      ('iphone11','https://www.kaidee.com/product-371567914','iPhone 11 64GB used','USED_MARKET',4400::numeric,'Current domestic used comp'),
      ('iphone11','https://www.kaidee.com/product-371555880','iPhone 11 64GB 75% battery used','USED_MARKET',4900::numeric,'Current domestic used comp'),
      ('iphone11','https://www.rabfaks.com/product/iphone-11-64gb-%E0%B8%AA%E0%B8%A0%E0%B8%B2%E0%B8%9E%E0%B8%AA%E0%B8%A7%E0%B8%A290-%E0%B9%81%E0%B8%9A%E0%B8%9571-%E0%B8%94%E0%B8%B3/','iPhone 11 64GB 71% battery used','USED_MARKET',4500::numeric,'Current domestic used comp'),
      ('iphone11','https://www.bkkapple.com/iphone/iphone-11-64gb','iPhone 11 64GB buyback Tier A','BUYBACK_REFERENCE',2000::numeric,'Competitor perfect-condition buyback ceiling reference'),
      ('iphone15promax','https://www.kaidee.com/product-371559877','iPhone 15 Pro Max 256GB used','USED_MARKET',21790::numeric,'Current domestic used comp'),
      ('iphone15promax','https://www.kaidee.com/product-371542439','iPhone 15 Pro Max 256GB 79% battery used','USED_MARKET',23000::numeric,'Current domestic used comp'),
      ('iphone15promax','https://www.kaidee.com/en/product-371517619','iPhone 15 Pro Max 256GB 83% battery original used','USED_MARKET',26500::numeric,'Current domestic used comp'),
      ('iphone15promax','https://atmobile.app/price/iphone-15-pro-max','iPhone 15 Pro Max 256GB buyback','BUYBACK_REFERENCE',20500::numeric,'Competitor perfect-condition buyback reference'),
      ('matepadt10s3gb64gblte','https://www.ennxo.com/en/mobile-device/tablet/huawei/others?province=bangkok','Huawei MatePad T10s 64GB used','USED_MARKET',3500::numeric,'Domestic used asking price'),
      ('matepadt10s3gb64gblte','https://www.priceza.com/s/%E0%B8%A3%E0%B8%B2%E0%B8%84%E0%B8%B2/huawei-matepad-t10s','Huawei MatePad T10s market range','MARKET_AGGREGATE',3500::numeric,'Aggregate supports low-thousands resale range'),
      ('pad7pro12gb512gb','https://www.mi.com/th/support/terms/2025-back-to-school/','Xiaomi Pad 7 Pro 12GB/512GB new Thailand','NEW_REFERENCE',18990::numeric,'Official new-price ceiling; used row discounted aggressively')
    ) as s(model_key,url,title,kind,price,note)
      on e.version_id=v_new and e.normalized_model=s.model_key;

    perform public.ai_buyer_activate_price_book(v_new);
  else
    update public.ai_buyer_category_pricing_rules
    set adjustments=coalesce(adjustments,'{}'::jsonb) || '{"BACK_PANEL_REPLACED":-2000}'::jsonb
    where category='SMARTPHONE';

    if not exists (
      select 1 from public.ai_buyer_price_book_versions
      where id=v_new and status='ACTIVE'
    ) then
      perform public.ai_buyer_activate_price_book(v_new);
    end if;
  end if;
end $$;
