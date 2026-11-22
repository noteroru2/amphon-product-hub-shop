import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const catalog = read('src/config/catalog.ts');
const checks = read('src/config/category-inspection-notes.ts');
const comparison = read('src/components/StockComparison.astro');
const categoryPage = read('src/pages/[category]/index.astro');
const merchant = read('src/lib/merchant-schema.ts');

assert(catalog.includes("key: 'iphones', slug: 'iphones'"), 'iPhone category owner changed');
assert(catalog.includes("iPhone มือสอง พร้อมราคา สภาพและรูปเครื่องจริง"), 'iPhone metadata is not evidence-aligned');
assert(catalog.includes("ตรวจข้อมูลแบตและผลทดสอบเมื่อมีบันทึก"), 'Battery claims must be conditional');
assert(checks.includes('iphones: {'), 'Specific iPhone inspection guidance missing');
for (const term of ['Battery Health', 'Activation Lock', 'Face ID', 'ไม่มีผลตรวจ']) {
  assert(checks.includes(term), 'Missing truthful iPhone guidance: ' + term);
}
assert(categoryPage.includes('categoryInspectionNotes[category.slug]'), 'Inspections not wired into category');
assert(comparison.includes('product.images.length'), 'General SKU image count missing');
assert(comparison.includes('evidence.evidenceImageCount > 0'), 'Diagnostic photos must be separately identified');
assert(comparison.includes('ยังไม่มีรูปผลตรวจแยกจากรูปสินค้า'), 'Missing-evidence disclosure removed');
assert(merchant.includes('merchantAvailabilitySchema'), 'Keep real stock-driven Merchant offers');
console.log('PASS: iPhone title/meta, real images vs diagnostics, check guidance and Merchant safety');
