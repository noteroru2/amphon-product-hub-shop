# SHOP-6.2 Upgrade

ใช้ ZIP นี้วางทับโฟลเดอร์ SHOP-6.1 v15 เดิมได้เลย โดย **อย่าลบ `deployment/install.config.ps1`** ของเครื่องคุณ

จากนั้นรันตามลำดับ:

1. `SHOP62-DB-UPGRADE-TEST.bat`
2. ตั้งค่า Commerce ที่ต้องการใช้จริง แต่คง `purchase_enabled=false`
3. `SHOP62-PROVIDER-E2E.bat`

SHOP-6.2 จะไม่เปิดรับคำสั่งซื้ออัตโนมัติ และ Provider E2E รับเฉพาะ Stripe Test key (`sk_test_...`) เท่านั้น
