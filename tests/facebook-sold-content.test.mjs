import test from 'node:test'
import assert from 'node:assert/strict'
import {facebookSoldMessage} from '../workers/r2-upload/src/facebook-content.ts'
test('preserve specifications, replace monetary values, prepend exact sold header',()=>{
 const original='🔥 i5-12400F RTX 3070\nRAM 16GB SSD 1TB\n💰 ราคา 21,500 บาท\nประกันถึง 02-04-2028\nดูรายละเอียด: https://shop.amphon.co.th/product/AT-PC-2610-000001'
 const result=facebookSoldMessage(original,{})
 assert.ok(result.startsWith('#ขายแล้วครับ #ขอบคุณลูกค้าทุกท่าน\n\n'))
 assert.ok(result.includes('ราคา XXX'))
 assert.ok(result.includes('i5-12400F RTX 3070'))
 assert.ok(result.includes('02-04-2028'))
 assert.ok(!result.includes('21,500'))
 assert.equal(facebookSoldMessage(result,{}),result)
})
test('handle old sold message and currency variants',()=>{
 for(const value of ['ราคา: 14900','ขายเพียง ฿12,000','ราคา 15,900.-','ลดเหลือ 9,500 บาท']){
  const result=facebookSoldMessage(value,{})
  assert.ok(result.includes('XXX'));assert.ok(!/\d/.test(result))
 }
 assert.equal(facebookSoldMessage('ขายแล้ว · MacBook M1',{}),'#ขายแล้วครับ #ขอบคุณลูกค้าทุกท่าน\n\nขายแล้ว · MacBook M1\nราคา XXX')
})
