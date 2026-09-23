-- SHOP Tier-2 keyword expansion from live stock.
-- Mirrors production migration 20260923014050_shop_tier2_keyword_expansion.

insert into public.commerce_categories (
  key, name_th, name_en, slug,
  source_category, source_subtype, source_query,
  is_default_source, seo_title, seo_description, intro_content,
  index_policy, sort_order, is_active
)
values (
  'gaming-laptops',
  'โน้ตบุ๊กเกมมิ่งมือสอง',
  'Used Gaming Laptops',
  'gaming-laptops',
  'notebook',
  'gaming',
  null,
  false,
  'โน้ตบุ๊กเกมมิ่งมือสอง Gaming Laptop พร้อมราคา | AMPHON TRADING',
  'เลือกซื้อโน้ตบุ๊กเกมมิ่งมือสองจากสินค้าจริง ดู CPU การ์ดจอ RAM SSD จอ ราคา สภาพ รูปและตำหนิก่อนสั่งซื้อ',
  'รวม Gaming Laptop มือสองจากสต๊อกจริงของ AMPHON TRADING แยกจากโน้ตบุ๊กใช้งานทั่วไป เพื่อให้เทียบ CPU การ์ดจอ RAM SSD หน้าจอ ราคา สภาพ และรูปของแต่ละเครื่องได้ตรงกับความต้องการมากขึ้น',
  'INDEX',
  25,
  true
)
on conflict (key) do update
set name_th = excluded.name_th,
    name_en = excluded.name_en,
    slug = excluded.slug,
    source_category = excluded.source_category,
    source_subtype = excluded.source_subtype,
    source_query = excluded.source_query,
    is_default_source = excluded.is_default_source,
    seo_title = excluded.seo_title,
    seo_description = excluded.seo_description,
    intro_content = excluded.intro_content,
    index_policy = excluded.index_policy,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();

update public.commerce_categories
set source_category = 'notebook',
    source_subtype = 'macbook',
    source_query = 'MacBook',
    index_policy = 'INDEX',
    updated_at = now()
where key = 'macbooks';

update public.commerce_categories
set source_category = 'pc',
    source_subtype = 'gaming',
    index_policy = 'INDEX',
    updated_at = now()
where key = 'gaming-pcs';

do $$
declare
  item record;
begin
  for item in select product_id from public.commerce_listings loop
    perform private.sync_commerce_listing_taxonomy(item.product_id);
  end loop;
end
$$;

update public.commerce_brand_pages bp
set seo_title = 'โน้ตบุ๊ก Acer มือสอง สภาพจริง พร้อมราคา | AMPHON TRADING',
    seo_description = 'เลือกซื้อโน้ตบุ๊ก Acer มือสองจากสินค้าจริง ดูรุ่น Aspire และรุ่นที่มีในสต๊อก พร้อม CPU RAM SSD ราคา สภาพ แบต รูปและตำหนิก่อนซื้อ',
    seo_h1 = 'โน้ตบุ๊ก Acer มือสอง พร้อมดูราคาและสภาพ',
    primary_keyword = 'โน้ตบุ๊ก Acer มือสอง',
    intro_content = 'รวมโน้ตบุ๊ก Acer มือสองที่ร้านมีอยู่จริงในหมวดใช้งานทั่วไป เช่นตระกูล Aspire ตามสต๊อกที่เข้ามาแต่ละช่วง สามารถเทียบ CPU RAM SSD ขนาดจอ แบต ราคา สภาพ และรูปของเครื่องจริงก่อนเลือกซื้อได้จากหน้าเดียว',
    editorial_content = 'Acer รุ่นชื่อใกล้กันอาจใช้ CPU RAM หรือ SSD ต่างกัน จึงควรเปิดหน้าสินค้าแต่ละเครื่องแล้วดูรหัสรุ่น สเปก สภาพจอ แบต ที่ชาร์จและตำหนิจริงก่อนเทียบราคา',
    faq = jsonb_build_array(
      jsonb_build_object('question','ซื้อโน้ตบุ๊ก Acer มือสองควรดูอะไร?','answer','ดูรหัสรุ่น CPU RAM SSD จอ แบต ที่ชาร์จ สภาพบอดี้และตำหนิของเครื่องจริง เพราะ Aspire แต่ละรุ่นย่อยใช้สเปกต่างกัน'),
      jsonb_build_object('question','Acer Aspire มือสองรุ่นเดียวกันทำไมราคาต่างกัน?','answer','ราคาอาจต่างจากสเปกย่อย ความจุ RAM หรือ SSD สภาพแบต จอ บอดี้ อุปกรณ์และตำหนิของเครื่องแต่ละชิ้น'),
      jsonb_build_object('question','เลือก Acer มือสองสำหรับเรียนหรือทำงานอย่างไร?','answer','เริ่มจากโปรแกรมที่ใช้ แล้วเลือก CPU RAM และ SSD ให้พอ จากนั้นค่อยเทียบขนาดจอ น้ำหนัก แบตและสภาพจริงให้เหมาะกับงบ')
    ),
    index_policy = 'INDEX',
    updated_at = now()
from public.commerce_categories c, public.commerce_brands b
where bp.category_id = c.id
  and bp.brand_id = b.id
  and c.key = 'notebooks'
  and b.slug = 'acer'
  and exists (
    select 1 from public.commerce_evergreen_page_v v
    where v.entity_id = bp.id and v.page_type = 'BRAND' and v.current_stock_count >= 2
  );

update public.commerce_brand_pages bp
set seo_title = 'โน้ตบุ๊ก Lenovo มือสอง สภาพจริง พร้อมราคา | AMPHON TRADING',
    seo_description = 'เลือกซื้อโน้ตบุ๊ก Lenovo มือสองจากสต๊อกจริง ดู IdeaPad และรุ่นที่พร้อมขาย พร้อม CPU RAM SSD ราคา สภาพ แบต รูปและตำหนิก่อนซื้อ',
    seo_h1 = 'โน้ตบุ๊ก Lenovo มือสอง พร้อมราคาและรูปจริง',
    primary_keyword = 'โน้ตบุ๊ก Lenovo มือสอง',
    intro_content = 'รวมโน้ตบุ๊ก Lenovo มือสองสำหรับเรียนและทำงานจากสต๊อกจริงของร้าน เช่น IdeaPad ตามรุ่นที่มีในช่วงนั้น แต่ละเครื่องแสดง CPU RAM SSD หน้าจอ แบต ราคา สภาพ รูปจริง และตำหนิเพื่อให้เทียบได้จากของชิ้นจริง',
    editorial_content = 'Lenovo มีรุ่นย่อยจำนวนมาก ชื่อ IdeaPad เดียวกันอาจต่างทั้ง CPU จอและทางอัปเกรด ตรวจรหัสรุ่น สเปก แบตและสภาพเครื่องแต่ละชิ้นก่อนตัดสินใจ',
    faq = jsonb_build_array(
      jsonb_build_object('question','ซื้อโน้ตบุ๊ก Lenovo มือสองควรเช็กรุ่นย่อยไหม?','answer','ควรเช็ก เพราะ IdeaPad และรุ่นอื่นมีรหัสย่อยหลายแบบที่ใช้ CPU RAM SSD และหน้าจอต่างกัน แม้ชื่อหลักจะคล้ายกัน'),
      jsonb_build_object('question','Lenovo มือสองสำหรับงานทั่วไปควรมี RAM เท่าไร?','answer','ขึ้นกับโปรแกรมที่ใช้ งานเอกสารและเว็บทั่วไปควรเลือก RAM ให้เหลือพอสำหรับหลายโปรแกรม และ SSD จะช่วยให้เปิดเครื่องและโปรแกรมได้ลื่นขึ้น'),
      jsonb_build_object('question','ควรดูอะไรจากรูป Lenovo มือสอง?','answer','ดูจอ คีย์บอร์ด บานพับ ฝาหลัง ขอบเครื่อง พอร์ต ที่ชาร์จและรูปตำหนิ พร้อมอ่านข้อมูลแบตของเครื่องนั้นถ้ามี')
    ),
    index_policy = 'INDEX',
    updated_at = now()
from public.commerce_categories c, public.commerce_brands b
where bp.category_id = c.id
  and bp.brand_id = b.id
  and c.key = 'notebooks'
  and b.slug = 'lenovo'
  and exists (
    select 1 from public.commerce_evergreen_page_v v
    where v.entity_id = bp.id and v.page_type = 'BRAND' and v.current_stock_count >= 2
  );

update public.commerce_brand_pages bp
set seo_title = 'โน้ตบุ๊กเกมมิ่ง ASUS มือสอง TUF พร้อมราคา | AMPHON TRADING',
    seo_description = 'เลือกซื้อโน้ตบุ๊กเกมมิ่ง ASUS มือสองจากสต๊อกจริง เช่น TUF Gaming พร้อม CPU GPU RAM SSD จอ ราคา สภาพ รูปและตำหนิของเครื่องจริง',
    seo_h1 = 'โน้ตบุ๊กเกมมิ่ง ASUS มือสอง พร้อมดูสเปกและราคา',
    primary_keyword = 'โน้ตบุ๊กเกมมิ่ง ASUS มือสอง',
    intro_content = 'รวม Gaming Laptop ASUS มือสองที่ร้านมีจริง โดยเฉพาะตระกูล TUF ตามสต๊อกแต่ละช่วง สามารถเทียบ CPU การ์ดจอ VRAM RAM SSD รีเฟรชเรตหน้าจอ แบต ราคา สภาพและรูปเครื่องจริงก่อนเลือกซื้อ',
    editorial_content = 'ASUS TUF ชื่อรุ่นใกล้กันแต่ GPU และจออาจต่างกันมาก ให้ดูสเปกเต็ม อุณหภูมิ สภาพพัดลม บานพับ คีย์บอร์ด แบตและที่ชาร์จของเครื่องจริงเป็นหลัก',
    faq = jsonb_build_array(
      jsonb_build_object('question','ซื้อ ASUS TUF มือสองควรดูการ์ดจออย่างไร?','answer','ดูรุ่น GPU และ VRAM ให้ตรงกับเกมหรือโปรแกรม แล้วเช็ก CPU RAM และจอว่าทำงานสมดุลกับการ์ดจอหรือไม่'),
      jsonb_build_object('question','ASUS Gaming Laptop มือสองควรเช็กความร้อนไหม?','answer','ควรเช็กสภาพพัดลม ช่องระบายความร้อนและอุณหภูมิเมื่อใช้งานหนัก เพราะมีผลกับประสิทธิภาพและความเสถียร'),
      jsonb_build_object('question','TUF F15 F17 และ A17 มือสองเลือกอย่างไร?','answer','ดูขนาดจอ CPU GPU RAM SSD และน้ำหนักของเครื่องจริงก่อน ชื่อซีรีส์อย่างเดียวไม่พอเพราะแต่ละปีและสเปกย่อยแตกต่างกัน')
    ),
    index_policy = 'INDEX',
    updated_at = now()
from public.commerce_categories c, public.commerce_brands b
where bp.category_id = c.id
  and bp.brand_id = b.id
  and c.key = 'gaming-laptops'
  and b.slug = 'asus'
  and exists (
    select 1 from public.commerce_evergreen_page_v v
    where v.entity_id = bp.id and v.page_type = 'BRAND' and v.current_stock_count >= 2
  );

update public.commerce_brand_pages bp
set seo_title = 'โน้ตบุ๊กเกมมิ่ง HP มือสอง Victus พร้อมราคา | AMPHON TRADING',
    seo_description = 'เลือกซื้อโน้ตบุ๊กเกมมิ่ง HP มือสองจากสต๊อกจริง เช่น Victus พร้อม CPU GPU RAM SSD จอ ราคา สภาพ รูปและตำหนิของเครื่องก่อนซื้อ',
    seo_h1 = 'โน้ตบุ๊กเกมมิ่ง HP มือสอง พร้อมราคาและสเปกจริง',
    primary_keyword = 'โน้ตบุ๊กเกมมิ่ง HP มือสอง',
    intro_content = 'รวม Gaming Laptop HP มือสองที่ร้านมีจริง เช่นตระกูล Victus ตามสต๊อกในแต่ละช่วง โดยแสดง CPU การ์ดจอ RAM SSD หน้าจอ แบต ราคา สภาพ รูปและตำหนิของเครื่องแต่ละชิ้นเพื่อให้เทียบก่อนซื้อได้ชัดเจน',
    editorial_content = 'HP Victus แต่ละรุ่นย่อยใช้ CPU GPU และจอไม่เหมือนกัน ควรเช็กรหัสรุ่น สเปกเต็ม ความร้อน บานพับ แบตและที่ชาร์จของเครื่องที่ลงขายจริง',
    faq = jsonb_build_array(
      jsonb_build_object('question','ซื้อ HP Victus มือสองควรดูอะไร?','answer','ดู CPU GPU RAM SSD รีเฟรชเรตจอ อุณหภูมิ แบต บานพับ ที่ชาร์จและตำหนิของเครื่องจริง ไม่ควรเทียบจากชื่อ Victus อย่างเดียว'),
      jsonb_build_object('question','HP Gaming Laptop มือสองเหมาะกับงานกราฟิกไหม?','answer','ขึ้นกับ GPU VRAM CPU และ RAM ของรุ่นย่อย ควรเทียบกับสเปกที่โปรแกรมต้องการก่อนเลือกเครื่อง'),
      jsonb_build_object('question','Victus มือสองรุ่นเดียวกันราคาทำไมต่างกัน?','answer','อาจต่างจากปีและสเปกย่อย GPU RAM SSD สภาพแบต จอ บอดี้ อุปกรณ์และประกันของเครื่องแต่ละชิ้น')
    ),
    index_policy = 'INDEX',
    updated_at = now()
from public.commerce_categories c, public.commerce_brands b
where bp.category_id = c.id
  and bp.brand_id = b.id
  and c.key = 'gaming-laptops'
  and b.slug = 'hp'
  and exists (
    select 1 from public.commerce_evergreen_page_v v
    where v.entity_id = bp.id and v.page_type = 'BRAND' and v.current_stock_count >= 2
  );
