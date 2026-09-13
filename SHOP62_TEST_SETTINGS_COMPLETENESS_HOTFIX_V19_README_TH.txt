SHOP-6.2 Test Settings Completeness Hotfix v19

สาเหตุ:
create_commerce_test_order() เปิด shipping_enabled / return_policy_enabled ชั่วคราว
แต่ fixture รุ่นก่อนกรอกค่าที่ production CHECK constraints ต้องการไม่ครบ
จึงชน commerce_store_settings_return_completeness_check และจะเสี่ยงชน shipping completeness ต่อ

การแก้:
- เพิ่ม forward migration 20260912113000_amphon_shop62_test_settings_completeness.sql
- ตั้งค่า test-only shipping ให้ครบ: TH, rate 0, handling 0-1 วัน, transit 1-3 วัน
- ตั้งค่า test-only return ให้ครบ: FINITE 7 วัน, MAIL_AND_IN_STORE, CUSTOMER_RESPONSIBILITY
- restore ค่าเดิมทุก field หลัง create order สำเร็จ
- test mode trigger bypass ยังคงใช้เฉพาะ private SHOP-6.2 helper
- purchase_enabled production ยังคง false

วิธีใช้:
1) วาง Hotfix ทับโฟลเดอร์เดิม (ไม่ทับ deployment/install.config.ps1)
2) รัน SHOP62-DB-UPGRADE-TEST.bat
3) ควรเห็น migration 20260912113000 ถูก push เพียงตัวเดียว แล้ว contract test PASS
4) หลัง DB test PASS จึงรัน SHOP62-PROVIDER-E2E.bat
