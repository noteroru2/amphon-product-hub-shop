import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from '../workers/r2-upload/node_modules/typescript/lib/typescript.js'

const priceSrc=readFileSync(new URL('../workers/r2-upload/src/facebook-content.ts',import.meta.url),'utf8')
const catalogSrc=readFileSync(new URL('../workers/r2-upload/src/facebook-catalog-message.ts',import.meta.url),'utf8')
  .replace("import { facebookPriceMessage } from './facebook-content'",'')
const options={module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}
const compiled=[priceSrc,catalogSrc].map(src=>ts.transpileModule(src,{compilerOptions:options}).outputText).join('\n')
const {facebookCatalogMessage,publicFacebookPrice}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))

const live=[
  '🔥 พร้อมส่ง PC i5 รุ่นเดิม','',
  'CPU: Intel i5 เดิม','GPU: RTX3050',
  '✅ สภาพประมาณ 90%','🔎 ตำหนิ/สภาพ: รอยเดิม','',
  '💰 ราคา 22,900 บาท',
  '📸 รูปสินค้าจริงทุกภาพ',
  '💬 สนใจทักเพจ',
  '🔗 ดูรายละเอียด: https://shop.amphon.co.th/product/AT-IT-2610-500012',
  '#อำพลเทรดดิ้ง',
].join('\n')
const product={
  sku:'AT-IT-2610-500012',title:'PC i5 รุ่นใหม่',price:19_900,
  specs:{cpu:'Intel i5 ใหม่',gpu:'RTX 4060',ram:'32GB',cost:12000},
  condition_percent:95,defects:'มีรอยที่ฝา',warranty_until:null,
}

test('a verified live post is edited in place for title/specs/condition/defect/price',()=>{
  const output=facebookCatalogMessage(live,product)
  assert.equal(output.changed,true)
  for(const part of ['🔥 พร้อมส่ง PC i5 รุ่นใหม่','CPU: Intel i5 ใหม่','GPU: RTX 4060',
    'RAM: 32GB','✅ สภาพประมาณ 95%','🔎 ตำหนิ/สภาพ: มีรอยที่ฝา','💰 ราคา 19,900 บาท',
    '#อำพลเทรดดิ้ง','https://shop.amphon.co.th/product/AT-IT-2610-500012'])
      assert.ok(output.message.includes(part),part)
  assert.ok(!output.message.includes('RTX3050'))
  assert.ok(!output.message.includes('22,900'))
  assert.ok(!output.message.includes('12000'))
  assert.equal(facebookCatalogMessage(output.message,product).changed,false)
})

test('clear removed specs and warranty, retain original CTA and hashtags',()=>{
 const old=live.replace('GPU: RTX3050','GPU: RTX3050\n🛡️ มีประกันถึง 1 มกราคม 2570')
 const next=facebookCatalogMessage(old,{...product,specs:{cpu:'Intel i5 ใหม่'},defects:null})
 assert.ok(!next.message.includes('GPU:'))
 assert.ok(!next.message.includes('มีประกันถึง'))
 assert.ok(!next.message.includes('ตำหนิ/สภาพ:'))
 assert.ok(next.message.includes('💬 สนใจทักเพจ'))
 assert.equal(facebookCatalogMessage(next.message,{...product,specs:{cpu:'Intel i5 ใหม่'},defects:null}).changed,false)
})

test('quick sale is public only in the intended turnover cohorts',()=>{
 assert.equal(publicFacebookPrice({...product,one_stock_age_days:20,one_quick_sale_price:16000}),19900)
 assert.equal(publicFacebookPrice({...product,one_stock_age_days:35,one_quick_sale_price:16000}),16000)
 assert.equal(publicFacebookPrice({...product,one_stock_age_days:50,one_quick_sale_price:16000}),19900)
 assert.equal(publicFacebookPrice({...product,one_dealer_eligibility:'CLEARANCE',one_quick_sale_price:16000}),16000)
})

test('never rewrite sold posts or unknown manually written content',()=>{
 assert.throws(()=>facebookCatalogMessage('#ขายแล้วครับ\nราคา XXX',product),/SOLD_POST/)
 assert.throws(()=>facebookCatalogMessage('ประกาศขายเองครับ\nราคา 10,000 บาท',product),/MANUAL_POST_REVIEW_REQUIRED/)
 assert.throws(()=>facebookCatalogMessage('🔥 พร้อมส่ง MacBook\nราคาสอบถามได้',product),/FACEBOOK_PRICE_LINE_NOT_FOUND/)
})
