-- AMPHON SHOP — Model-level Long-tail Automation
-- Production migration: 20260924044732_shop_model_longtail_automation
-- Creates HOLD model entities from real mapped Series stock, then lets SEO governance
-- promote only models whose parent hierarchy + stock/history + content qualify.

update public.products
set model = 'TUF Gaming F15',
    title = case
      when sku = 'AT-NB-2609-000044' then 'ASUS TUF Gaming F15 FX506HCB'
      else title
    end,
    updated_at = now()
where sku = 'AT-NB-2609-000044'
  and model = 'TUF Gaming F15 FX506HCB';

do $$
declare item record;
begin
  for item in
    select cl.product_id
    from public.commerce_listings cl
    join public.products p on p.id = cl.product_id
    where p.sku = 'AT-NB-2609-000044'
  loop
    perform private.sync_commerce_listing_taxonomy(item.product_id);
  end loop;
end
$$;

create or replace function private.sync_commerce_model_longtails()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_models integer := 0;
  remapped_listings integer := 0;
  item record;
begin
  with candidate_groups as (
    select
      cl.category_id,
      cl.brand_id,
      cl.series_id,
      b.name as brand_name,
      s.name as series_name,
      btrim(p.model) as model_name,
      private.commerce_ascii_slug(btrim(p.model)) as model_slug,
      case
        when count(distinct nullif(btrim(p.specs->>'model_code'), '')) = 1
        then min(nullif(btrim(p.specs->>'model_code'), ''))
        else null
      end as model_code,
      count(*) filter (
        where pp.status = 'published'
          and p.status in ('published','reserved')
      )::int as current_stock,
      count(*) filter (where pp.status is not null)::int as historical_stock
    from public.commerce_listings cl
    join public.products p on p.id = cl.product_id
    join public.product_publications pp
      on pp.product_id = p.id
     and pp.channel = 'website'
    join public.commerce_brands b on b.id = cl.brand_id and b.is_active = true
    join public.commerce_series s on s.id = cl.series_id and s.is_active = true
    where cl.category_id is not null
      and cl.brand_id is not null
      and cl.series_id is not null
      and nullif(btrim(p.model), '') is not null
      and p.model !~ '^-+$'
    group by cl.category_id, cl.brand_id, cl.series_id, b.name, s.name, btrim(p.model)
  ),
  inserted as (
    insert into public.commerce_models (
      category_id,
      brand_id,
      series_id,
      model_name,
      model_code,
      slug,
      seo_title,
      seo_description,
      seo_h1,
      intro_content,
      seo_content,
      faq,
      primary_keyword,
      index_policy,
      sort_order,
      is_active
    )
    select
      g.category_id,
      g.brand_id,
      g.series_id,
      g.model_name,
      g.model_code,
      g.model_slug,
      left(g.brand_name || ' ' || g.model_name || ' มือสอง พร้อมราคาและสเปกจริง | AMPHON TRADING', 180),
      left(
        'เลือกซื้อ ' || g.brand_name || ' ' || g.model_name ||
        ' มือสองจากสินค้าจริง ดูสเปก ราคา สภาพ รูป ตำหนิ แบต อุปกรณ์ และสถานะของแต่ละเครื่องก่อนซื้อ',
        320
      ),
      left(g.brand_name || ' ' || g.model_name || ' มือสอง พร้อมราคาและสเปกจริง', 180),
      g.brand_name || ' ' || g.model_name ||
      ' มือสองใน AMPHON SHOP มาจากสินค้าที่มีอยู่จริงในระบบ โดยแสดงราคา สเปก สภาพ รูป ตำหนิ อุปกรณ์ และสถานะของแต่ละเครื่อง เพื่อให้เทียบรุ่นย่อยและสภาพก่อนตัดสินใจซื้อได้จากข้อมูลของชิ้นจริง ไม่ใช่หน้ารวมข้อมูลที่ไม่มีสินค้า',
      g.brand_name || ' ' || g.model_name ||
      ' อยู่ในซีรีส์ ' || g.series_name ||
      ' แต่เครื่องชื่อรุ่นเดียวกันอาจต่างกันที่ CPU การ์ดจอ RAM SSD หน้าจอ แบต อุปกรณ์ ปีผลิต หรือรหัสย่อย ก่อนซื้อควรเปิดดูหน้าสินค้าแต่ละชิ้นและเทียบสเปกจริงกับงานที่ใช้ หากเป็นเครื่องเกมมิ่งให้ดู GPU, VRAM, ระบบระบายความร้อน และที่ชาร์จเพิ่ม หากเป็นเครื่องพกพาให้ดูแบต น้ำหนัก หน้าจอและพอร์ตควบคู่กัน การดูรหัสรุ่นและตำหนิจริงช่วยให้เทียบราคาได้แม่นกว่าการอิงชื่อรุ่นอย่างเดียว และเมื่อสินค้ารุ่นนี้หมด หน้าโมเดลจะไม่ถูกเปิดให้ค้นหาหากข้อมูลและประวัติยังไม่เพียงพอตามกติกา SEO ของร้าน',
      jsonb_build_array(
        jsonb_build_object(
          'question', 'ซื้อ ' || g.brand_name || ' ' || g.model_name || ' มือสองควรดูอะไร?',
          'answer', 'ดูสเปกของเครื่องจริง ราคา สภาพ แบต จอ คีย์บอร์ด พอร์ต ที่ชาร์จ รูปและตำหนิ พร้อมตรวจรหัสรุ่นย่อยหากมี เพราะชื่อโมเดลเดียวกันอาจมีสเปกต่างกัน'
        ),
        jsonb_build_object(
          'question', g.model_name || ' มือสองรุ่นเดียวกันทำไมราคาไม่เท่ากัน?',
          'answer', 'ราคาอาจต่างจาก CPU GPU RAM SSD สภาพแบต อายุเครื่อง อุปกรณ์ ประกัน และตำหนิของแต่ละชิ้น จึงควรเทียบจากหน้าสินค้าจริง'
        )
      ),
      left(g.brand_name || ' ' || g.model_name || ' มือสอง', 160),
      'HOLD',
      100,
      true
    from candidate_groups g
    where g.current_stock >= 1
       or g.historical_stock >= 2
    on conflict (category_id, brand_id, slug) do nothing
    returning id
  )
  select count(*)::int into created_models from inserted;

  for item in
    select distinct cl.product_id
    from public.commerce_listings cl
    join public.products p on p.id = cl.product_id
    where cl.series_id is not null
      and nullif(btrim(p.model), '') is not null
  loop
    perform private.sync_commerce_listing_taxonomy(item.product_id);
    remapped_listings := remapped_listings + 1;
  end loop;

  return jsonb_build_object(
    'created_models', created_models,
    'remapped_listings', remapped_listings,
    'ran_at', now()
  );
end;
$$;

revoke all on function private.sync_commerce_model_longtails() from public;
revoke all on function private.sync_commerce_model_longtails() from anon;
revoke all on function private.sync_commerce_model_longtails() from authenticated;

select private.sync_commerce_model_longtails();
select private.apply_commerce_seo_governance();

do $$
declare existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'commerce-seo-governance-15m'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end
$$;

select cron.schedule(
  'commerce-seo-governance-15m',
  '*/15 * * * *',
  'select private.sync_commerce_model_longtails(); select private.apply_commerce_seo_governance();'
);
