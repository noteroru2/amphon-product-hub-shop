import type { ProductDraft } from '../types/product'
import { getSpecRows, getSubtypeLabel } from './productSchemas'

export type ContentChannel = 'facebook' | 'marketplace' | 'winnerit' | 'generic'

export interface ContentTemplate {
  id: ContentChannel
  label: string
  shortLabel: string
  description: string
}

export const contentTemplates: ContentTemplate[] = [
  { id: 'facebook', label: 'Facebook', shortLabel: 'Facebook', description: 'โพสต์อ่านง่าย เน้นจุดขายและความน่าเชื่อถือ' },
  { id: 'marketplace', label: 'Facebook Marketplace', shortLabel: 'Marketplace', description: 'ข้อความกระชับ เน้นรุ่น สเปก สภาพ ราคา และคำค้น' },
  { id: 'winnerit', label: 'WINNER IT', shortLabel: 'WINNER IT', description: 'โพสต์ขายในโทนแบรนด์ WINNER IT' },
  { id: 'generic', label: 'ข้อความกลาง', shortLabel: 'ทั่วไป', description: 'ใช้กับ LINE แชต หรือช่องทางอื่น' },
]

function clean(value?: string | number) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function titleOf(draft: ProductDraft) {
  return clean(draft.title) || [draft.brand, draft.model].map(clean).filter(Boolean).join(' ') || 'สินค้าไอทีมือสอง'
}

function formatPrice(value?: number) {
  if (!value) return ''
  return new Intl.NumberFormat('th-TH').format(value)
}

function formatWarranty(value?: string) {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function specRows(draft: ProductDraft) {
  const rows = getSpecRows(draft)
  const subtype = getSubtypeLabel(draft.category, draft.subtype)
  return subtype ? [['ประเภท', subtype] as [string, string], ...rows] : rows
}

function conditionLine(draft: ProductDraft) {
  const parts: string[] = []
  if (draft.conditionPercent) parts.push(`สภาพประมาณ ${draft.conditionPercent}%`)
  if (draft.warrantyUntil) parts.push(`ประกันถึง ${formatWarranty(draft.warrantyUntil)}`)
  return parts.join(' · ')
}

function hashtags(draft: ProductDraft) {
  const tags = ['#สินค้ามือสอง', '#อำพลเทรดดิ้ง']
  if (draft.brand) tags.unshift(`#${draft.brand.replace(/\s+/g, '')}`)
  if (draft.category === 'notebook') tags.unshift('#โน๊ตบุ๊คมือสอง')
  if (draft.category === 'pc') tags.unshift('#คอมมือสอง')
  if (draft.category === 'iphone') tags.unshift('#iPhoneมือสอง')
  if (draft.category === 'smartphone') tags.unshift('#มือถือมือสอง')
  if (draft.category === 'tablet') tags.unshift('#iPadมือสอง')
  if (draft.category === 'camera') tags.unshift('#กล้องมือสอง')
  if (draft.category === 'lens') tags.unshift('#เลนส์มือสอง')
  if (draft.category === 'monitor') tags.unshift('#จอคอมมือสอง')
  if (draft.category === 'gaming') tags.unshift('#เกมมือสอง')
  if (draft.category === 'component') tags.unshift('#อุปกรณ์คอมมือสอง')
  return Array.from(new Set(tags)).join(' ')
}

function facebookContent(draft: ProductDraft) {
  const title = titleOf(draft)
  const specs = specRows(draft)
  const lines = [`🔥 ${title} พร้อมขาย`]

  if (specs.length) {
    lines.push('')
    for (const [label, value] of specs) lines.push(`✅ ${label}: ${value}`)
  }

  const condition = conditionLine(draft)
  if (condition) lines.push('', condition)
  if (draft.defects?.trim()) lines.push('', `📌 ตำหนิ: ${draft.defects.trim()}`)
  if (draft.notes?.trim()) lines.push(`📝 ${draft.notes.trim()}`)
  if (draft.price) lines.push('', `💰 ราคา ${formatPrice(draft.price)} บาท`)

  lines.push('', '✅ ตรวจเช็กก่อนขาย', '✅ แจ้งสภาพและตำหนิตามจริง', '📦 มีบริการจัดส่งทั่วประเทศ', '', 'สนใจสอบถาม/สั่งซื้อ ทักข้อความได้เลยครับ', 'AMPHON TRADING')
  if (draft.sku) lines.push(`รหัสสินค้า: ${draft.sku}`)
  lines.push('', hashtags(draft))
  return lines.join('\n').trim()
}

function marketplaceContent(draft: ProductDraft) {
  const title = titleOf(draft)
  const specs = specRows(draft)
  const lines = [title]
  if (draft.price) lines.push(`ราคา ${formatPrice(draft.price)} บาท`)

  if (specs.length) {
    lines.push('', 'สเปก / รายละเอียด')
    for (const [label, value] of specs) lines.push(`• ${label}: ${value}`)
  }

  const condition = conditionLine(draft)
  if (condition) lines.push('', condition)
  if (draft.defects?.trim()) lines.push(`ตำหนิ: ${draft.defects.trim()}`)
  if (draft.notes?.trim()) lines.push(`หมายเหตุ: ${draft.notes.trim()}`)

  lines.push('', 'ตรวจเช็กก่อนขาย แจ้งสภาพตามจริง', 'จัดส่งได้ทั่วประเทศ / สอบถามเพิ่มเติมทางข้อความ')
  if (draft.sku) lines.push(`รหัสสินค้า: ${draft.sku}`)
  return lines.join('\n').trim()
}

function winnerItContent(draft: ProductDraft) {
  const title = titleOf(draft)
  const specs = specRows(draft)
  const lines = ['⚡ WINNER IT | สินค้าพร้อมขาย', '', `💻 ${title}`]

  if (specs.length) {
    lines.push('')
    for (const [label, value] of specs) lines.push(`• ${label}: ${value}`)
  }

  const condition = conditionLine(draft)
  if (condition) lines.push('', `✨ ${condition}`)
  if (draft.defects?.trim()) lines.push(`📌 ตำหนิ: ${draft.defects.trim()}`)
  if (draft.price) lines.push('', `🔥 ราคา ${formatPrice(draft.price)} บาท`)

  lines.push('', 'มั่นใจก่อนซื้อ', '✓ ตรวจเช็กการใช้งานก่อนขาย', '✓ แจ้งตำหนิตามจริง', '✓ สินค้ามีทั้งใหม่และมือสอง', '📦 จัดส่งทั่วประเทศ', '', 'สนใจสินค้า ทักข้อความสอบถามได้เลย', 'WINNER IT | คอม โน้ตบุ๊ก มือถือ สินค้าไอที')
  if (draft.sku) lines.push(`SKU: ${draft.sku}`)
  return lines.join('\n').trim()
}

function genericContent(draft: ProductDraft) {
  const lines = [titleOf(draft)]
  for (const [label, value] of specRows(draft)) lines.push(`${label}: ${value}`)
  const condition = conditionLine(draft)
  if (condition) lines.push(condition)
  if (draft.defects?.trim()) lines.push(`ตำหนิ: ${draft.defects.trim()}`)
  if (draft.notes?.trim()) lines.push(`หมายเหตุ: ${draft.notes.trim()}`)
  if (draft.price) lines.push(`ราคา: ${formatPrice(draft.price)} บาท`)
  if (draft.sku) lines.push(`รหัสสินค้า: ${draft.sku}`)
  lines.push('สนใจสอบถามเพิ่มเติมได้ครับ')
  return lines.join('\n').trim()
}

export function buildContentForChannel(draft: ProductDraft, channel: ContentChannel) {
  if (channel === 'facebook') return facebookContent(draft)
  if (channel === 'marketplace') return marketplaceContent(draft)
  if (channel === 'winnerit') return winnerItContent(draft)
  return genericContent(draft)
}
