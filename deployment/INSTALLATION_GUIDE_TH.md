# AMPHON Product Hub + shop.amphon.co.th — ติดตั้งเต็ม + ต่อฐานข้อมูลครั้งเดียว

ชุดนี้คือ **SHOP-6.1 Full Deploy Bundle** สำหรับ Windows/PowerShell โดยรวม Product Hub, Store API Worker, R2, Astro Shop, Supabase schema/migrations, Stripe webhook foundation, checkout/order/payment/shipping/document/warranty และ production acceptance gate ไว้ใน ZIP เดียว

## วิธีที่ง่ายที่สุด

1. ติดตั้ง **Node.js 22** และ Git ก่อน
2. แตก ZIP ไว้ในโฟลเดอร์ที่ path ไม่ยาวเกินไป เช่น `C:\AMPHON\shop61`
3. เข้า `deployment` แล้วคัดลอก `install.config.example.ps1` เป็น `install.config.ps1`
4. แก้เฉพาะค่าที่เป็น public ในไฟล์นั้น:
   - `SupabaseProjectRef`
   - `SupabaseUrl`
   - `SupabasePublishableKey`
   - URL ของ app/shop
   - LINE/เบอร์โทร ถ้ามี
5. กลับมาที่ root แล้วดับเบิลคลิก **`INSTALL-ALL.bat`**
6. โปรแกรมจะถาม secret แบบไม่บันทึกลง source:
   - Supabase database password
   - Supabase Secret key (`sb_secret_...`)
   - Turnstile secret (เว้นว่างได้ในรอบแรก)
   - Stripe secret (`sk_test_...` แนะนำให้เริ่ม Test mode; เว้นว่างได้)
7. ระหว่างติดตั้ง Supabase CLI อาจขอ Personal Access Token และ Cloudflare อาจเปิด Browser เพื่อยืนยันบัญชีที่ต้องการ deploy

ตัวติดตั้งจะทำตามลำดับนี้อัตโนมัติ:

`Supabase login/link → FULL_DATABASE_SETUP → DB verify/assert → npm install → Cloudflare login → R2 bucket → Worker config/secrets/deploy → Stripe webhook (optional) → .env → Product Hub build → SHOP-1..6.1 regression → Astro build → Shop deploy → live HTTP smoke`

## ต่อฐานข้อมูลอย่างเดียว

ถ้าต้องการแค่เชื่อม Supabase + ลงฐานข้อมูลทั้งหมดครั้งเดียว ให้ดับเบิลคลิก:

`DATABASE-ONLY.bat`

ตัวนี้ใช้ migration เดียว:

`supabase/migrations/20260912000000_amphon_shop61_full_setup.sql`

ซึ่งรวมตามลำดับ:

`schema.sql → batch3_2.sql → batch3_3.sql → batch3_4.sql → batch4.sql → batch4_1.sql → shop_1.sql → shop_2.sql → shop_3.sql → shop_4.sql → shop_5.sql → shop_6.sql`

จึงใช้ได้ทั้งฐาน Supabase ใหม่และฐาน AMPHON เดิมที่เคยรันบาง Batch แล้ว เพราะ source migrations ชุดนี้ถูกออกแบบให้ safe to re-run

หากไม่ต้องการใช้ CLI สามารถเปิด Supabase SQL Editor แล้วรัน **`supabase/FULL_DATABASE_SETUP.sql` เพียงไฟล์เดียว** จากนั้นรัน `supabase/FULL_DATABASE_VERIFY.sql`

## ค่าที่ต้องเตรียมจาก Supabase

จาก Supabase Dashboard ของ project:

- Project ref
- Project URL เช่น `https://xxxx.supabase.co`
- Publishable key (`sb_publishable_...`)
- Secret key (`sb_secret_...`) — server only
- Database password

**ห้ามใส่ Secret key หรือ database password ใน `.env` ฝั่ง browser** ตัวติดตั้งส่ง Secret key ไป Cloudflare Worker เท่านั้น

## Cloudflare / R2

ตัวติดตั้งจะตรวจ bucket `amphon-product-images` และสร้างให้อัตโนมัติถ้ายังไม่มี จากนั้นสร้าง `workers/r2-upload/wrangler.toml`, ตั้ง Cron ทุก 5 นาที และ deploy Worker

Wrangler ปัจจุบันรองรับ `wrangler r2 bucket create`, `wrangler deploy` และ `--secrets-file`; secrets จะไม่ถูกเก็บใน repository และ temp secret file จะถูกลบทิ้งหลัง deploy

ถ้า `$AttachShopCustomDomain = $true` ตัวติดตั้งจะเพิ่ม `shop.amphon.co.th` เป็น Cloudflare Worker Custom Domain อัตโนมัติ โดย zone `amphon.co.th` ต้องอยู่ในบัญชี Cloudflare และ hostname ต้องไม่มี DNS record ที่ชนกัน

## Stripe

แนะนำให้เริ่มด้วย `sk_test_...`

เมื่อใส่ Stripe secret ตัวติดตั้งจะ deploy Worker ก่อนเพื่อรู้ Worker URL แล้วพยายามสร้าง Stripe webhook ให้ที่:

`<WORKER_URL>/webhooks/stripe`

Events ที่ลงทะเบียน:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`

Stripe จะคืน `whsec_...` เฉพาะตอนสร้าง endpoint ตัวติดตั้งจะนำค่านั้นไปเก็บเป็น Cloudflare Worker secret ทันที ถ้า endpoint มีอยู่ก่อนแล้ว ระบบจะถาม `whsec_...` จากคุณแทน

## ไฟล์ environment ที่ตัวติดตั้งสร้าง

Root `.env`:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_R2_UPLOAD_API=https://...workers.dev
VITE_ALLOW_SIGNUP=false
VITE_PUBLIC_APP_URL=https://hub.amphon.co.th
VITE_SALES_SITE_URL=https://shop.amphon.co.th
```

`shop/.env`:

```env
PUBLIC_SITE_URL=https://shop.amphon.co.th
PUBLIC_AMPHON_STORE_API=https://...workers.dev/store
PUBLIC_LINE_URL=https://line.me/R/ti/p/@webuy
PUBLIC_PHONE=
```

ไฟล์ `.env`, `workers/r2-upload/wrangler.toml` และ `deployment/install.config.ps1` ถูก ignore จาก Git แล้ว

## หลังติดตั้งสำเร็จ

Product Hub จะ build ที่ `dist/` ส่วน shop จะ deploy ผ่าน Wrangler โดยตรง

ยัง **ไม่ควรเปิด `purchase_enabled` อัตโนมัติ** ให้เข้า Product Hub → Commerce Admin แล้วตั้งค่าจริงก่อน:

- Turnstile site key
- Stripe / Bank transfer / Pay at store
- Shipping rate + destination + handling/transit time
- Return policy
- Seller / VAT / receipt-invoice information
- Default warranty และ per-SKU warranty ที่ต้องการ

หลังจากนั้นให้ทดสอบอย่างน้อย 1 order ใน Stripe **Test mode** ให้ครบ:

`Cart → Checkout → Reserved → Stripe → webhook → PAID → SOLD → Packing → Shipped/Pickup → Completed → Receipt/Invoice → Warranty`

และทดสอบ `expired`, `cancel`, `duplicate webhook`, `refund → returned` ก่อนเปิดขายจริง

## ถ้า INSTALL-ALL ติด npm install

รันทีละส่วนจาก PowerShell:

```powershell
npm install
npm run typecheck
npm run build

cd workers\r2-upload
npm install
npm run typecheck

cd ..\..\shop
npm install
npm run verify:foundation
npm run verify:shop2
npm run verify:shop3
npm run verify:shop4
npm run verify:shop5
npm run verify:shop6
npm run verify:production-closeout
npm run build
```

แล้วรัน `INSTALL-ALL.bat` ใหม่ ตัว database migration มี migration history จึงไม่ลง migration เดิมซ้ำ

## เอกสารอ้างอิงปัจจุบัน

- Supabase CLI: https://supabase.com/docs/reference/cli/supabase-db-push
- Cloudflare Wrangler: https://developers.cloudflare.com/workers/wrangler/
- Cloudflare Workers secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare R2 bucket CLI: https://developers.cloudflare.com/r2/buckets/create-buckets/
- Cloudflare Custom Domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Stripe webhook endpoints: https://docs.stripe.com/api/webhook_endpoints
