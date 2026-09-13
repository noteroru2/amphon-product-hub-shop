# HUB-4 — MARKETPLACE LISTING ASSISTANT REPORT

Status: **PASS_WITH_OWNER_DEVICE_VERIFICATION_REQUIRED**

วันที่ตรวจและ deploy: 13 กันยายน 2026 (Asia/Bangkok)

## 1. Verdict

HUB-4 ผ่าน automated QA และ deploy เฉพาะ Product Hub แล้ว พนักงานมี mobile Marketplace Listing Assistant สำหรับคัดลอกชื่อ ราคาตัวเลข รายละเอียด ลิงก์ และข้อมูลรวม ตรวจหมวดหมู่/สภาพ/รูป/checklist แล้วเปิด Facebook Marketplace เพื่อกรอกเอง ไม่มี Facebook login, scraping, form automation หรือ auto-publish

## 2. Employee workflow before

หลัง HUB-3 พนักงานมี Sales Post Package แล้ว แต่ยังต้องแยกข้อมูลที่ Facebook Marketplace ต้องการและตรวจ lifecycle/category/condition เอง

## 3. Employee workflow after

เปิดสินค้า → **ผู้ช่วยลง Marketplace** → ตรวจ readiness และรูปหน้าปก → แชร์รูป → คัดลอกชื่อ → คัดลอกราคาเลขล้วน → คัดลอกรายละเอียด → เลือกหมวดหมู่/สภาพด้วยตนเอง → เปิด Facebook Marketplace → วางและเผยแพร่ด้วยตนเอง

## 4. Files changed

- `src/App.tsx`
- `.env.example`
- `src/vite-env.d.ts`
- `package.json`
- `src/components/SalesPostPackagePanel.tsx`
- `src/lib/salesPostContext.ts` (ใหม่; shared HUB-3/4 context)
- `src/lib/marketplaceListing.ts` (ใหม่)
- `src/components/MarketplaceListingAssistant.tsx` (ใหม่)
- `src/styles/marketplaceAssistant.css` (ใหม่)
- `scripts/verify-hub4.mjs` (ใหม่)
- `HUB4_MARKETPLACE_LISTING_ASSISTANT_REPORT.md` (ใหม่)

## 5. Marketplace Assistant architecture

ลำดับข้อมูลคือ Product source-of-truth → `buildSalesPostPackage` ของ HUB-3 → `buildMarketplaceListingDraft` → lazy mobile panel ไม่มี Marketplace caption engine ชุดที่สอง

## 6. HUB-3 reuse

ใช้ HUB-3 Marketplace caption, warranty, defects, accessories, fulfillment, canonical SHOP URL, public projection และ shared context loader โดยตรง

## 7. Public data security boundary

สืบทอด `PUBLIC_SALES_FIELD_ALLOWLIST` และอ่านเพิ่มเฉพาะ public source fields ที่จำเป็น ได้แก่ category, model, conditionPercent, specs, status และ image cover metadata ไม่มีการ spread `ProductDraft`; cost, serial, notes, owner/internal IDs และ sentinel ทั้งหมดไม่ผ่านสู่ title, description หรือ copy-all

## 8. Title logic

ชื่อเริ่มจากชื่อสินค้าจริงและเติมเฉพาะค่าที่มีจริงตามหมวด เช่น CPU/GPU/RAM/storage โดยไม่ตัดชื่ออัตโนมัติ มีตัวนับอักษรและ centralized warning threshold `100` ตัวอักษร รวมถึง warning เมื่อข้อมูล model หาย

## 9. Price logic

ใช้ public selling price ปัจจุบัน แสดง `21,900 บาท` แต่ปุ่มคัดลอกราคาให้ค่า `21900` สำหรับช่องตัวเลข ไม่อ่าน cost/margin/buy price

## 10. Category mapping

mapping อยู่ศูนย์กลางใน `MARKETPLACE_CATEGORY_SUGGESTIONS` ครอบคลุมหมวด AMPHON ปัจจุบัน UI ระบุว่าเป็น **หมวดหมู่แนะนำ** เท่านั้น; หมวดที่ไม่มี mapping ให้พนักงานเลือกใน Marketplace เอง

## 11. Condition mapping

ใช้ conditionPercent จริง: ≥95 เหมือนใหม่, ≥80 สภาพดี, ≥60 สภาพพอใช้, ต่ำกว่านั้นเตือนให้ตรวจรายละเอียด หากมี defects จะเติมคำเตือนให้อ่านรายละเอียดโดยไม่ซ่อนข้อบกพร่อง

## 12. Description logic

ใช้ `salesPackage.captions.MARKETPLACE` จาก HUB-3 โดยตรง จึงรักษาลำดับชื่อ ราคา สเปก สภาพ ตำหนิ อุปกรณ์ ประกัน fulfillment และ CTA เดิม

## 13. Defect handling

ตำหนิจริงยังอยู่ใน Marketplace description หากไม่มีข้อมูลจะเป็น warning และไม่ถูกเปลี่ยนเป็นคำว่า “ไม่มีตำหนิ”

## 14. Warranty handling

คง HUB-3 priority และข้อความเดิม: product-level date → listing days → store default → ไม่ระบุ/ไม่มีประกัน 0 วันไม่กลายเป็นประกันบวก

## 15. Accessories

แสดงเฉพาะค่าที่บันทึกจริง Missing data ไม่กลายเป็น “อุปกรณ์ครบ”

## 16. Image/HUB-2 integration

ใช้ `ProductImageExportControls` และ `imageExport` controller ตัวเดียวกับ Product Detail/HUB-3 จึงคง native File[] share, original URLs, SKU filenames, ordering, retry, stale cancellation และ ZIP fallback ระบุรูปหลัก/รูปแรกเป็น **รูปหน้าปก** โดยเคารพ `isCover`

## 17. Copy actions

มีคัดลอกชื่อ, ราคาเลขล้วน, รายละเอียด, ชื่อ + ราคา, ลิงก์สินค้า และ copy-all staff block ทุกปุ่มใช้ clipboard helper/fallback เดิม พร้อม feedback `คัดลอก...แล้ว`

## 18. Readiness checklist

ตรวจรูป, image export, title, price, category, condition, specs, defects, accessories, warranty, description และ SHOP link เป็น PASS/WARNING/N/A ข้อมูล optional ที่หายไม่ block

## 19. Product lifecycle protection

`sold`, `repair`, `returned`, `cancelled` ถูก block; `reserved` แสดง warning; สถานะปกติยังใช้ได้เมื่อ title, SKU, price และรูปผ่าน critical validation

## 20. Facebook opening/navigation behavior

เปิด landing `https://www.facebook.com/marketplace/` ในแท็บใหม่เท่านั้น URL ปรับได้ด้วย `VITE_FACEBOOK_MARKETPLACE_URL` และ validator ยอมรับเฉพาะ HTTPS บน `facebook.com`/subdomain ไม่มีการกรอกฟอร์ม วางข้อความ กด Publish หรือตรวจว่าลงสำเร็จ

## 21. Mobile UX

ปุ่มเด่นใน Sales Toolkit เปิด bottom sheet แบบ lazy มี touch targets, readiness banner, warnings, cover preview, copy cards, checklist และปุ่ม Facebook เต็มความกว้าง

## 22. Bundle impact

HUB-3 main baseline: `826.31 kB` / gzip `225.57 kB`; HUB-4 main: `827.41 kB` / gzip `225.91 kB` เพิ่มประมาณ `1.10 kB` / gzip `0.34 kB` เท่านั้น Assistant โหลดแยก `13.74 kB` / gzip `4.38 kB`, CSS `4.71 kB` / gzip `1.35 kB`, shared sales context `6.74 kB` / gzip `2.77 kB` Vite >500 kB advisory เดิมยังอยู่

## 23. PWA behavior

build สร้าง `sw.js` และ precache manifest ใหม่พร้อม hashed assets เจ้าของควร refresh หรือปิดแล้วเปิด Hub/PWA ใหม่หนึ่งครั้งก่อนทดสอบ

## 24. Real product QA

ตรวจ production source-of-truth แบบ read-only:

- SKU `AT-PC-2609-000002`
- Apple MacBook Neo
- ราคา 21,900 บาท / copy value `21900`
- status `published`
- notebook/macbook, condition 100%
- 12 รูป และเคารพรูป `isCover`
- title derived จากค่าจริง เช่น Apple A18 Pro, 8GB unified memory, 256GB SSD
- defects จริง `ไม่มี สวยมาก`
- accessory จริง `ครบกล่อง`
- warrantyUntil `2027-04-25` ซึ่ง HUB-3 แสดงเป็นวันที่ประกันจริง
- canonical SHOP link และ fulfillment จาก context จริง

ไม่มีการแก้ไขสินค้านี้

## 25. HUB-1 regression

`npm run verify:hub1 -- --live`: PASS — Hub HTTPS, canonical URL, CORS, noindex, API health และ SHOP flags ผ่าน

## 26. HUB-2 regression

`npm run verify:hub2`: PASS — image ordering, original quality, native share guard, retry, stale cancellation และ fallbacks ผ่าน

## 27. HUB-3 regression

`npm run verify:hub3`: PASS — deterministic captions, public allowlist, warranty/defect/accessory semantics, SHOP publication behavior และ ZIP safety ผ่าน

## 28. SHOP regression

`shop/npm run verify:shop62`: PASS และ `shop/npm run verify:production-closeout`: PASS; `shop.amphon.co.th` HTTP 200 ไม่ deploy SHOP และไม่ deploy API Worker

## 29. purchase_enabled before/after

ก่อน `true` → หลัง `true` ยืนยัน live แบบ read-only

## 30. PromptPay before/after

ก่อน disabled → หลัง disabled; Stripe cards ยังคง enabled และ document mode ยังคง `RECEIPT_ONLY`

## 31. Secret scan

PASS — ไม่พบ Stripe/Supabase/webhook secret ใน source/report และ sentinel cost, serial, notes, owner/internal IDs ไม่รั่วเข้า public package

## 32. Production deployment

Deploy เฉพาะ Cloudflare Static Assets service `amphon-product-hub` สำเร็จบน `hub.amphon.co.th`

- Wrangler `4.131.1`
- Version ID `4fc83b4a-f9d6-4e25-9e9c-ca4b9a33e18d`
- Hub HTTP 200
- main, Marketplace Assistant JS/CSS และ shared context assets HTTP 200
- ไม่เปลี่ยน binding, API Worker, SHOP, database หรือ commerce settings

## 33. Owner-device verification status

**OWNER_DEVICE_VERIFICATION_REQUIRED**

1. Refresh/reopen Hub/PWA และ login
2. เปิด `AT-PC-2609-000002`
3. แตะ **ผู้ช่วยลง Marketplace**
4. ตรวจชื่อ ราคา 21,900 และรูป 12 รูป
5. ทดสอบคัดลอกชื่อและวาง
6. ทดสอบคัดลอกราคา ต้องได้ `21900`
7. ทดสอบคัดลอกรายละเอียดและอ่านครบ
8. ตรวจสเปก ประกัน ตำหนิ และข้อมูลภายใน
9. ทดสอบแชร์/บันทึกรูปและ SHOP link
10. แตะ **เปิด Facebook Marketplace** และยืนยันว่า Facebook เปิด
11. หยุดโดยไม่เผยแพร่ listing จริง

## 34. Remaining warnings

- ต้องยืนยัน clipboard, native share sheet, Facebook app/browser handoff และเวลา workflow บนโทรศัพท์จริง
- category เป็นคำแนะนำภายใน ไม่อ้างว่าเป็น Facebook taxonomy ที่แน่นอน
- Vite initial chunk advisory เดิมยังคงอยู่
- ไม่มี order, reservation, Stripe Session, charge, Facebook login หรือ Marketplace post ถูกสร้าง

Final status: **PASS_WITH_OWNER_DEVICE_VERIFICATION_REQUIRED**
