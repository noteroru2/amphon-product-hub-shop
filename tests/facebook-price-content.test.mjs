import test from 'node:test'
import assert from 'node:assert/strict'
import { facebookPriceMessage } from '../workers/r2-upload/src/facebook-content.ts'

const sample = [
  '🔥 Lenovo LOQ i5-13450HX / RTX3050',
  '✅ CPU: Intel Core i5-13450HX',
  '✅ RAM: 16GB',
  '✅ SSD 512GB',
  '✅ มีประกันถึง 20-10-2027',
  '💰 ราคา 21,500 บาท',
  '🔗 ดูรายละเอียด: https://shop.amphon.co.th/product/AT-NB-2610-500001',
  '#โน๊ตบุ๊คมือสอง #อำพลเทรดดิ้ง',
].join('\n')

test('price edit retains entire original sales post', () => {
  const { message, changed } = facebookPriceMessage(sample, 19_900)
  assert.equal(changed, true)
  assert.ok(message.includes('💰 ราคา 19,900 บาท'))
  assert.ok(!message.includes('ราคา 21,500 บาท'))
  assert.ok(message.includes('CPU: Intel Core i5-13450HX'))
  assert.ok(message.includes('20-10-2027'))
  assert.ok(message.includes('AT-NB-2610-500001'))
  assert.ok(message.includes('#อำพลเทรดดิ้ง'))
  assert.equal(message.split('\n').length, sample.split('\n').length)
})

test('same price is idempotent and A-B-A can return to prior price', () => {
  const changed = facebookPriceMessage(sample, 19_900).message
  assert.equal(facebookPriceMessage(changed, 19_900).changed, false)
  assert.equal(facebookPriceMessage(changed, 21_500).message, sample)
})

test('keep common price label variants and suffix', () => {
  for (const [src, wanted] of [
    ['ราคา: ฿12,000', 'ราคา: ฿13,990'],
    ['ราคาพิเศษ 12,000 บาท', 'ราคาพิเศษ 13,990 บาท'],
    ['ขายเพียง 12,000.-', 'ขายเพียง 13,990.-'],
    ['💰 ราคา 12,000 บาท (ต่อรองได้)', '💰 ราคา 13,990 บาท (ต่อรองได้)'],
  ]) {
    assert.equal(facebookPriceMessage(src, 13_990).message, wanted)
  }
})

test('protect sold, ambiguous and unrecognized history', () => {
  assert.throws(() => facebookPriceMessage('#ขายแล้วครับ #ขอบคุณลูกค้าทุกท่าน\nราคา XXX', 9900), /FACEBOOK_PRICE_SOLD_POST/)
  assert.throws(() => facebookPriceMessage('ราคา 8,000 บาท\nราคา 9,000 บาท', 9900), /FACEBOOK_PRICE_AMBIGUOUS/)
  assert.throws(() => facebookPriceMessage('MacBook M1 มือสอง\nโทรสอบถาม', 9900), /FACEBOOK_PRICE_LINE_NOT_FOUND/)
  assert.throws(() => facebookPriceMessage('ราคา 12,500 บาท', -1), /FACEBOOK_PRICE_INVALID/)
})
