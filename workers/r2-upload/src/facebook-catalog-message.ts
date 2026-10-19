import { facebookPriceMessage } from './facebook-content'

export type PublicFacebookProduct = {
  title: string
  sku: string
  price: number
  specs?: Record<string, unknown> | null
  condition_percent?: number | null
  defects?: string | null
  warranty_until?: string | null
  battery_health_grade?: string | null
  one_quick_sale_price?: number | string | null
  one_dealer_eligibility?: string | null
  one_stock_age_days?: number | null
}

// Only update posts created by our own structured publisher. Never overwrite
// manually composed ad copy or private/internal inventory information.
const heading = /^(🔥 พร้อมส่ง |✨ สินค้าเข้าใหม่ |📣 มีของพร้อมขาย |⭐ รุ่นน่าใช้ |🛒 พร้อมส่งจากร้าน |💻 เครื่องพร้อมใช้งาน |⚡ ของเข้าแล้ว |📌 แนะนำเครื่องนี้ )/u
const priceLine = /^\s*(?:(?:💰|💵|🔥)\s*)?(?:ราคา(?:ขาย|พิเศษ|เพียง)?|ขายเพียง)\s*[:：]?\s*(?:฿\s*)?\d[\d,]*(?:\.\d+)?/u
const managedLine = /^(?:CPU:|GPU:|RAM:|SSD:|จอ:|แบตเตอรี่:|อุปกรณ์:|✅\s*(?:CPU:|GPU:|RAM:|SSD:|จอ:|แบตเตอรี่:|อุปกรณ์:|สภาพประมาณ)|🔎\s*ตำหนิ\/สภาพ:|🛡️\s*มีประกันถึง|✨\s*มีประกันเหลือ|✅\s*จุดเด่นคือยังมีประกันเหลือ|🛡️\s*ยังอยู่ในระยะประกัน|⚡\s*Clearance|🤝\s*ร้านค้า\/Dealer|🔥\s*Quick Sale|🔋\s*สุขภาพแบตเตอรี่:)/u

export function publicFacebookPrice(p: PublicFacebookProduct): number {
  const age = Number(p.one_stock_age_days || 0)
  const quick = Number(p.one_quick_sale_price || 0)
  return quick > 0 && (p.one_dealer_eligibility === 'CLEARANCE' || age > 60 || (age > 30 && age <= 45))
    ? quick : Number(p.price)
}

function thaiWarranty(value: string): string | null {
  const t = new Date(value.slice(0,10) + 'T12:00:00Z')
  if (!Number.isFinite(t.getTime()) || t.getTime() <= Date.now()) return null
  return '🛡️ มีประกันถึง ' + t.toLocaleDateString('th-TH', {
    day:'numeric', month:'long', year:'numeric', timeZone:'Asia/Bangkok',
  })
}

export function facebookCatalogMessage(original: string, p: PublicFacebookProduct): {message:string;changed:boolean} {
  const input = String(original || '')
  if (/^\s*#ขายแล้ว/u.test(input)) throw new Error('FACEBOOK_CATALOG_SOLD_POST')
  const lines = input.split(/\r?\n/u)
  const match = lines[0]?.match(heading)
  if (!match || !p.title?.trim()) throw new Error('FACEBOOK_CATALOG_MANUAL_POST_REVIEW_REQUIRED')
  const price = publicFacebookPrice(p)
  const patchedPrice = facebookPriceMessage(input,price).message
  const matchingPriceLines = patchedPrice.split('\n').filter(x => priceLine.test(x))
  if (matchingPriceLines.length !== 1) throw new Error('FACEBOOK_CATALOG_PRICE_REVIEW_REQUIRED')

  const metadata: string[] = []
  const age = Number(p.one_stock_age_days || 0)
  if (p.one_dealer_eligibility === 'CLEARANCE' || age > 60)
    metadata.push('⚡ Clearance — ราคาพิเศษเพื่อหมุนสต๊อก')
  else if (age > 45)
    metadata.push('🤝 ร้านค้า/Dealer สนใจรับไปขายต่อ ทักสอบถามราคาส่งได้')
  else if (age > 30)
    metadata.push('🔥 Quick Sale — ปรับราคาพิเศษสำหรับรอบนี้')

  const specs = p.specs || {}
  for (const [key,label] of [['cpu','CPU'],['gpu','GPU'],['ram','RAM'],['ssd','SSD']] as const) {
    const v = specs[key]
    if (typeof v === 'string' && v.trim()) metadata.push(label + ': ' + v.trim())
  }
  const screen = specs.screen_size
  if (screen != null && String(screen).trim()) {
    const r = specs.resolution == null ? '' : (' ' + String(specs.resolution).trim())
    metadata.push('จอ: ' + String(screen).trim() + r)
  }
  for (const [key,label] of [['battery','แบตเตอรี่'],['charger','อุปกรณ์']] as const) {
    const v = specs[key]
    if (typeof v === 'string' && v.trim()) metadata.push(label + ': ' + v.trim())
  }
  const grades:Record<string,string> = {LOW:'เสื่อม',GOOD:'เก็บไฟได้',VERY_GOOD:'เก็บไฟได้ดี'}
  if (p.battery_health_grade && grades[p.battery_health_grade])
    metadata.push('🔋 สุขภาพแบตเตอรี่: ' + grades[p.battery_health_grade])
  if (Number(p.condition_percent) > 0)
    metadata.push('✅ สภาพประมาณ ' + Number(p.condition_percent) + '%')
  if (p.defects?.trim()) metadata.push('🔎 ตำหนิ/สภาพ: ' + p.defects.trim())
  const warranty = p.warranty_until && thaiWarranty(p.warranty_until)
  if (warranty) metadata.push(warranty)
  metadata.push(matchingPriceLines[0])

  const headingText = match[1] + String(p.title).trim()
  const remaining = patchedPrice.split('\n').slice(1)
    .filter(line => !managedLine.test(line.trim()) && !priceLine.test(line))
  // Strip blank lines immediately after the heading. Stable across repeated runs.
  while (remaining.length && !remaining[0].trim()) remaining.shift()
  const message = [headingText,'',...metadata,'',...remaining].join('\n')
  return {message,changed:message!==input}
}
