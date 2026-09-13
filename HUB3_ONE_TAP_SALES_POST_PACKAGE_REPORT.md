# HUB-3 — ONE-TAP SALES POST PACKAGE REPORT

Status: **PASS_WITH_OWNER_DEVICE_VERIFICATION_REQUIRED**

วันที่ตรวจและ deploy: 13 กันยายน 2026 (Asia/Bangkok)

## 1. Verdict

HUB-3 ผ่าน automated QA และ deploy ขึ้น `https://hub.amphon.co.th` แล้ว พนักงานสามารถกด **เตรียมโพสต์ขาย** เพื่อสร้างข้อความขายจากข้อมูลจริง เลือก preset คัดลอกข้อความ/ชื่อกับราคา ใช้ระบบแชร์รูปเดิมของ HUB-2 ดาวน์โหลด ZIP และเปิดหน้าสินค้าใน SHOP ได้ โดยไม่มีการโพสต์ไปยัง social platform อัตโนมัติ ไม่มีการสร้างคำสั่งซื้อ และไม่มีการเรียก Stripe Session/charge สถานะยังต้องรอเจ้าของยืนยัน workflow จริงบนมือถือ

## 2. Previous employee workflow

ก่อน HUB-3 พนักงานต้องค้นหาราคา สเปก สภาพ ตำหนิ อุปกรณ์ และประกันจากหลายจุด แล้วพิมพ์/จัดรูปข้อความเอง แม้ HUB-2 จะช่วยเตรียมและแชร์รูปหลายไฟล์แล้วก็ตาม

## 3. New employee workflow

เปิดสินค้า → กด **เตรียมโพสต์ขาย** → ตรวจข้อความที่สร้างทันที → เลือก General / Marketplace / Facebook Page / LINE → คัดลอกข้อความ → แชร์/บันทึกรูปผ่าน HUB-2 → สลับไปวางและโพสต์ในช่องทางปลายทางด้วยตนเอง

## 4. Files changed

- `src/App.tsx`
- `src/styles/app.css`
- `src/components/ProductImageExportActions.tsx`
- `src/hooks/useProductImageExport.ts`
- `src/lib/sales.ts`
- `package.json`
- `scripts/verify-hub2.mjs`
- `src/lib/salesPostPackage.ts` (ใหม่)
- `src/lib/salesPostPackageDownload.ts` (ใหม่)
- `src/components/SalesPostPackagePanel.tsx` (ใหม่)
- `scripts/verify-hub3.mjs` (ใหม่)
- `HUB3_ONE_TAP_SALES_POST_PACKAGE_REPORT.md` (ใหม่)

## 5. Sales package architecture

แพ็กเกจเป็นข้อมูล derived จาก `ProductDraft` ปัจจุบันและ Store/Commerce context แบบ read-only ไม่บันทึกสำเนาข้อมูลสินค้าถาวร ตัว generator เป็น deterministic TypeScript function ส่วน panel และ ZIP downloader โหลดแบบ lazy เมื่อใช้งาน

## 6. Public field allowlist

อนุญาตเฉพาะ `sku`, `title`, `price`, `category`, `subtype`, `brand`, `model`, `conditionPercent`, `warrantyUntil`, `defects`, `specs`, `images`, `status` การทดสอบใส่ sentinel ใน cost, serial number และ internal notes แล้วตรวจว่าไม่ปรากฏใน caption หรือ package projection

## 7. Caption generation logic

สร้างภาษาไทยจากข้อมูล structured จริงเท่านั้น ไม่เรียก AI และไม่เดาข้อมูล ส่วนที่ไม่มีข้อมูลจะถูกละเว้นพร้อม warning ตามความเหมาะสม ราคาใช้ราคาขายสาธารณะปัจจุบันและ format `21,900 บาท` มี validation ของ identity, SKU, ราคา และรูปอย่างน้อยหนึ่งรูป พร้อม readiness score 0–10

## 8. Category-aware spec mapping

ใช้ definition จาก smart product schema เดิม แบ่งฟิลด์ตาม section `spec`, `condition`, `accessory` จึงไม่สร้างระบบสเปกคู่ขนานและรองรับชนิดสินค้าเดิมตาม schema

## 9. Warranty semantics

ลำดับความสำคัญคือ product-level `warrantyUntil` → listing warranty days → store default warranty days หากระบุ 0 วันจะไม่ถูกเปลี่ยนเป็นประกันบวก และเมื่อไม่มีข้อมูลจะแสดง `ไม่ระบุประกัน`/warning โดยไม่แต่งตัวเลขขึ้นมา

## 10. Condition/defect handling

สภาพและตำหนิใช้ค่าที่บันทึกจริง ตำหนิที่มีอยู่ไม่ถูกซ่อนหรือทำให้อ่อนลง หากข้อมูลตำหนิหายจะไม่กล่าวว่า “ไม่มีตำหนิ” แต่ละเว้น section และเตือน `ยังไม่มีข้อมูลตำหนิ`

## 11. Accessory handling

แสดงเฉพาะอุปกรณ์ใน schema ที่มีค่าบันทึกจริง หากไม่มีข้อมูลจะไม่สมมติว่าอุปกรณ์ครบ และเตือน `ยังไม่มีอุปกรณ์ที่ระบุ`

## 12. Marketplace preset

ข้อความแบบกระชับ เน้นชื่อ ราคา สเปกสำคัญ สภาพ ตำหนิ ประกัน และ CTA สำหรับนำไปกรอก Facebook Marketplace ด้วยตนเอง ไม่มีระบบ login/scrape/auto-post

## 13. Facebook Page preset

เพิ่มโครงสร้างเชิงโปรโมตเล็กน้อยและ hashtag จาก brand/category/model ที่มีจริงเท่านั้น โดยยังคงข้อเท็จจริงชุดเดียวกับ source-of-truth

## 14. LINE preset

เวอร์ชันสั้นและเป็นภาษาสนทนา เน้นสินค้า ราคา สเปก สภาพ ประกัน และ CTA เหมาะสำหรับคัดลอกไปส่งเอง

## 15. Clipboard implementation

มี **คัดลอกข้อความขาย**, **คัดลอกชื่อ + ราคา** และ **คัดลอกลิงก์สินค้า** ใช้ Clipboard API และมี fallback สำหรับ browser ที่ไม่รองรับ พร้อม feedback `คัดลอกแล้ว` การแก้ข้อความใน preview เป็น local temporary draft ไม่แก้สินค้า

## 16. Image integration with HUB-2

Panel ใช้ controller และ prepared `File[]` ชุดเดียวกับ HUB-2 ไม่สร้าง image pipeline ใหม่ จึงรักษาลำดับรูป URL ต้นฉบับ ชื่อ `<SKU>-01.jpg` การ retry การยกเลิกงานเก่า native file share ZIP fallback และ individual fallback

## 17. ZIP/package export

ZIP แบบ UTF-8 มีโฟลเดอร์ `<SKU>/`, รูปสินค้า, `ข้อความขาย.txt`, `marketplace.txt`, `facebook-page.txt`, `line.txt` ไม่มี product JSON, cost, serial, employee notes, customer data หรือ secret และใช้ dependency ZIP เดิมแบบ dynamic import

## 18. Mobile UX

ปุ่ม **เตรียมโพสต์ขาย** เด่นใน Sales Toolkit เปิด panel แบบ mobile sheet มี touch targets, image readiness/progress, readiness score, warnings, preset tabs, editable preview และ action buttons เรียงสำหรับ workflow บนโทรศัพท์

## 19. Performance/bundle impact

Build HUB-3: main `826.31 kB` / gzip `225.57 kB`; lazy panel `12.36 kB` / gzip `4.47 kB`; lazy package downloader `1.02 kB` / gzip `0.68 kB`; ZIP runtime chunk `31.76 kB` / gzip `12.19 kB`. เทียบ baseline HUB-2 main `834.28 kB` / gzip `229.81 kB` initial main ลดประมาณ `7.97 kB` / gzip `4.24 kB` เพราะย้าย ZIP runtime ออกจาก initial path ยังคงมี Vite advisory เกิน 500 kB เป็น warning ที่มีอยู่เดิม

## 20. PWA/service-worker behavior

`sw.js` และ asset manifest ใหม่ถูก deploy พร้อม hashed assets จึงรองรับ update ของ PWA เจ้าของควร refresh หน้า หรือปิดแล้วเปิด PWA ใหม่หนึ่งครั้งก่อนทดสอบ เพื่อไม่ให้ service worker เก่าแสดง HUB-2 build

## 21. Real product QA

ตรวจแบบ read-only จาก production source-of-truth ด้วย SKU `AT-PC-2609-000002`:

- ชื่อ: Apple MacBook Neo
- ราคาขาย: 21,900 บาท
- รูป: 12 รูป
- category/subtype: notebook/macbook
- สเปกที่ตรวจพบจากข้อมูลจริงรวม Apple A18 Pro, RAM 8GB unified และ SSD 256GB
- ตำหนิที่บันทึกจริง: `ไม่มี สวยมาก` (แสดงตามข้อมูลต้นทาง ไม่ได้สร้างคำกล่าวใหม่)
- อุปกรณ์ที่บันทึกจริง: `ครบกล่อง`
- ประกัน product-level แสดง `ประกันถึง 25 เม.ย. 2570`

General, Marketplace, Facebook Page และ LINE variants ผ่าน deterministic verification โดยไม่ได้แก้ข้อมูลสินค้านี้

## 22. HUB-1 regression

`npm run verify:hub1 -- --live`: PASS — canonical Hub, CORS, QR host, noindex, production API health และ HTTPS ผ่าน

## 23. HUB-2 regression

`npm run verify:hub2`: PASS — native files-only share guard, stable filenames, image order, retry, stale preparation, ZIP/individual fallbacks และ production image CORS ผ่าน การยืนยัน native share sheet จริงยังเป็น owner-device QA

## 24. SHOP regression

`shop/npm run verify:shop62`: PASS และ `shop/npm run verify:production-closeout`: PASS ไม่มีการ deploy หรือแก้ SHOP/API Worker ใน HUB-3

## 25. purchase_enabled before/after

ก่อน: `true` — หลัง: `true` ยืนยันแบบ read-only ไม่มี mutation

## 26. PromptPay before/after

ก่อน: disabled — หลัง: disabled ยืนยันแบบ read-only ไม่มี mutation Stripe cards ยังคง enabled และ document mode ยังคง `RECEIPT_ONLY`

## 27. Secret scan

PASS — HUB-3 verifier ตรวจ secret/static release hygiene และ public package sentinel ไม่มี Supabase secret, Stripe key, webhook secret, Cloudflare token, session token หรือ private product fields

## 28. Production deployment

Deploy เฉพาะ Cloudflare Worker Static Assets service `amphon-product-hub` สำเร็จบน `hub.amphon.co.th`

- Wrangler: `4.131.1`
- Version ID: `1df6829f-ff4f-4944-a85f-96edff5792f2`
- Production HTTP: Hub 200
- Asset checks: main, Sales Package panel และ package downloader ได้ HTTP 200 และมี production UI labels ครบ
- SHOP: healthy จาก live/regression verification
- ไม่ deploy `amphon-product-images` และไม่ deploy SHOP

## 29. Owner device verification required

ต้องทดสอบบนโทรศัพท์จริง:

1. Refresh หรือปิดแล้วเปิด Hub/PWA ใหม่หนึ่งครั้ง
2. เข้า `hub.amphon.co.th` และ login
3. เปิด `AT-PC-2609-000002`
4. แตะ **เตรียมโพสต์ขาย** และยืนยันว่า panel เปิด
5. ตรวจชื่อ ราคา และ Marketplace caption
6. แตะ **คัดลอกข้อความขาย** แล้ววางใน Notes/chat เพื่อตรวจภาษาไทย
7. แตะ **บันทึก/แชร์รูปทั้งหมด** และตรวจ native HUB-2 flow
8. ทดสอบ **คัดลอกชื่อ + ราคา**
9. ดาวน์โหลดและเปิด ZIP หากต้องการ
10. ตรวจว่าไม่มี cost, serial หรือข้อมูลภายในปรากฏ

ห้ามกดโพสต์ภายนอกเพื่อการทดสอบนี้; HUB-3 เตรียมข้อมูลเท่านั้น

## 30. Remaining warnings

- ต้องรอ owner mobile-device verification สำหรับ native share sheet, clipboard behavior และความสะดวกภายในเป้าหมายประมาณ 30 วินาที
- Vite ยังมี chunk-size advisory เดิม แม้ initial bundle ลดลง
- Browser/PWA ที่ยังถือ cache เก่าควร refresh/reopen หนึ่งครั้ง
- ไม่มี order, Stripe Session, charge หรือ social post ถูกสร้างระหว่างงานและ QA นี้

Final status: **PASS_WITH_OWNER_DEVICE_VERIFICATION_REQUIRED**
