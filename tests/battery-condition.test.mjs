import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/productSchemas.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { productSchemas, getSmartFields, getSpecRows } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const expected = ['เสื่อม', 'เก็บไฟได้', 'เก็บไฟได้ดี']

test('all battery fields offer exactly the same three conditions without percentage input', () => {
  let checked = 0
  for (const schema of productSchemas) {
    for (const subtype of schema.subtypes) {
      const draft = { category: schema.key, subtype: subtype.value, specs: {} }
      const battery = getSmartFields(draft).find(field => field.key === 'battery')
      if (!battery) continue
      checked++
      assert.equal(battery.label, 'สุขภาพแบตเตอรี่')
      assert.equal(battery.type, 'select')
      assert.equal(battery.placeholder, undefined)
      assert.deepEqual(battery.options, expected)
      for (const value of expected) {
        assert.deepEqual(getSpecRows({ ...draft, specs: { battery: value } }), [['สุขภาพแบตเตอรี่', value]])
      }
    }
  }
  assert.ok(checked >= 5)
})

test('editing a legacy percentage does not invent a battery condition or discard it', () => {
  assert.deepEqual(getSpecRows({ category: 'notebook', subtype: 'general', specs: { battery: '68%' } }), [['สุขภาพแบตเตอรี่', '68%']])
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.ok(app.includes('ข้อมูลเดิม — กรุณาเลือกสภาพหลังตรวจแบตเตอรี่'))
})
