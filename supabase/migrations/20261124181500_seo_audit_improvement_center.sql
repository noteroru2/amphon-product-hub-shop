-- AMPHON SEO Audit & AI Improvement Center V1.
-- Audited PLAN and owner/admin triage only: no automated crawl, AI inference, source edit, merge or deploy.
-- Source: reviewed SEO Audit #177 dated 2026-11-24; active websites only.
create table if not exists public.commerce_seo_audit_catalog (
  code text primary key check (code ~ '^P[012]-[0-9]{2}$'),
  site_id text references public.commerce_seo_sites(id),
  category text not null check(category in ('CONTENT','UX_UI','TECHNICAL','AEO_GEO','MEASUREMENT')),
  priority text not null check(priority in ('P0','P1','P2')),
  title text not null check (length(title) between 12 and 220),
  target_page text,
  focus_query text,
  finding text not null check (length(finding) between 16 and 1800),
  recommendation text not null check(length(recommendation) between 20 and 2200),
  acceptance text not null check(length(acceptance) between 20 and 1800),
  evidence_kind text not null default 'GSC_AND_EDITORIAL_SAMPLE'
    check(evidence_kind in ('GSC_AND_EDITORIAL_SAMPLE','PRODUCTION_INSPECTION','PROCESS_GAP','LAB_ONLY')),
  source_issue_url text not null default 'https://github.com/noteroru2/amphon-product-hub-shop/issues/177',
  source_as_of date not null default '2026-11-24',
  check(target_page is null or target_page ~ '^https://[^[:space:]]+$')
);
create table if not exists public.commerce_seo_audit_runs (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  requested_by uuid not null references auth.users(id),
  site_filter text not null default 'ALL',
  category_filter text not null default 'ALL'
    check(category_filter in ('ALL','CONTENT','UX_UI','TECHNICAL','AEO_GEO','MEASUREMENT')),
  priority_filter text not null default 'ALL' check(priority_filter in ('ALL','P0','P1','P2')),
  evidence_label text not null default 'AUDIT_01_20261124',
  source_issue_url text not null default 'https://github.com/noteroru2/amphon-product-hub-shop/issues/177',
  source_as_of date not null default '2026-11-24',
  gsc_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  check(site_filter = 'ALL' or site_filter ~ '^[a-z][a-z0-9_]{1,40}$'),
  check(jsonb_typeof(gsc_snapshot) = 'array')
);
create table if not exists public.commerce_seo_audit_tasks (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.commerce_seo_audit_runs(id) on delete cascade,
  template_code text not null references public.commerce_seo_audit_catalog(code),
  site_id text references public.commerce_seo_sites(id),
  category text not null check(category in ('CONTENT','UX_UI','TECHNICAL','AEO_GEO','MEASUREMENT')),
  priority text not null check(priority in ('P0','P1','P2')),
  title text not null,
  target_page text,
  focus_query text,
  finding text not null,
  recommendation text not null,
  acceptance text not null,
  evidence_kind text not null,
  status text not null default 'OPEN' check(status in ('OPEN','BRIEF_READY','DISMISSED')),
  review_note text not null default '' check(length(review_note) <= 1200),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(run_id,template_code),
  check((status = 'OPEN' and reviewed_at is null) or status <> 'OPEN' or reviewed_at is not null)
);
create index if not exists seo_audit_runs_created_idx on public.commerce_seo_audit_runs(created_at desc);
create index if not exists seo_audit_tasks_run_priority_idx on public.commerce_seo_audit_tasks(run_id,priority,status);
alter table public.commerce_seo_audit_catalog enable row level security;
alter table public.commerce_seo_audit_runs enable row level security;
alter table public.commerce_seo_audit_tasks enable row level security;
revoke all on public.commerce_seo_audit_catalog, public.commerce_seo_audit_runs, public.commerce_seo_audit_tasks from public,anon,authenticated;
grant select on public.commerce_seo_audit_catalog,public.commerce_seo_audit_runs,public.commerce_seo_audit_tasks to authenticated;
grant usage,select on sequence public.commerce_seo_audit_tasks_id_seq to service_role;
drop policy if exists seo_audit_catalog_read on public.commerce_seo_audit_catalog;
drop policy if exists seo_audit_runs_read on public.commerce_seo_audit_runs;
drop policy if exists seo_audit_tasks_read on public.commerce_seo_audit_tasks;
create policy seo_audit_catalog_read on public.commerce_seo_audit_catalog for select to authenticated
using ((select public.current_user_role()) in ('owner','admin'));
create policy seo_audit_runs_read on public.commerce_seo_audit_runs for select to authenticated
using ((select public.current_user_role()) in ('owner','admin'));
create policy seo_audit_tasks_read on public.commerce_seo_audit_tasks for select to authenticated
using ((select public.current_user_role()) in ('owner','admin'));
-- No INSERT/UPDATE/DELETE grants to authenticated; only guarded RPC below mutates.
-- Service-role owns controlled catalog seed, reporting/import, and administrative migrations.

insert into public.commerce_seo_audit_catalog
(code,site_id,category,priority,title,target_page,focus_query,finding,recommendation,acceptance,evidence_kind)
values
('P0-01','amphon','CONTENT','P0','ยกระดับหน้าแม่ Notebook / MacBook / iPad',
'https://amphon.co.th/บริการ/รับซื้อโน๊ตบุ๊ค','รับซื้อโน๊ตบุ๊ค',
'GSC หน้าโน๊ตบุ๊คยังมีพื้นที่ขยับในคำซื้อเข้าหลัก และ MacBook/iPad ยังมีอันดับเฉลี่ยระดับหน้า 2–3; หน้าเว็บมีข้อมูลขั้นตอนแล้วแต่ยังต้องยืนยันเคสจริง',
'ตรวจเจตนาแต่ละ URL เพิ่มเช็กลิสต์รุ่น/รูป/สภาพและตัวอย่างตรวจจริงที่อนุมัติแล้ว แยกโน๊ตบุ๊ค Gaming/Business, MacBook Air/Pro M-series, iPad ตามรุ่น',
'รักษา URL/canonical, ไม่แต่งราคา/รูป/สาขา, review หลักฐานจริง, QA หน้า+LINE และวัด GSC Final แยกหน้า 7/14/28 วัน',
'GSC_AND_EDITORIAL_SAMPLE'),
('P0-02','amphon','CONTENT','P0','ยกระดับหน้าคอมพิวเตอร์และงานคอมบริษัท',
'https://amphon.co.th/บริการ/รับซื้อคอมพิวเตอร์','รับซื้อคอมพิวเตอร์',
'หน้า PC มี Impressions แต่ CTR ยังมีโอกาสปรับ; มีบริการ PC, Gaming และคอมล็อตจริงที่ควรอธิบายให้ต่างกัน',
'จัดขั้นตอนประเมิน CPU/GPU/PSU และงานองค์กร มีแบบรายการ Asset, แยก Tested/Untested และเครื่องไม่มี RAM/SSD อธิบายการขนส่งและเอกสารจริง',
'Title/Meta ตรงเนื้อหา, ไม่อ้างลบข้อมูลถาวรเกินจริง, ผ่าน QA canonical/โครงสร้าง/CTA และเทียบ GSC Final',
'GSC_AND_EDITORIAL_SAMPLE'),
('P0-03','amphon','CONTENT','P0','เชื่อมบทความดูรุ่น iPad ไปหน้ารับซื้อ',
'https://amphon.co.th/blog/วิธีเช็กรุ่น-ipad-ว่าเป็น-gen-ไหน','ดูรุ่น ipad',
'บทความ iPad เป็นหนึ่งในหน้าที่ได้ Impressions/Clicks สูงที่สุด; มีลิงก์ติดต่ออยู่แล้วแต่ยังไม่ผ่าน UX CTA test',
'รักษา URL และตารางเลข Axxxx เพิ่ม CTA แบบไม่รบกวนการอ่านไปหน้า iPad buyback ตรวจความถูกต้องโมเดลและลิงก์',
'ไม่เปลี่ยน URL หรือ schema โดยไม่จำเป็น, ผ่าน regression และตรวจ CTA จากบทความถึงหน้าเป้าหมายจริง',
'GSC_AND_EDITORIAL_SAMPLE'),
('P0-04','shop','UX_UI','P0','Commerce Product UX / Search / Inventory Schema',
'https://shop.amphon.co.th/notebooks/',null,
'Shop มี CTR ต่ำและหมวดพร้อมขายจริงแต่สินค้าเปลี่ยนเร็ว; Mobile Speed Index Lab ต้องตรวจ perceived loading',
'ปรับการค้นหา/กรอง SKU บนมือถือ, รูปสภาพ/ตำหนิ/ราคา/สต๊อกจริง, LINE ตามสินค้าแต่ละชิ้น และ Product Offer ที่ตรงฐานข้อมูล',
'ทดสอบ 360/390/428px, สินค้าที่ไม่มีสต๊อกไม่ถูกแสดงพร้อมขาย, ไม่มี structured data ราคาเท็จ และไม่หลอกว่าคลิกคือยอดขาย',
'GSC_AND_EDITORIAL_SAMPLE'),
('P0-05',null,'TECHNICAL','P0','ควบคุมคีย์เวิร์ดและป้องกันเนื้อหาซ้ำทั้งเครือ',
null,null,
'เว็บ 13 แห่งมีบริการคล้ายกันและหน้าแม่หลายโดเมน; ยังไม่ตรวจ editorial full crawl ทุก URL',
'ใช้ Keyword Ownership ที่อนุมัติแล้ว แยก intent BUY_FROM_STORE/SELL_TO_STORE และตรวจ thin/template จังหวัดตาม GSC โดยไม่ตัดหน้าแบบเหมา',
'บันทึก URL ownership เป็นหลักฐานก่อนเปลี่ยน canonical/noindex/redirect และห้ามสร้างสาขาที่ไม่มีจริง',
'PROCESS_GAP'),
('P0-06',null,'MEASUREMENT','P0','เชื่อมคลิก LINE กับดีลซื้อเข้าและกำไรจริง',
null,null,
'มี CTA clicks รวม 1188 ครั้งจากเว็บไซต์ที่ติดเครื่องมือ แต่ยังไม่มี verified purchase/sales attribution',
'วัด site/page/source คลิก→ลีดที่เจ้าของยืนยัน→เครื่องซื้อเข้า→ขายออก→กำไรขั้นต้นจริง แยก unknown channels',
'ห้ามสมมติ conversion หรือผูก GSC anonymous query กับลูกค้า; ต้องมีหลักฐานธุรกรรมและ consent ที่เหมาะสม',
'PROCESS_GAP'),
('P0-07',null,'TECHNICAL','P0','ตรวจข้อเท็จจริงธุรกิจและหลักฐานก่อนเผยแพร่',
null,null,
'ร้านจริงอยู่ที่อุบล เวลา จันทร์–เสาร์ 09:00–19:00; ต่างจังหวัดต้องนัดหมาย; Repo เว็บไอโฟนยังจับ SHA Production ไม่ได้',
'ตรวจชื่อบริษัท หน้าร้าน วันเวลา LINE เงื่อนไขจ่ายเงิน/รับเครื่อง รูปเคสจริง และ Source production mapping ทุกไซต์',
'ห้ามอ้างสาขา/ราคา/การลบข้อมูล/ประสบการณ์ที่พิสูจน์ไม่ได้; เว็บ iPhone หยุดก่อนตรวจ SHA',
'PROCESS_GAP'),
('P1-01','camera','CONTENT','P1','บทความเฉพาะทางกล้องและเลนส์',
null,'รับซื้อกล้องมือสอง',
'เว็บไซต์กล้องมีทราฟฟิกจากความรู้ DSLR, Compact และคำรับซื้อกล้องใกล้ฉัน',
'จัดเนื้อหาทดสอบ shutter count, เชื้อราเลนส์ แบต/อุปกรณ์ รุ่นจริง และเคสที่อนุมัติแล้ว',
'เชื่อมบทความกับบริการถูกหมวดและไม่มีภาพเคสที่ไม่มีหลักฐาน','GSC_AND_EDITORIAL_SAMPLE'),
('P1-02',null,'CONTENT','P1','ปรับเนื้อหาภูมิภาคและวิธีนัดรับตามจริง',
null,null,
'เว็บขอนแก่น/โคราช/อุบลมีคำค้นท้องถิ่น; ต้องไม่อ้างสาขาในจังหวัดที่ไม่มีหน้าร้าน',
'เพิ่มข้อมูลขนส่ง/นัดรับและข้อจำกัดบริการจริง เลือกหน้าอันดับมีโอกาสก่อน ไม่ขยาย template จังหวัดทันที',
'ทุกหน้าไม่อ้างจุด walk-in เท็จ และ URL ที่มีทราฟฟิกต้องผ่าน GSC impact review','GSC_AND_EDITORIAL_SAMPLE'),
('P1-03','webuy','CONTENT','P1','WEBUY Server/Network และส่งรูปประเมิน',
'https://webuy.in.th/services/buy-used-server/','รับซื้อ server',
'GSC พบโอกาสรับซื้อ server และ workflow ส่งข้อมูลต้องต่างจากหน้าแม่ AMPHON',
'ปรับเช็กลิสต์ B2B ระดับองค์กร ภาพ/spec/tested/untested และ LINE intake ตามขั้นตอนจริง',
'ไม่มีเนื้อหาซ้ำหน้าแม่โดยไร้คุณค่า; ตรวจหน้า CTA, GSC Final และที่มาหลักฐาน','GSC_AND_EDITORIAL_SAMPLE'),
('P1-04',null,'CONTENT','P1','Editorial audit เว็บรองและบทความซ้ำ',
null,null,
'AMPHONTD, Winner, Notebook, BuyHub, เรารับซื้อ มีหัวข้อซ้ำกับหน้ารับซื้อระดับประเทศ',
'จัดกลุ่มบทความสั้น/ซ้ำ เพิ่มข้อมูลเด่นเฉพาะเว็บ และหลักฐานความเชี่ยวชาญแทนการเพิ่มหน้าจำนวนมาก',
'เก็บหน้าเดิมที่มี click/impression จริง; ตรวจ canonical/redirect ก่อน consolidation','PROCESS_GAP'),
('P1-05',null,'TECHNICAL','P1','ตรวจสถานะ Index และ Canonical รายหน้า',
null,null,
'มี noindex ตามนโยบายและเคยพบสถานะ GPU index ไม่ตรงกันระหว่างรอบตรวจ; 404 test ถูกนับซ้ำ',
'ตรวจ sitemap, 301, canonical, robots, บทความและหมวด filter ก่อนตัดสินใจปล่อย index',
'ไม่มี regression ของ URL/SEO winner; แยก intentionally noindex จาก error จริง','PRODUCTION_INSPECTION'),
('P1-06',null,'UX_UI','P1','Mobile UX 360/390/428 และ flow สั่งงาน',
null,null,
'ยังไม่ได้รัน interactive browser real-device test; หน้าเว็บส่วนหนึ่งอ่านเนื้อหาได้แต่ยังไม่พิสูจน์ tap/keyboard/LINE',
'ทดสอบ navigation, sticky CTA, search/filter, focus, readability, product-to-LINE, ไม่ส่งข้อความหรือสั่งซื้อจริงในการ QA',
'มี screenshots/test receipts และตรวจ keyboard/accessibility ก่อนถือว่าผ่าน','PROCESS_GAP'),
('P1-07',null,'TECHNICAL','P1','Core Web Vitals จาก Field RUM',
null,null,
'PageSpeed Lab mobile LCP ตัวอย่างดี แต่ Shop Speed Index 5.5s; ยังไม่มี CrUX p75 INP/CLS ยืนยัน',
'อ่านข้อมูล Field p75 และตรวจการโหลดภาพ/JS/ฟอนต์ตามหน้าที่มีผู้ใช้จริง',
'เปรียบเทียบ LCP/INP/CLS กับ Field baseline ไม่อ้างผ่านจาก Lighthouse Lab อย่างเดียว','LAB_ONLY'),
('P1-08',null,'TECHNICAL','P1','ตรวจ JSON-LD Schema / Breadcrumb / Product',
null,null,
'Schema ต้องตรงสินค้าจริง พื้นที่จริง และเงื่อนไข; ยังไม่ได้ตรวจทุกหน้าราย URL',
'ตรวจ LocalBusiness ที่อุบล, Service Area ที่ไม่มีสาขา, Breadcrumb, Shop Product/Offer และราคาสต๊อก',
'ตรวจ Rich Results Test ที่ URL สำคัญ ไม่รับประกัน FAQ rich result','PROCESS_GAP'),
('P1-09','amphon','CONTENT','P1','ทดลองปรับ CTR จากคำคอม/แรม/คอมประกอบ',
null,'รับซื้อคอมพิวเตอร์',
'GSC พบคำแสดงผลแต่คลิกต่ำเช่น PC, RAM, assembled PC; ต้องตรวจ intent ก่อนแก้ Title',
'สร้าง Meta candidate กับหลักฐานรูปแบบคำค้นและหน้าเป้าหมายที่ถูกต้อง วัดก่อน/หลังเฉพาะ URL',
'ไม่สรุป uplift จากข้อมูลไม่ครบช่วง/อันดับผันผวน ใช้ Google Final 7/14/28 วัน','GSC_AND_EDITORIAL_SAMPLE'),
('P1-10',null,'CONTENT','P1','Hub Evidence Pipeline ก่อนใช้เคสจริง',
null,null,
'ร้านมีระบบหลักฐานซื้อ/ขาย แต่ยังต้องมีการตรวจยืนยันและปกปิดข้อมูลลูกค้าก่อนใช้บนเว็บ',
'กำหนด reviewer ข้อเท็จจริง/รูป/ราคา/วันที่ และสิทธิ์เผยแพร่ พร้อมข้อความ caveat แต่ละสินค้า',
'มีหลักฐาน owner-approved และไม่เปิดเผย PII, serial, เอกสารลูกค้าโดยไม่จำเป็น','PROCESS_GAP'),
('P2-01',null,'AEO_GEO','P2','AI Search Answer-first และ Entity consistency',
null,null,
'คำถามการขายเครื่องต้องตอบได้ตรงเจตนาแต่ไม่มีการการันตี AI citations',
'จัดหน้าแบบคำตอบก่อน รายละเอียดการประเมินจริง ข้อมูลบริษัทตรงกัน และความเชื่อมโยงจากบทความสู่บริการ',
'ไม่อ้างว่าต้องมี schema พิเศษหรือ llms.txt เพื่อให้ AI Overviews แสดงผล','PROCESS_GAP'),
('P2-02',null,'CONTENT','P2','ภาพ/วิดีโอจริงและความเร็วที่เหมาะสม',
null,null,
'ภาพจริงช่วยพิสูจน์การตรวจเครื่องแต่ต้องได้รับสิทธิ์ก่อนใช้ และปรับรูปให้โหลดเหมาะสม',
'ใช้ภาพสินค้าที่อนุมัติแล้ว ใส่คำอธิบายถูกต้อง responsive sizes และ lazy load เฉพาะ below-fold',
'ไม่เผยข้อมูลลูกค้า/serial และตรวจ performance ก่อน/หลัง','PROCESS_GAP'),
('P2-03',null,'CONTENT','P2','สร้าง Article Cluster จากคำค้น GSC จริง',
null,null,
'ขยายเนื้อหาจากคำถามค้นหาจริง ไม่ใช้หน้าเทมเพลตจำนวนมากเพื่อดักคำค้น',
'เลือกชุดบทความรุ่น/สเปก/อาการที่มีความต้องการและการตรวจจริง ไม่ cannibalize หน้าแม่',
'ทุกบทความมีจุดประสงค์ต่างกันและมีข้อมูลใหม่ที่พิสูจน์ได้','GSC_AND_EDITORIAL_SAMPLE'),
('P2-04',null,'MEASUREMENT','P2','Lead-to-Profit Attribution แบบยืนยันหลักฐาน',
null,null,
'ยังไม่มีหลักฐานยืนยันการซื้อ/ขายจริงที่ผูกกับคลิกเว็บไซต์',
'เชื่อม LINE ติดต่อ→เจ้าของยืนยันลีด→ดีลรับซื้อ→ขายออกและกำไรจริงอย่างมีสิทธิ์',
'ไม่ส่งข้อมูลลูกค้าเข้า GSC และห้ามนับ CTA click เป็นยอดขาย','PROCESS_GAP'),
('P2-05',null,'MEASUREMENT','P2','Release Governance และ GSC 7/14/28',
null,null,
'มีระบบ Release Tracking ต้องใช้ SHA และหน้าที่เปลี่ยนเพื่อตีความอันดับหลังปรับ',
'บันทึก QA, URL, SHA, production READY, วิเคราะห์ Google FINAL 7/14/28 วัน',
'ไม่อ้างผล SEO เชิงเหตุผลทันทีหลัง Merge, เทียบช่วงและ attribution อย่างโปร่งใส','PROCESS_GAP')
on conflict(code) do update set
  site_id=excluded.site_id, category=excluded.category, priority=excluded.priority,
  title=excluded.title, target_page=excluded.target_page, focus_query=excluded.focus_query,
  finding=excluded.finding, recommendation=excluded.recommendation,
  acceptance=excluded.acceptance, evidence_kind=excluded.evidence_kind;

create or replace function public.seo_audit_center_manage(
  p_action text,
  p_data jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_site text;
  v_category text;
  v_priority text;
  v_request uuid;
  v_run uuid;
  v_task_id bigint;
  v_status text;
  v_note text;
  v_count integer;
  v_snapshot jsonb;
begin
  select p.role into v_role from public.profiles p where p.id=v_actor and p.active;
  if v_actor is null or v_role not in ('owner','admin') then
    raise exception 'SEO_AUDIT_OWNER_ADMIN_REQUIRED' using errcode='42501';
  end if;
  if p_action = 'create_run' then
    v_site := coalesce(p_data->>'site_id','ALL');
    v_category := coalesce(p_data->>'category','ALL');
    v_priority := coalesce(p_data->>'priority','ALL');
    if v_category not in ('ALL','CONTENT','UX_UI','TECHNICAL','AEO_GEO','MEASUREMENT')
       or v_priority not in ('ALL','P0','P1','P2') then
      raise exception 'SEO_AUDIT_INVALID_FILTER';
    end if;
    if v_site <> 'ALL' and not exists(select 1 from public.commerce_seo_sites s where s.id=v_site and s.enabled=true) then
      raise exception 'SEO_AUDIT_SITE_DISABLED_OR_MISSING';
    end if;
    -- The UI must not imply a new live Google crawl. Preserve observed GSC end dates.
    select coalesce(jsonb_agg(jsonb_build_object(
      'site_id',w.site_id,'window_days',w.window_days,
      'start_date',w.start_date,'end_date',w.end_date,
      'clicks',w.clicks,'impressions',w.impressions,
      'ctr',w.ctr,'position',w.position,'dates_present',w.dates_present
    ) order by w.site_id),'[]'::jsonb) into v_snapshot
    from public.commerce_seo_portfolio_gsc_windows_v w
    join public.commerce_seo_sites s on s.id=w.site_id and s.enabled=true
    where w.window_days=28 and (v_site='ALL' or w.site_id=v_site);
    v_request:=coalesce(nullif(p_data->>'request_key','')::uuid,gen_random_uuid());
    insert into public.commerce_seo_audit_runs
      (request_key,requested_by,site_filter,category_filter,priority_filter,gsc_snapshot)
    values(v_request,v_actor,v_site,v_category,v_priority,v_snapshot)
    on conflict(request_key) do nothing returning id into v_run;
    if v_run is null then
      select id into v_run from public.commerce_seo_audit_runs
      where request_key=v_request and requested_by=v_actor
        and site_filter=v_site and category_filter=v_category and priority_filter=v_priority;
      if v_run is null then raise exception 'SEO_AUDIT_REQUEST_KEY_REUSED'; end if;
    end if;
    insert into public.commerce_seo_audit_tasks
      (run_id,template_code,site_id,category,priority,title,target_page,focus_query,finding,recommendation,acceptance,evidence_kind)
    select v_run,c.code,c.site_id,c.category,c.priority,c.title,c.target_page,c.focus_query,c.finding,c.recommendation,c.acceptance,c.evidence_kind
      from public.commerce_seo_audit_catalog c
      where (v_site='ALL' or c.site_id is null or c.site_id=v_site)
        and (v_category='ALL' or c.category=v_category)
        and (v_priority='ALL' or c.priority=v_priority)
        and (c.site_id is null or exists (select 1 from public.commerce_seo_sites s where s.id=c.site_id and s.enabled=true))
    on conflict(run_id,template_code) do nothing;
    select count(*) into v_count from public.commerce_seo_audit_tasks where run_id=v_run;
    return jsonb_build_object('id',v_run,'tasks',v_count,'source','AUDIT_01_20261124',
      'generated_live_crawl',false,'site_edits_performed',false,'github_pr_created',false,'production_deployed',false);
  elsif p_action = 'review_task' then
    v_task_id := (p_data->>'task_id')::bigint;
    v_status := p_data->>'status';
    v_note := coalesce(p_data->>'note','');
    if v_status not in ('OPEN','BRIEF_READY','DISMISSED') or length(v_note)>1200 then
      raise exception 'SEO_AUDIT_INVALID_REVIEW';
    end if;
    update public.commerce_seo_audit_tasks t
    set status=v_status,review_note=v_note,reviewed_by=v_actor,
        reviewed_at=case when v_status='OPEN' then null else now() end
    where t.id=v_task_id and exists
      (select 1 from public.commerce_seo_audit_runs r where r.id=t.run_id)
    returning t.id into v_task_id;
    if v_task_id is null then raise exception 'SEO_AUDIT_TASK_NOT_FOUND'; end if;
    return jsonb_build_object('task_id',v_task_id,'status',v_status,
      'source_edits_performed',false,'github_pr_created',false,'production_deployed',false);
  else
    raise exception 'SEO_AUDIT_UNKNOWN_ACTION';
  end if;
end;
$$;
revoke all on function public.seo_audit_center_manage(text,jsonb) from public,anon,authenticated;
grant execute on function public.seo_audit_center_manage(text,jsonb) to authenticated;
comment on function public.seo_audit_center_manage(text,jsonb) is
  'Creates owner/admin-reviewed SEO audit work queues from verified Audit #177 scope and GSC final snapshots. Does not call AI or change source/deploy websites.';
