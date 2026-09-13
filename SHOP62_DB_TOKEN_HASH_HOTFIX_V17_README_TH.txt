SHOP-6.2 DB TOKEN HASH HOTFIX v17

สาเหตุ:
- Migration 20260912090000 ลงสำเร็จแล้ว
- Contract test ล้มใน set_shop62_test_token() เพราะ security-definer function ใช้ search_path=''
- digest() มาจาก pgcrypto และตำแหน่ง schema ของ extension ไม่ควรถูกสมมติ

การแก้:
- ใช้ PostgreSQL built-in pg_catalog.sha256(bytea) แทน digest()
- เพิ่ม forward migration:
  20260912103000_amphon_shop62_token_hash_portability.sql
- ไม่ repair / ไม่ rollback migration 20260912090000
- purchase_enabled ยังคง false

วิธีใช้:
1) แตก ZIP วางทับโฟลเดอร์เดิม
2) กด SHOP62-DB-UPGRADE-TEST.bat อีกครั้ง
3) migration list ควรเห็น 20260912090000 ทั้ง Local/Remote และ 20260912103000 เป็น Local pending
4) db push จะลงเฉพาะ migration 20260912103000
5) contract test จะถูก rerun และจบด้วย ROLLBACK
6) เมื่อ PASS ค่อยไป SHOP62-PROVIDER-E2E.bat
