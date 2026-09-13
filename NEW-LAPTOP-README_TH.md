# AMPHON Project — ย้ายไปทำต่อโน้ตบุ๊กอีกเครื่อง

ชุดนี้มีไว้ **ย้าย source code + local public configuration** จากเครื่องเดิมไปเครื่องใหม่ โดยไม่ deploy และไม่เปิด checkout

## สถานะสำคัญตอนหยุดงาน

- SHOP-6.2 Database Contract: PASS
- SHOP-6.2 Stripe TEST Provider E2E: PASS
- SHOP-6.3 Final Activation Readiness: PASS
- SHOP-6.4 Owner Activation tooling: เตรียมแล้ว
- **ยังไม่ได้เปิดขาย**
- `purchase_enabled=false` ต้องคงไว้จนกว่าจะตั้งใจ resume SHOP-6.4

## บนเครื่องเดิม

1. แตก toolkit นี้ลงใน **root โปรเจกต์ปัจจุบัน** (โฟลเดอร์เดียวกับ `package.json`)
2. กด `CREATE-TRANSFER-ZIP.bat`
3. จะได้ไฟล์ `AMPHON-PROJECT-TRANSFER-YYYYMMDD-HHMMSS.zip` อยู่ข้างโฟลเดอร์โปรเจกต์
4. คัดลอก ZIP นั้นไปเครื่องใหม่

ZIP จะรวม source ล่าสุดทั้งหมด รวม uncommitted Codex edits, migrations, reports, `.git` ถ้ามี, `deployment/install.config.ps1`, root `.env` และ `shop/.env` ถ้ามีและผ่าน secret scan

ZIP จะ **ไม่รวม** `node_modules`, `dist`, build caches, temporary secret files หรือ credential caches

## บนเครื่องใหม่

1. ติดตั้ง Node.js **24.14.1** เพื่อให้ตรงกับ environment ที่ผ่าน acceptance ล่าสุด
2. แตก transfer ZIP
3. กด `SETUP-NEW-LAPTOP.bat`
4. กด `VERIFY-NEW-LAPTOP.bat`
5. เมื่อต้องใช้ Supabase/Cloudflare remote CLI ให้ login ใหม่:

```powershell
npx supabase@latest login
npx wrangler login
```

## ไฟล์ตั้งค่าที่ควรติดมาด้วย

- `deployment/install.config.ps1` — project ref / URLs / Worker name / bucket / public configuration
- `.env` — frontend public config เช่น Supabase URL + publishable key + Worker URL
- `shop/.env` — public shop/store API URLs
- `.git/` — ถ้าต้องการ branch/history/status เดิม
- `package-lock.json` ทุกตำแหน่ง — ถ้ามี
- `supabase/migrations/` ทั้งหมด
- SHOP62/63/64 scripts และ reports ทั้งหมด

ตัว exporter จะรวมสิ่งเหล่านี้ให้อัตโนมัติถ้ามีอยู่ในโปรเจกต์

## สิ่งที่ไม่ต้อง/ไม่ควรก๊อป

อย่าก๊อป credential cache ของเครื่องเดิม เช่น Wrangler OAuth token หรือ Supabase CLI access token ไปเครื่องใหม่ ให้ login ใหม่แทน

ไม่ต้องก๊อป secrets ต่อไปนี้ใส่ ZIP:

- Supabase database password
- `sb_secret_...`
- Stripe `sk_live_...` / `sk_test_...`
- Stripe webhook signing secret `whsec_...`
- Turnstile secret key

Production secrets เหล่านี้อยู่บน Cloudflare/Supabase/Stripe อยู่แล้วและไม่จำเป็นต่อการย้าย source code

## ห้ามทำทันทีหลังย้าย

อย่ารัน `SHOP64-OWNER-ACTIVATE.bat` โดยอัตโนมัติ การเปิด `purchase_enabled=true` เป็น owner action แยกต่างหาก

เริ่มจาก local verification ก่อน แล้วค่อย resume งานจาก SHOP-6.4 เมื่อพร้อม
