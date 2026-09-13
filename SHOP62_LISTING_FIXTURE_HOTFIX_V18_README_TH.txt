SHOP-6.2 Listing Fixture Hotfix v18

สาเหตุ:
- การ insert product_publications(channel=website,status=published) มี trigger product_publications_ensure_commerce_listing
  ที่สร้าง commerce_listings ให้ทันที
- contract test / provider E2E รุ่นก่อนจึง POST/INSERT commerce_listings ซ้ำ product_id เดิม
  และชน unique constraint commerce_listings_product_id_key

การแก้ไข:
- DB contract test เปลี่ยนเป็น UPDATE listing ที่ trigger สร้างแล้ว และ assert ว่ามี 1 แถว
- Provider E2E เปลี่ยนจาก POST commerce_listings เป็น PATCH listing ที่ trigger สร้างแล้ว
- เพิ่ม static regression guard ใน verify:shop62
- ไม่ต้องมี migration ใหม่ เพราะ production schema ถูกต้องอยู่แล้ว; bug อยู่ใน test fixture harness
- purchase_enabled ยังคง false
