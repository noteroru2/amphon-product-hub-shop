# SHOP-6.2 Isolated Provider E2E Route Repair v20

ชุดนี้เป็น surgical hotfix สำหรับ repo ปัจจุบัน จึงไม่วางทับไฟล์ source ทั้งไฟล์ที่ Codex แก้ภายหลัง SHOP-6.2/6.3

## วิธีใช้

1. แตก ZIP แล้ววางไฟล์ทั้งหมดที่ root ของ `amphon-product-hub-shop6-1` เดิม
2. รัน `APPLY-SHOP62-ROUTE-FIX.bat`
3. ต้องได้ `SHOP-6.2 ROUTE FIX VERIFY: PASS`
4. จากนั้นรัน `SHOP62-PROVIDER-E2E.bat`

ตัว patcher สำรองไฟล์ที่แก้เป็น `*.shop62-routefix.bak`

## Safety

- ไม่แตะ migration หรือ remote DB schema
- ไม่ deploy production Worker
- ไม่แก้ production Stripe webhook
- ไม่เปลี่ยน `purchase_enabled`
- Provider E2E ยังคงรับเฉพาะ Stripe `sk_test_...`

## Mobile Product Hub (PWA)

Product Hub ที่ `https://hub.amphon.co.th` รองรับการติดตั้งบนมือถือแบบ Progressive Web App (PWA)

- Android/Chrome ที่รองรับจะแสดงปุ่มติดตั้งแอปจาก Hub
- iPhone/iPad ให้เปิดด้วย Safari แล้วเลือก `แชร์` → `เพิ่มไปยังหน้าจอโฮม`
- เมื่อติดตั้งแล้ว Hub จะเปิดแบบ standalone จากไอคอนบนหน้าจอ โดยยังใช้ระบบล็อกอินและ workflow เดิม
