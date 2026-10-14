import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function compile(path, dependencies = {}) {
  const source = readFileSync(new URL(`../src/lib/${path}.ts`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  new Function('require', 'exports', compiled)((key) => {
    if (!(key in dependencies)) throw new Error(`Unexpected dependency: ${key}`)
    return dependencies[key]
  }, exports)
  return exports
}

const dates = compile('warrantyDate')

test('canonical expiry dates accept Gregorian and Buddhist input consistently', () => {
  assert.equal(dates.canonicalWarrantyDate('2028-06-15'), '2028-06-15')
  assert.equal(dates.canonicalWarrantyDate('2571-06-15'), '2028-06-15')
  assert.equal(dates.canonicalWarrantyDate('2570-04-05'), '2027-04-05')
  assert.equal(dates.canonicalWarrantyDate(''), null)
  assert.equal(dates.normalizeWarrantyDateInput('2571-06-15'), '2028-06-15')
  assert.equal(dates.normalizeWarrantyDateInput('2028-06-15'), '2028-06-15')
})

test('Buddhist display never double-adds 543 years', () => {
  assert.equal(dates.formatWarrantyThaiDate('2571-06-15'), '15 มิ.ย. 2571')
  assert.equal(dates.formatWarrantyThaiDate('2028-06-15'), '15 มิ.ย. 2571')
  assert.equal(dates.formatWarrantyThaiDate('2570-04-05'), '5 เม.ย. 2570')
})

test('reject impossible dates and grossly incorrect years', () => {
  for (const invalid of ['3114-06-15', '9999-01-01', '2026-02-30', '2027-13-01', 'not a date', '1990-01-01']) {
    assert.throws(() => dates.canonicalWarrantyDate(invalid), /วันหมดประกัน|ปีที่หมดประกัน/)
    assert.equal(dates.formatWarrantyThaiDate(invalid), null)
  }
  assert.equal(dates.canonicalWarrantyDate('2028-02-29'), '2028-02-29')
})

test('Facebook caption shows correct Thai expiry even with old BE-year data', () => {
  const templates = compile('contentTemplates', {
    './productSchemas': { getSpecRows: () => [], getSubtypeLabel: () => '' },
    './shopeePricing': { shopeeManualPrice: (value) => value },
    './warrantyDate': dates,
  })
  const draft = { sku: 'AT-IT-2610-500011', title: 'Lenovo LOQ', category: 'notebook', brand: 'Lenovo', specs: {}, images: [], price: 21900, warrantyUntil: '2571-06-15' }
  const caption = templates.buildContentForChannel(draft, 'facebook')
  assert.match(caption, /ประกันถึง 15 มิ.ย. 2571/)
  assert.doesNotMatch(caption, /3114/)
  assert.match(templates.buildContentForChannel({ ...draft, warrantyUntil: '3114-06-15' }, 'facebook'), /วันหมดประกันรอการตรวจสอบ/)
})

test('sales package blocks bad warranty instead of publishing fake warranty claims', () => {
  const builder = compile('salesPostPackage', { './warrantyDate': dates })
  const draft = { sku: 'TEST', title: 'Laptop', category: 'notebook', brand: 'Lenovo', price: 21900, specs: {}, images: [{ publicUrl: 'https://example.test/product.jpg', order: 0 }], warrantyUntil: '2571-06-15' }
  const context = { publishedToShop: false }
  const good = builder.buildSalesPostPackage(draft, [], context)
  assert.equal(good.warranty, 'ประกันถึง 15 มิ.ย. 2571')
  assert.equal(builder.validateSalesPostPackage(good).ready, true)
  const invalid = builder.buildSalesPostPackage({ ...draft, warrantyUntil: '3114-06-15' }, [], context)
  assert.equal(invalid.warranty, 'วันหมดประกันรอการตรวจสอบ')
  assert.equal(builder.validateSalesPostPackage(invalid).ready, false)
})

test('save path canonicalizes warranty before writing to database', () => {
  const backend = readFileSync(new URL('../src/lib/backend.ts', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(backend, /warranty_until: canonicalWarrantyDate\(draft\.warrantyUntil\)/)
  assert.match(app, /value=\{normalizeWarrantyDateInput\(draft\.warrantyUntil\)\}/)
})
