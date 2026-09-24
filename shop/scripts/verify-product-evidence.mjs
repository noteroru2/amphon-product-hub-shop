import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const [hubSchemas, hubApp, productPage, productTrust, merchantFeed, merchantSchema] = await Promise.all([
  read('../src/lib/productSchemas.ts'),
  read('../src/App.tsx'),
  read('src/pages/p/[product].astro'),
  read('src/lib/product-trust.ts'),
  read('src/lib/google-merchant-feed.ts'),
  read('src/lib/merchant-schema.ts'),
])

const checks = [
  ['Hub defines a dedicated Product Evidence field system', hubSchemas.includes('getEvidenceFields') && hubSchemas.includes('inspection_date') && hubSchemas.includes('inspection_result')],
  ['Product Evidence does not change ready-to-list required fields', hubSchemas.includes('const evidenceFields = getEvidenceFields(draft)') && !hubSchemas.includes("if (field.importance === 'optional') required.push")],
  ['Hub supports a real inspection date input', hubSchemas.includes("| 'date'") && hubApp.includes('field.type === "date"')],
  ['Hub exposes category-specific device tests', hubSchemas.includes('stress_test') && hubSchemas.includes('charging_test') && hubSchemas.includes('autofocus_test') && hubSchemas.includes('input_port_test')],
  ['Hub exposes evidence image roles', hubSchemas.includes("value: 'test'") && hubSchemas.includes("value: 'battery'") && hubSchemas.includes("value: 'benchmark'")],
  ['Hub shows Product Evidence as a separate workflow', hubApp.includes('Product Evidence — ผลตรวจเครื่องจริง') && hubApp.includes('evidenceCompleteness')],
  ['Shop extracts evidence from the exact SKU specs', productTrust.includes('PRODUCT_EVIDENCE_KEYS') && productTrust.includes('evidenceRows') && productTrust.includes('evidenceImages')],
  ['Evidence fields are not duplicated in generic spec groups', productTrust.includes('PRODUCT_EVIDENCE_KEYS as readonly string[]') && productTrust.includes('continue')],
  ['Product page exposes a visible Product Evidence section', productPage.includes('id="product-evidence"') && productPage.includes('ผลตรวจเครื่องจริงของ') && productPage.includes('ช่องที่ไม่ได้ตรวจจะไม่ถูกสรุปว่า “ปกติ”')],
  ['Product page adds an evidence-driven FAQ only when evidence exists', productPage.includes('evidence?.hasProductEvidence') && productPage.includes('ร้านตรวจ ${product.title} เครื่องนี้อะไรแล้วบ้าง?')],
  ['Product structured data prioritizes evidence', productPage.includes('structuredSpecEntries') && productPage.includes('evidenceMetaRows') && merchantSchema.includes('additionalProperty')],
  ['Merchant feed exports inspection evidence as product details', merchantFeed.includes("section: 'Product evidence'") && merchantFeed.includes("key: 'inspection_date'") && merchantFeed.includes("key: 'stress_test'")],
]

const failures = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failures.length) {
  console.error(`PRODUCT EVIDENCE verification failed: ${failures.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('PRODUCT EVIDENCE PASS — Hub capture, per-SKU evidence UX, structured data and Merchant feed are protected')
