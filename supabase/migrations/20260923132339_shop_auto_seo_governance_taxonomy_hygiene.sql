-- AMPHON SHOP — stock-aware SEO governance + taxonomy hygiene + Series candidates
-- Production migration: 20260923132339_shop_auto_seo_governance_taxonomy_hygiene

update public.commerce_categories
set index_policy = 'HOLD', updated_at = now()
where key in ('desktop-pcs','smartphones','monitors','gaming-consoles')
  and index_policy not in ('NOINDEX','RETIRED');

update public.products
set brand='MSI', model='Modern 15 F1MXG-1290TH', title='MSI Modern 15 F1MXG-1290TH', updated_at=now()
where sku='AT-NB-2609-000041';

update public.products
set model='Modern 14', title='MSI Modern 14', updated_at=now()
where sku='AT-NB-2609-000014';

update public.products
set model='TUF Gaming F15', title='ASUS TUF Gaming F15', updated_at=now()
where sku='AT-NB-2609-000015';

update public.products
set title='Acer Aspire 3 A315-35', model='Aspire 3 A315-35', updated_at=now()
where sku='AT-IT-2609-000014';

update public.products set brand='Huawei', updated_at=now() where brand='HUAWEI';
update public.products set brand='Razer', updated_at=now() where brand='RAZER';

update public.products
set model=btrim(model), updated_at=now()
where model is not null and model <> btrim(model);

update public.products
set title='Apple MacBook Air M5 16/512GB', updated_at=now()
where sku='AT-IT-2609-000013';

update public.products
set subtype='ipad', model='iPad Gen 9', title='Apple iPad Gen 9', updated_at=now()
where sku='AT-TB-2609-000026';

update public.products
set subtype='ipad', model='iPad Gen 10', title='Apple iPad Gen 10', updated_at=now()
where sku in ('AT-TB-2609-000003','AT-TB-2609-000035');

update public.products
set subtype='ipad', model='iPad Pro M1', title='Apple iPad Pro M1', updated_at=now()
where sku='AT-TB-2609-000036';

update public.products
set brand='Custom PC', model='Core i5-12600K + RTX 3070 Ti',
    title='PC Gaming i5-12600K + RTX 3070 Ti', updated_at=now()
where sku='AT-PC-2609-000004';

update public.products
set brand='Custom PC', model='Core i7-11700K + RTX 3060',
    title='PC Gaming i7-11700K + RTX 3060', updated_at=now()
where sku='AT-PC-2609-000029';

update public.products
set brand='Custom PC', model='Ryzen 7 3800X + GTX 1060 3GB',
    title='PC Gaming Ryzen 7 3800X + GTX 1060 3GB', updated_at=now()
where sku='AT-PC-2609-000030';

update public.products
set brand='Custom PC', model='Ryzen 5 2600 + RX 580 8GB',
    title='PC Gaming Ryzen 5 2600 + RX 580 8GB', updated_at=now()
where sku='AT-PC-2609-000006';

update public.products
set specs=jsonb_set(specs,'{cpu}',to_jsonb('Intel Core i5-11400H'::text),true), updated_at=now()
where sku='AT-NB-2609-000044' and specs->>'cpu'='ntel Core i5-11400H';

update public.commerce_brands set name='Huawei', updated_at=now() where slug='huawei';
update public.commerce_brands set name='Razer', updated_at=now() where slug='razer';

do $$
declare item record;
begin
  for item in select product_id from public.commerce_listings loop
    perform private.sync_commerce_listing_taxonomy(item.product_id);
  end loop;
end
$$;

update public.commerce_brands b
set is_active=false, index_policy='RETIRED', updated_at=now()
where b.slug in ('mis','pc-i5-12600k-3070ti-ram16','pc-i7-11700k-3060','pc-r7-3800x-1060-3gb','pc')
  and not exists (select 1 from public.commerce_listings cl where cl.brand_id=b.id);

insert into public.commerce_series (
  category_id, brand_id, name, slug, seo_title, seo_description, seo_h1,
  intro_content, editorial_content, faq, primary_keyword, index_policy, sort_order, is_active
)
select c.id,b.id,x.name,x.slug,x.seo_title,x.seo_description,x.seo_h1,
       x.intro_content,x.editorial_content,x.faq,x.primary_keyword,'HOLD',x.sort_order,true
from (
  values
  ('gaming-laptops','asus','TUF Gaming','tuf-gaming',
   'ASUS TUF Gaming มือสอง พร้อมราคาและสเปกจริง | AMPHON TRADING',
   'เลือกซื้อ ASUS TUF Gaming มือสองจากสต๊อกจริง ดู CPU GPU RAM SSD จอ ราคา สภาพ ความร้อน รูปและตำหนิของแต่ละเครื่องก่อนซื้อ',
   'ASUS TUF Gaming มือสอง พร้อมราคาและสเปกจริง',
   'รวมโน้ตบุ๊ก ASUS TUF Gaming มือสองที่ร้านมีจริง ทั้ง F15 F17 A17 และรหัสรุ่นอื่นตามสต๊อก แต่ละเครื่องแสดง CPU การ์ดจอ RAM SSD หน้าจอ ราคา สภาพ แบต ที่ชาร์จ รูปและตำหนิเพื่อให้เทียบจากของจริงได้',
   'TUF Gaming แต่ละปีและแต่ละรหัสย่อยใช้ CPU การ์ดจอ ค่า TGP หน้าจอ และระบบระบายความร้อนไม่เหมือนกัน จึงควรดูรหัสรุ่นเต็มและสเปกของเครื่องจริงก่อนเทียบราคา รุ่นชื่อคล้ายกันอาจให้ RTX คนละระดับหรือจอคนละรีเฟรชเรตได้ นอกจากสเปกควรดูสภาพพัดลม บานพับ คีย์บอร์ด แบต ที่ชาร์จ และตำหนิที่ร้านระบุ เพราะเครื่องเกมมิ่งมักผ่านโหลดสูงกว่ารุ่นใช้งานทั่วไป',
   '[{"question":"ASUS TUF มือสองควรดูอะไรเป็นอันดับแรก?","answer":"เริ่มจาก GPU และ CPU ให้ตรงกับเกมหรือโปรแกรม แล้วดู RAM SSD รีเฟรชเรตจอ ความร้อน แบตและที่ชาร์จของเครื่องจริง"},{"question":"TUF F15 F17 และ A17 ต่างกันอย่างไร?","answer":"ขนาดจอ แพลตฟอร์ม CPU GPU และสเปกย่อยต่างกันตามปี ควรยึดรหัสรุ่นและหน้าสินค้าของเครื่องจริงเป็นหลัก"}]'::jsonb,
   'ASUS TUF Gaming มือสอง',10),
  ('gaming-laptops','hp','Victus','victus',
   'HP Victus มือสอง Gaming Laptop พร้อมราคา | AMPHON TRADING',
   'เลือกซื้อ HP Victus มือสองจากสต๊อกจริง พร้อม CPU GPU RAM SSD จอ ราคา สภาพ รูป ตำหนิ แบตและอุปกรณ์ของเครื่องจริง',
   'HP Victus มือสอง พร้อมดูสเปกและราคา',
   'รวม HP Victus มือสองที่พร้อมขายจริงในร้าน แสดงรหัสรุ่น CPU การ์ดจอ RAM SSD หน้าจอ ราคา สภาพ แบต ที่ชาร์จ รูปและตำหนิของเครื่องแต่ละชิ้น เพื่อให้เปรียบเทียบรุ่นย่อยได้โดยไม่อาศัยชื่อ Victus อย่างเดียว',
   'Victus มีหลายขนาดจอและหลายรหัสรุ่น สเปก CPU GPU และหน้าจอจึงต่างกันมากแม้อยู่ในซีรีส์เดียวกัน ก่อนซื้อควรเช็กรหัสรุ่นเต็ม การ์ดจอและ VRAM รีเฟรชเรตจอ RAM SSD รวมถึงสภาพระบบระบายความร้อน บานพับ แบตและที่ชาร์จจากเครื่องจริง การเทียบแบบนี้ช่วยให้เห็นต้นทุนอัปเกรดและความเหมาะกับเกมหรืองานกราฟิกชัดกว่าเทียบชื่อซีรีส์',
   '[{"question":"HP Victus มือสองควรเช็กจุดไหน?","answer":"ดู CPU GPU RAM SSD รีเฟรชเรตจอ ความร้อน บานพับ แบต ที่ชาร์จและตำหนิของเครื่องจริง"},{"question":"Victus รุ่นเดียวกันทำไมราคาต่างกัน?","answer":"สเปกย่อย GPU RAM SSD ปีเครื่อง สภาพแบต จอ บอดี้ อุปกรณ์และประกันอาจต่างกัน"}]'::jsonb,
   'HP Victus มือสอง',20),
  ('notebooks','acer','Aspire','aspire',
   'Acer Aspire มือสอง พร้อมราคาและสภาพจริง | AMPHON TRADING',
   'เลือกซื้อ Acer Aspire มือสองจากสต๊อกจริง ดูรุ่น CPU RAM SSD จอ ราคา แบต สภาพ รูปและตำหนิของแต่ละเครื่องก่อนซื้อ',
   'Acer Aspire มือสอง พร้อมดูราคาและสภาพ',
   'รวม Acer Aspire มือสองสำหรับเรียน ทำงาน และใช้งานทั่วไปจากสต๊อกจริง รุ่นย่อยอาจต่างกันทั้งขนาดจอ CPU RAM และ SSD จึงแสดงข้อมูลของเครื่องแต่ละชิ้นให้ดูพร้อมราคา สภาพ แบต ที่ชาร์จ รูปและตำหนิ',
   'Acer Aspire มีรหัสย่อยจำนวนมาก เช่น A314 และ A315 ซึ่งตัวเลขใกล้กันไม่ได้หมายความว่าสเปกเหมือนกัน ก่อนซื้อควรดู model code, CPU, RAM, SSD, ความละเอียดจอ และทางอัปเกรดของเครื่องจริง รวมถึงสภาพจอ คีย์บอร์ด บานพับ แบตและที่ชาร์จ หากเป็นเครื่องที่ใช้มาหลายปี สภาพของแต่ละชิ้นมีผลกับความคุ้มมากกว่าการดูชื่อ Aspire เพียงอย่างเดียว',
   '[{"question":"Acer Aspire มือสองควรเช็กรหัสรุ่นไหม?","answer":"ควรเช็ก เพราะ A314 A315 และรหัสย่อยแต่ละปีใช้ CPU RAM SSD และจอต่างกัน"},{"question":"Aspire มือสองเหมาะกับงานอะไร?","answer":"ขึ้นกับสเปกย่อย งานเอกสารและเรียนทั่วไปเน้น RAM SSD และแบต ส่วนงานหนักควรดู CPU GPU และระบบระบายความร้อนเพิ่ม"}]'::jsonb,
   'Acer Aspire มือสอง',30),
  ('notebooks','lenovo','IdeaPad','ideapad',
   'Lenovo IdeaPad มือสอง พร้อมราคาและสภาพจริง | AMPHON TRADING',
   'เลือกซื้อ Lenovo IdeaPad มือสองจากสต๊อกจริง ดู CPU RAM SSD จอ ราคา แบต สภาพ รูปและรหัสรุ่นของเครื่องจริงก่อนซื้อ',
   'Lenovo IdeaPad มือสอง พร้อมราคาและรูปจริง',
   'รวม Lenovo IdeaPad มือสองที่ร้านมีจริงสำหรับเรียนและทำงาน แต่ละเครื่องมีรหัสรุ่นและสเปกย่อยต่างกัน จึงแสดง CPU RAM SSD จอ ราคา แบต ที่ชาร์จ สภาพ รูปและตำหนิของชิ้นจริงเพื่อให้เทียบได้ง่าย',
   'IdeaPad มีรุ่นย่อยหลายขนาดและหลายแพลตฟอร์ม เช่น 14 นิ้วหรือ 15 นิ้ว รวมถึง CPU Intel และ AMD ในชื่อใกล้กัน ก่อนซื้อควรเช็กรหัสรุ่นเต็ม สเปก CPU RAM SSD ความละเอียดจอและการอัปเกรด พร้อมดูสภาพคีย์บอร์ด บานพับ แบตและที่ชาร์จจากรูปจริง การเทียบจากรหัสและสภาพของเครื่องจริงจะตรงกว่าการอิงชื่อ IdeaPad โดยรวม',
   '[{"question":"Lenovo IdeaPad มือสองควรดูรหัสรุ่นหรือไม่?","answer":"ควรดู เพราะชื่อ IdeaPad เดียวกันมีรหัสย่อยที่ใช้ CPU จอ RAM และทางอัปเกรดต่างกัน"},{"question":"IdeaPad มือสองสำหรับเรียนควรเน้นอะไร?","answer":"เลือก CPU RAM SSD ให้พอกับโปรแกรม แล้วค่อยดูน้ำหนัก ขนาดจอ แบตและสภาพจริงให้เหมาะกับการพกพา"}]'::jsonb,
   'Lenovo IdeaPad มือสอง',40),
  ('macbooks','apple','MacBook Air','macbook-air',
   'MacBook Air มือสอง พร้อมราคา สเปกและสภาพจริง | AMPHON TRADING',
   'รวม MacBook Air มือสองตามสต๊อกจริง ทั้ง Intel และ Apple Silicon พร้อม RAM SSD แบต รอบชาร์จ ราคา รูปและสภาพเครื่อง',
   'MacBook Air มือสอง พร้อมราคาและสภาพจริง',
   'รวม MacBook Air มือสองที่ร้านมีจริงตามช่วงเวลา ทั้งรุ่น Intel และ Apple Silicon โดยแสดงชิป RAM SSD ขนาดจอ สุขภาพแบต รอบชาร์จ ราคา ที่ชาร์จ รูปและตำหนิของแต่ละเครื่องเพื่อให้เปรียบเทียบก่อนซื้อได้',
   'MacBook Air ต่างปีอาจต่างทั้งสถาปัตยกรรมชิป ประสิทธิภาพ ความร้อน อายุแบต พอร์ตและซอฟต์แวร์ที่รองรับ ก่อนซื้อควรดูปี รุ่น ชิป RAM SSD สุขภาพแบตและรอบชาร์จ รวมถึงจอ คีย์บอร์ด บอดี้และอุปกรณ์ชาร์จของเครื่องจริง โดยเฉพาะการเทียบ Intel กับ Apple Silicon ควรเริ่มจากโปรแกรมที่จำเป็นต้องใช้ ไม่ควรตัดสินจากชื่อ Air หรือราคาเพียงอย่างเดียว',
   '[{"question":"MacBook Air มือสองควรดูอะไร?","answer":"ดูปี ชิป RAM SSD สุขภาพแบต รอบชาร์จ จอ คีย์บอร์ด พอร์ต บอดี้และที่ชาร์จของเครื่องจริง"},{"question":"MacBook Air Intel กับ Apple Silicon เลือกอย่างไร?","answer":"เริ่มจากโปรแกรมที่ต้องใช้และระยะเวลาที่ต้องการใช้งานต่อ แล้วเทียบประสิทธิภาพ แบต RAM SSD และงบของเครื่องจริง"}]'::jsonb,
   'MacBook Air มือสอง',50),
  ('macbooks','apple','MacBook Neo','macbook-neo',
   'MacBook Neo มือสอง พร้อมราคาและสภาพจริง | AMPHON TRADING',
   'ดู MacBook Neo มือสองจากสินค้าจริง พร้อมชิป RAM SSD แบต ราคา รูป อุปกรณ์และสภาพของแต่ละเครื่องก่อนซื้อ',
   'MacBook Neo มือสอง พร้อมดูราคาและสภาพ',
   'รวม MacBook Neo มือสองที่มีในสต๊อกจริงของร้าน พร้อมข้อมูลชิป RAM SSD จอ แบต รอบชาร์จ ราคา อุปกรณ์ รูปและตำหนิของแต่ละเครื่อง เพื่อให้ตรวจรายละเอียดก่อนยืนยันสั่งซื้อ',
   'สินค้ามือสองชื่อรุ่นเดียวกันอาจต่างกันที่ความจุ สภาพแบต รอบชาร์จ อุปกรณ์และรอยใช้งาน จึงควรยึดหน้าสินค้าของเครื่องจริงเป็นหลัก ตรวจชิป RAM SSD ขนาดจอ สุขภาพแบต คีย์บอร์ด พอร์ต บอดี้และที่ชาร์จให้ครบก่อนเทียบราคา หากมีรหัสรุ่นหรือข้อมูลประกันให้ใช้ประกอบการตัดสินใจด้วย',
   '[{"question":"MacBook Neo มือสองควรดูอะไร?","answer":"ดูชิป RAM SSD แบต รอบชาร์จ จอ คีย์บอร์ด พอร์ต อุปกรณ์และตำหนิของเครื่องจริง"},{"question":"เครื่องรุ่นเดียวกันทำไมราคาไม่เท่ากัน?","answer":"ความจุ สภาพแบต รอบชาร์จ รอยใช้งาน อุปกรณ์และประกันทำให้ราคาของแต่ละเครื่องต่างกันได้"}]'::jsonb,
   'MacBook Neo มือสอง',60),
  ('notebooks','msi','Modern','modern',
   'MSI Modern มือสอง พร้อมราคาและสภาพจริง | AMPHON TRADING',
   'เลือกซื้อ MSI Modern มือสองจากสินค้าจริง ดู CPU RAM SSD จอ ราคา แบต สภาพ รูปและตำหนิของแต่ละเครื่อง',
   'MSI Modern มือสอง พร้อมราคาและสเปกจริง',
   'รวม MSI Modern มือสองจากสต๊อกจริงสำหรับเรียนและทำงาน แต่ละเครื่องแสดง CPU RAM SSD หน้าจอ ราคา แบต ที่ชาร์จ สภาพ รูปและตำหนิ เพื่อให้เปรียบเทียบรุ่นย่อยได้ตรงกับงานและงบ',
   'MSI Modern มีหลายขนาดและหลายเจเนอเรชันของ CPU แม้ชื่อซีรีส์เหมือนกัน ก่อนซื้อควรดูรหัสรุ่น CPU RAM SSD จอ พอร์ตและทางอัปเกรด รวมถึงสภาพแบต คีย์บอร์ด บานพับและที่ชาร์จจากเครื่องจริง รุ่นที่เหมาะกับงานเอกสารอาจไม่จำเป็นต้องใช้สเปกสูง แต่ควรมี RAM และ SSD เพียงพอกับโปรแกรมที่ใช้พร้อมกัน',
   '[{"question":"MSI Modern มือสองเหมาะกับงานอะไร?","answer":"เหมาะกับงานเรียนและออฟฟิศตามสเปกย่อย ควรดู CPU RAM SSD และแบตให้พอกับโปรแกรมที่ใช้"},{"question":"ควรเช็กรหัสรุ่น MSI Modern ไหม?","answer":"ควรเช็ก เพราะขนาดจอ CPU RAM และพอร์ตแตกต่างกันตามรหัสและปีของรุ่น"}]'::jsonb,
   'MSI Modern มือสอง',70)
) as x(category_key,brand_slug,name,slug,seo_title,seo_description,seo_h1,intro_content,editorial_content,faq,primary_keyword,sort_order)
join public.commerce_categories c on c.key=x.category_key
join public.commerce_brands b on b.slug=x.brand_slug
on conflict (category_id,brand_id,slug) do update
set name=excluded.name, seo_title=excluded.seo_title, seo_description=excluded.seo_description,
    seo_h1=excluded.seo_h1, intro_content=excluded.intro_content,
    editorial_content=excluded.editorial_content, faq=excluded.faq,
    primary_keyword=excluded.primary_keyword, sort_order=excluded.sort_order,
    is_active=true, updated_at=now();

update public.commerce_listings cl set series_id=s.id, updated_at=now()
from public.products p
join public.commerce_categories c on c.key='gaming-laptops'
join public.commerce_brands b on b.slug='asus'
join public.commerce_series s on s.category_id=c.id and s.brand_id=b.id and s.slug='tuf-gaming'
where cl.product_id=p.id and cl.category_id=c.id and cl.brand_id=b.id and p.model ilike 'TUF Gaming%';

update public.commerce_listings cl set series_id=s.id, updated_at=now()
from public.products p
join public.commerce_categories c on c.key='gaming-laptops'
join public.commerce_brands b on b.slug='hp'
join public.commerce_series s on s.category_id=c.id and s.brand_id=b.id and s.slug='victus'
where cl.product_id=p.id and cl.category_id=c.id and cl.brand_id=b.id and p.model ilike 'Victus%';

update public.commerce_listings cl set series_id=s.id, updated_at=now()
from public.products p
join public.commerce_categories c on c.key='notebooks'
join public.commerce_brands b on b.slug='acer'
join public.commerce_series s on s.category_id=c.id and s.brand_id=b.id and s.slug='aspire'
where cl.product_id=p.id and cl.category_id=c.id and cl.brand_id=b.id and p.model ilike 'Aspire%';

update public.commerce_listings cl set series_id=s.id, updated_at=now()
from public.products p
join public.commerce_categories c on c.key='notebooks'
join public.commerce_brands b on b.slug='lenovo'
join public.commerce_series s on s.category_id=c.id and s.brand_id=b.id and s.slug='ideapad'
where cl.product_id=p.id and cl.category_id=c.id and cl.brand_id=b.id and p.model ilike 'IdeaPad%';

update public.commerce_listings cl set series_id=s.id, updated_at=now()
from public.products p
join public.commerce_categories c on c.key='macbooks'
join public.commerce_brands b on b.slug='apple'
join public.commerce_series s on s.category_id=c.id and s.brand_id=b.id and s.slug='macbook-air'
where cl.product_id=p.id and cl.category_id=c.id and cl.brand_id=b.id and p.model ilike 'MacBook Air%';

update public.commerce_listings cl set series_id=s.id, updated_at=now()
from public.products p
join public.commerce_categories c on c.key='macbooks'
join public.commerce_brands b on b.slug='apple'
join public.commerce_series s on s.category_id=c.id and s.brand_id=b.id and s.slug='macbook-neo'
where cl.product_id=p.id and cl.category_id=c.id and cl.brand_id=b.id and p.model='MacBook Neo';

update public.commerce_listings cl set series_id=s.id, updated_at=now()
from public.products p
join public.commerce_categories c on c.key='notebooks'
join public.commerce_brands b on b.slug='msi'
join public.commerce_series s on s.category_id=c.id and s.brand_id=b.id and s.slug='modern'
where cl.product_id=p.id and cl.category_id=c.id and cl.brand_id=b.id and p.model ilike 'Modern%';

create or replace function private.apply_commerce_seo_governance()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  category_changes integer := 0;
  brand_changes integer := 0;
  series_changes integer := 0;
  model_changes integer := 0;
begin
  with stats as (
    select c.id as category_id,
      count(*) filter (where pp.status='published' and p.status in ('published','reserved'))::int as current_stock,
      count(*) filter (where pp.status is not null)::int as historical_stock
    from public.commerce_categories c
    left join public.commerce_listings cl on cl.category_id=c.id
    left join public.products p on p.id=cl.product_id
    left join public.product_publications pp on pp.product_id=p.id and pp.channel='website'
    where c.key in ('desktop-pcs','smartphones','monitors','gaming-consoles')
    group by c.id
  )
  update public.commerce_categories c
     set index_policy=case when s.current_stock>=1 or s.historical_stock>=1 then 'INDEX' else 'HOLD' end,
         updated_at=now()
    from stats s
   where c.id=s.category_id
     and c.index_policy not in ('NOINDEX','RETIRED')
     and c.index_policy is distinct from case when s.current_stock>=1 or s.historical_stock>=1 then 'INDEX' else 'HOLD' end;
  get diagnostics category_changes = row_count;

  with stats as (
    select bp.id,c.index_policy as category_policy,
      count(*) filter (where pp.status='published' and p.status in ('published','reserved'))::int as current_stock,
      count(*) filter (where pp.status is not null)::int as historical_stock
    from public.commerce_brand_pages bp
    join public.commerce_categories c on c.id=bp.category_id
    left join public.commerce_listings cl on cl.category_id=bp.category_id and cl.brand_id=bp.brand_id
    left join public.products p on p.id=cl.product_id
    left join public.product_publications pp on pp.product_id=p.id and pp.channel='website'
    group by bp.id,c.index_policy
  ), desired as (
    select bp.id,
      case when s.category_policy='INDEX'
        and nullif(btrim(bp.seo_title),'') is not null
        and nullif(btrim(bp.seo_description),'') is not null
        and nullif(btrim(bp.seo_h1),'') is not null
        and coalesce(char_length(btrim(bp.intro_content)),0)>=120
        and (s.current_stock>=2 or (s.historical_stock>=3 and coalesce(char_length(btrim(bp.editorial_content)),0)>=400))
      then 'INDEX' else 'HOLD' end as desired_policy
    from public.commerce_brand_pages bp join stats s on s.id=bp.id
    where bp.index_policy not in ('NOINDEX','RETIRED')
  )
  update public.commerce_brand_pages bp set index_policy=d.desired_policy,updated_at=now()
  from desired d where bp.id=d.id and bp.index_policy is distinct from d.desired_policy;
  get diagnostics brand_changes = row_count;

  with stats as (
    select s.id,c.index_policy as category_policy,bp.index_policy as brand_policy,
      count(*) filter (where pp.status='published' and p.status in ('published','reserved'))::int as current_stock,
      count(*) filter (where pp.status is not null)::int as historical_stock
    from public.commerce_series s
    join public.commerce_categories c on c.id=s.category_id
    join public.commerce_brand_pages bp on bp.category_id=s.category_id and bp.brand_id=s.brand_id
    left join public.commerce_listings cl on cl.series_id=s.id
    left join public.products p on p.id=cl.product_id
    left join public.product_publications pp on pp.product_id=p.id and pp.channel='website'
    group by s.id,c.index_policy,bp.index_policy
  ), desired as (
    select s.id,
      case when st.category_policy='INDEX' and st.brand_policy='INDEX'
        and nullif(btrim(s.seo_title),'') is not null
        and nullif(btrim(s.seo_description),'') is not null
        and nullif(btrim(s.seo_h1),'') is not null
        and coalesce(char_length(btrim(s.intro_content)),0)>=120
        and (st.current_stock>=2 or (st.historical_stock>=3 and coalesce(char_length(btrim(s.editorial_content)),0)>=400))
      then 'INDEX' else 'HOLD' end as desired_policy
    from public.commerce_series s join stats st on st.id=s.id
    where s.index_policy not in ('NOINDEX','RETIRED')
  )
  update public.commerce_series s set index_policy=d.desired_policy,updated_at=now()
  from desired d where s.id=d.id and s.index_policy is distinct from d.desired_policy;
  get diagnostics series_changes = row_count;

  with stats as (
    select m.id,c.index_policy as category_policy,bp.index_policy as brand_policy,s.index_policy as series_policy,
      count(*) filter (where pp.status='published' and p.status in ('published','reserved'))::int as current_stock,
      count(*) filter (where pp.status is not null)::int as historical_stock
    from public.commerce_models m
    join public.commerce_categories c on c.id=m.category_id
    join public.commerce_brand_pages bp on bp.category_id=m.category_id and bp.brand_id=m.brand_id
    left join public.commerce_series s on s.id=m.series_id
    left join public.commerce_listings cl on cl.model_id=m.id
    left join public.products p on p.id=cl.product_id
    left join public.product_publications pp on pp.product_id=p.id and pp.channel='website'
    group by m.id,c.index_policy,bp.index_policy,s.index_policy
  ), desired as (
    select m.id,
      case when st.category_policy='INDEX' and st.brand_policy='INDEX' and st.series_policy='INDEX'
        and nullif(btrim(m.seo_title),'') is not null
        and nullif(btrim(m.seo_description),'') is not null
        and nullif(btrim(m.seo_h1),'') is not null
        and coalesce(char_length(btrim(m.intro_content)),0)>=120
        and (st.current_stock>=2 or (st.historical_stock>=3 and coalesce(char_length(btrim(m.seo_content)),0)>=400))
      then 'INDEX' else 'HOLD' end as desired_policy
    from public.commerce_models m join stats st on st.id=m.id
    where m.index_policy not in ('NOINDEX','RETIRED')
  )
  update public.commerce_models m set index_policy=d.desired_policy,updated_at=now()
  from desired d where m.id=d.id and m.index_policy is distinct from d.desired_policy;
  get diagnostics model_changes = row_count;

  return jsonb_build_object(
    'category_changes',category_changes,'brand_changes',brand_changes,
    'series_changes',series_changes,'model_changes',model_changes,'ran_at',now()
  );
end;
$$;

revoke all on function private.apply_commerce_seo_governance() from public;
revoke all on function private.apply_commerce_seo_governance() from anon;
revoke all on function private.apply_commerce_seo_governance() from authenticated;

select private.apply_commerce_seo_governance();

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='commerce-seo-governance-15m' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end
$$;

select cron.schedule(
  'commerce-seo-governance-15m',
  '*/15 * * * *',
  'select private.apply_commerce_seo_governance();'
);
