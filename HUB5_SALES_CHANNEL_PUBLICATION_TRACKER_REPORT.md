# HUB-5 — SALES CHANNEL PUBLICATION TRACKER REPORT

Status: **PASS_WITH_OWNER_DEVICE_VERIFICATION_REQUIRED**

วันที่ deploy/ตรวจ: 13 กันยายน 2026 (Asia/Bangkok)

## 1. Verdict

HUB-5 ผ่าน migration, automated QA, RLS/unauthenticated checks และ production deployment แล้ว ระบบติดตาม SHOP จาก source-of-truth เดิม และบันทึกสถานะ social เฉพาะเมื่อพนักงานยืนยันเอง

## 2. Problem solved

Product Detail ตอบได้ทันทีว่าสินค้าลงช่องทางใด ใครยืนยัน เมื่อไร มีลิงก์หรือไม่ สถานะ active/removed/expired และสินค้าขายแล้วมีประกาศใดต้องปิด

## 3. Previous workflow

Publish Center เก็บ current status ต่อสินค้า/ช่องทางได้ แต่ไม่มี LINE, append-only publication event history, direct Product Detail tracker หรือ HUB-3/4 confirmation flow

## 4. New workflow

เปิดสินค้า → ดู **ช่องทางการขาย** → ใช้ HUB-3/4 ไปโพสต์เอง → กลับมากด **ทำเครื่องหมายว่าโพสต์/ส่งแล้ว** → ใส่เวลาและ URL (ถ้ามี) → ระบบบันทึก actor/timestamp/history → ปิดหรือทำเครื่องหมายหมดอายุโดยไม่ลบประวัติ

## 5. Database architecture

ใช้ `product_publications` เดิมเป็น normalized current-state table ไม่สร้างตารางแยกตาม social platform และเพิ่ม `sales_channel_publication_events` เป็น append-only audit history; SHOP Website row ยังคงเชื่อม Publish Center/Commerce เดิม

## 6. Migration added

- `20260913090000_hub5_sales_channel_tracker.sql`
- `20260913093000_hub5_event_action_id_fix.sql`

ทั้งสองเป็น forward/additive migrations ใหม่ ไม่แก้ migration SHOP ที่ apply แล้ว

## 7. Tables/columns/indexes/constraints

`product_publications` เพิ่ม `last_action_id uuid`, ขยาย channel ให้มี `line`, ขยาย status ให้มี `expired`; unique `(product_id, channel)` เดิมป้องกัน current row ซ้ำ `sales_channel_publication_events` มี action/publication/product/channel/event/status/URL/actor/occurred timestamps พร้อม unique action ID และ indexes ตาม product/time กับ channel/status/time

## 8. RLS/auth policy

พนักงาน active ที่ authenticated อ่าน current/history ได้ เจ้าของ/admin/sales ใช้ RLS เดิมสร้าง/แก้ current state; event history เขียนผ่าน security-definer trigger เท่านั้น authenticated ถูก revoke insert/update/delete และ unauthenticated production request อ่านทั้งสองตารางไม่ได้

## 9. Channel definitions

รวมไว้ที่ `publicationChannels`: AMPHON SHOP, Facebook Marketplace, Facebook Page, LINE และ WINNER IT พร้อม label/icon, URL capability, persistent-listing semantics และ manual confirmation label

## 10. SHOP source-of-truth handling

Tracker แสดง Website row เดิมแบบ read-only ไม่มี manual confirmation สำหรับ SHOP ใน tracker การ sync product overall status เกิดเฉพาะ channel `website`; social confirmation ไม่เปลี่ยน inventory/product status

## 11. Marketplace tracking

HUB-4 มีปุ่ม **ทำเครื่องหมายว่าโพสต์ Marketplace แล้ว** เปิด confirmation sheet ไม่บันทึกเพียงเพราะเปิด Facebook

## 12. Facebook Page tracking

เมื่อเลือก Facebook Page preset ใน HUB-3 จะแสดงปุ่มยืนยันโพสต์ เปิด sheet เดียวกันและเก็บ event

## 13. LINE tracking

LINE ใช้ semantics `SHARED`: แสดงส่งแล้ว/ส่งเมื่อ และอนุญาตบันทึกส่งอีกครั้งเป็น event ใหม่ โดยไม่บังคับ URL หรือ active-listing removal

## 14. Employee attribution

ทุก mutation ส่ง authenticated profile ID/name และ database trigger resolve ชื่อจาก `profiles`; UI แสดง display name เท่านั้น ไม่แสดงอีเมลหรือ auth UUID

## 15. Timestamp/timezone handling

เก็บ `timestamptz`/UTC ในฐานข้อมูล Confirmation default เวลาปัจจุบันและแปลงเป็น ISO UI แสดงด้วย `Intl.DateTimeFormat('th-TH')`

## 16. External URL behavior

URL ไม่บังคับ ยอมรับเฉพาะ `http:`/`https:` ปฏิเสธ javascript/data/file เปิดด้วย new tab + `noopener,noreferrer` และคัดลอกได้

## 17. Duplicate-active protection

unique `(product_id, channel)` ป้องกัน current row ซ้ำ การยืนยัน persistent listing ที่ active และ URL เดิมคืน record เดิมโดยไม่สร้าง event ซ้ำ; URL ใหม่ update row เดิม และ repost หลัง ended/expired สร้าง cycle/event ใหม่ LINE ตั้งใจให้บันทึกแชร์ซ้ำได้

## 18. History/audit behavior

trigger บันทึก posted/shared/updated/removed/expired/reset พร้อม previous/new status, URL snapshot, actor และเวลา Unique action ID ทำให้ network retry idempotent ส่วน database-triggered Website lifecycle ได้ action ID ใหม่เพื่อไม่ตก event

## 19. Product SOLD cleanup workflow

เมื่อ SOLD และยังมี persistent external listing active จะแสดง **มีช่องทางขายที่ยังไม่ได้ปิด N ช่องทาง** พร้อมเปิดประกาศและทำเครื่องหมายปิดเอง HUB-5 ไม่ลบประกาศภายนอก

## 20. RESERVED behavior

แสดง warning **สินค้าถูกจอง** แต่ไม่เปลี่ยน/ปิดรายการอัตโนมัติ Confirmation เตือนซ้ำก่อนบันทึก

## 21. Tracker page

Publish Center เดิมถูกยกระดับเป็น **งานช่องทางขาย** มี counts รอลง/ลงไม่ครบ/ครบ/ต้องปิด, search, compact channel badges และ sold-cleanup queue

## 22. Product detail integration

เพิ่ม lazy-loaded **ช่องทางการขาย** ใน Review/Product Detail แสดง SHOP/MP/FB/LINE current state, actor/time/link, transitions และประวัติล่าสุด พร้อม realtime refresh

## 23. HUB-3 integration

Facebook Page และ LINE presets มี explicit confirmation actions โดยการคัดลอกข้อความอย่างเดียวไม่เปลี่ยน tracker

## 24. HUB-4 integration

Marketplace Assistant มี explicit confirmation หลังพนักงานโพสต์จริง การกดเปิด Facebook ไม่สร้าง record

## 25. Mobile/PWA UX

Cards ไม่พึ่ง horizontal table ปุ่ม touch-friendly confirmation เป็น bottom sheet มี retry/error และ PWA build สร้าง service worker/hashed precache ใหม่ เจ้าของควร refresh/reopen หนึ่งครั้ง

## 26. Performance impact

HUB-4 main `827.41 kB / 225.91 kB gzip`; HUB-5 main `831.56 kB / 226.97 kB gzip` เพิ่มประมาณ `4.15 kB / 1.06 kB gzip` Tracker lazy chunk `7.12 kB / 2.56 kB gzip`, CSS `3.90 kB / 1.05 kB gzip`, confirmation shared chunk `2.87 kB / 1.30 kB gzip` Vite >500 kB advisory เดิมยังอยู่

## 27. Files changed

- `supabase/migrations/20260913090000_hub5_sales_channel_tracker.sql`
- `supabase/migrations/20260913093000_hub5_event_action_id_fix.sql`
- `src/types/product.ts`
- `src/lib/publications.ts`
- `src/lib/publicationSecurity.ts`
- `src/components/SalesChannelTracker.tsx`
- `src/components/PublicationConfirmSheet.tsx`
- `src/components/SalesPostPackagePanel.tsx`
- `src/components/MarketplaceListingAssistant.tsx`
- `src/components/PublishCenter.tsx`
- `src/styles/salesChannelTracker.css`
- `src/styles/marketplaceAssistant.css`
- `src/App.tsx`
- `scripts/verify-hub2.mjs`, `verify-hub3.mjs`, `verify-hub4.mjs`, `verify-hub5.mjs`
- `shop/scripts/verify-shop5.mjs`
- `package.json`

## 28. Migration result

Supabase project `mfpdtlxwdbxitgfzdape`: migrations `20260913090000` และ `20260913093000` apply สำเร็จ local/remote migration list ตรงกัน ไม่มี reset/repair/rollback

## 29. Build/typecheck results

`npm run typecheck`: PASS; `npm run build`: PASS; 2,246 modules, PWA precache 17 entries

## 30. HUB-1 regression

PASS live: canonical/CORS/noindex/API/Hub HTTPS

## 31. HUB-2 regression

PASS: image preparation/share/order/naming/retry/fallback

## 32. HUB-3 regression

PASS: deterministic captions, public allowlist, warranty/defects/accessories/ZIP

## 33. HUB-4 regression

PASS: Marketplace title/price/category/condition/copies/lifecycle/no automation

## 34. SHOP regression

SHOP-6.2 PASS และ production-closeout PASS; `shop.amphon.co.th` HTTP 200 ไม่ deploy SHOP/API Worker

## 35. purchase_enabled before/after

`true` → `true` (live read-only verification)

## 36. PromptPay before/after

disabled → disabled; Stripe cards enabled และ `RECEIPT_ONLY` ไม่เปลี่ยน

## 37. Production mutations performed

ทำเฉพาะ Supabase schema migrations สองรายการและ deploy Hub static assets ไม่มี product/publication/order/payment data mutation

## 38. Confirmation no fake social publication record was inserted

ยืนยัน: ไม่มีการ insert/backfill Marketplace, Facebook Page หรือ LINE record เพื่อ QA; migration ไม่มี data insert ลง `product_publications`

## 39. Confirmation no order/Stripe transaction was created

ยืนยัน: ไม่มี order, reservation, checkout Session, charge, refund หรือ payment mutation

## 40. Secret scan

PASS: ไม่พบ Supabase secret, Stripe key, webhook secret, Turnstile secret, Cloudflare token, Facebook credential/session cookie

## 41. Remaining warnings

- Event history เริ่มสะสมจาก migration HUB-5 เป็นต้นไป; current rows เก่ายังคงอยู่แต่ไม่มี fabricated historical events
- Basic concurrency ใช้ unique current row + append-only action history; current view แสดง update ล่าสุด
- Vite initial chunk advisory เดิมยังคงอยู่
- ยังต้องยืนยัน native mobile layout/clipboard/external-app handoff ด้วยอุปกรณ์จริง

## 42. Owner-device verification required

1. Refresh/reopen Hub PWA และ login
2. เปิด `AT-PC-2609-000002`
3. หา **ช่องทางการขาย** และตรวจ SHOP status
4. เปิด Marketplace Assistant และตรวจปุ่ม **ทำเครื่องหมายว่าโพสต์ Marketplace แล้ว**
5. ห้ามยืนยัน หากสินค้ายังไม่ได้โพสต์ Marketplace จริง
6. ตรวจ Facebook Page และ LINE status/actions ใน Sales Package
7. เปิดหน้า **งานช่องทางขาย** และตรวจ filters/cleanup counts
8. ตรวจ layout บนมือถือ
9. ทดสอบ sold-cleanup ด้วย safe non-production fixture เท่านั้นถ้ามี
10. ไม่สร้าง social record ปลอมและไม่โพสต์ภายนอกในการ QA นี้

Production Hub version: `3f2c5795-402d-44bc-b834-0a93dc5dfec0`

Final status: **PASS_WITH_OWNER_DEVICE_VERIFICATION_REQUIRED**
