import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source=readFileSync(new URL('../src/facebook-warranty-repair.ts',import.meta.url),'utf8')
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const { correctFacebookWarrantyText, WARRANTY_POST_REPAIRS }=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

test('exactly four targeted existing page post IDs; never adds a new post',()=>{
  assert.equal(WARRANTY_POST_REPAIRS.length,4)
  assert.equal(new Set(WARRANTY_POST_REPAIRS.map(x=>x.postId)).size,4)
  assert.deepEqual(new Set(WARRANTY_POST_REPAIRS.map(x=>x.sku)),new Set(['AT-IT-2610-500011','AT-IT-2610-500005']))
})

test('corrects 3114 in warranty only, preserving rest of post verbatim',()=>{
  const original='🔥 Lenovo LOQ พร้อมขาย\n✅ CPU: i5-13450HX\nสภาพประมาณ 100% · ประกันถึง 15 มิ.ย. 3114\n💰 ราคา 21,900 บาท\n#3114 ไม่เกี่ยวกับประกัน'
  const output=correctFacebookWarrantyText(original,'3114','2571')
  assert.equal(output.changed,true)
  assert.equal(output.message,original.replace('15 มิ.ย. 3114','15 มิ.ย. 2571'))
})

test('corrects full-month auto-publish style warranty without altering other text',()=>{
  const original='💻 Laptop\n🛡️ มีประกันถึง 5 เมษายน 3113\n✨ มีประกันเหลือ\n💰 ราคา 19,900 บาท'
  const actual=correctFacebookWarrantyText(original,'3113','2570')
  assert.equal(actual.message,original.replace('5 เมษายน 3113','5 เมษายน 2570'))
  assert.equal(actual.changed,true)
})

test('already corrected posts are idempotent',()=>{
  const message='🛡️ มีประกันถึง 15 มิถุนายน 2571\nสินค้าสภาพดี'
  assert.deepEqual(correctFacebookWarrantyText(message,'3114','2571'),{message,changed:false})
})

test('refuse edits when original lacks a warranty/year match',()=>{
  assert.throws(()=>correctFacebookWarrantyText('🔥 พร้อมขาย 3114 บาท','3114','2571'),/YEAR_NOT_PRESENT/)
  assert.throws(()=>correctFacebookWarrantyText('','3114','2571'),/MESSAGE_EMPTY/)
  assert.throws(()=>correctFacebookWarrantyText('ประกันถึง 31141','3114','2571'),/YEAR_NOT_PRESENT/)
})
