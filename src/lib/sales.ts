import type { ProductDraft } from '../types/product'
import { buildContentForChannel } from './contentTemplates'
import { getSpecRows, getSubtypeLabel } from './productSchemas'
import { MAX_ZIP_EXPORT_BYTES, prepareProductImageFiles } from './productImageExport'

function clean(value?: string | number) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
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

function titleOf(draft: ProductDraft) {
  return clean(draft.title) || [draft.brand, draft.model].map(clean).filter(Boolean).join(' ') || 'สินค้าไอทีมือสอง'
}

function specRows(draft: ProductDraft) {
  return getSpecRows(draft)
}

export function buildSpecText(draft: ProductDraft) {
  const lines = [titleOf(draft)]
  if (draft.sku) lines.push(`SKU: ${draft.sku}`)
  lines.push('')
  const subtype = getSubtypeLabel(draft.category, draft.subtype)
  if (subtype) lines.push(`ประเภท: ${subtype}`)

  for (const [label, value] of specRows(draft)) lines.push(`${label}: ${value}`)
  if (draft.conditionPercent) lines.push(`สภาพ: ${draft.conditionPercent}%`)
  if (draft.warrantyUntil) lines.push(`ประกันถึง: ${formatWarranty(draft.warrantyUntil)}`)
  if (draft.defects) lines.push(`ตำหนิ: ${draft.defects.trim()}`)
  if (draft.notes) lines.push(`หมายเหตุ: ${draft.notes.trim()}`)
  if (draft.price) lines.push(`ราคาขาย: ${formatPrice(draft.price)} บาท`)

  return lines.join('\n').trim()
}

export function buildSalesContent(draft: ProductDraft) {
  return buildContentForChannel(draft, 'facebook')
}

function safeBaseName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 90) || 'product'
}

export async function downloadProductZip(draft: ProductDraft) {
  const [{ strToU8, zipSync }, files] = await Promise.all([
    import('fflate'),
    prepareProductImageFiles(draft, { maxTotalBytes: MAX_ZIP_EXPORT_BYTES }),
  ])
  const entries: Record<string, Uint8Array> = {}
  for (const file of files) entries[file.name] = new Uint8Array(await file.arrayBuffer())
  entries['spec.txt'] = strToU8(buildSpecText(draft))
  entries['content-facebook.txt'] = strToU8(buildContentForChannel(draft, 'facebook'))
  entries['content-marketplace.txt'] = strToU8(buildContentForChannel(draft, 'marketplace'))
  entries['content-shopee.txt'] = strToU8(buildContentForChannel(draft, 'shopee'))
  entries['content-winner-it.txt'] = strToU8(buildContentForChannel(draft, 'winnerit'))
  entries['content-generic.txt'] = strToU8(buildContentForChannel(draft, 'generic'))
  entries['sales-content.txt'] = strToU8(buildSalesContent(draft))

  const zipped = zipSync(entries, { level: 6 })
  const zipBuffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  const blob = new Blob([zipBuffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeBaseName(draft.sku || titleOf(draft))}.zip`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const ok = document.execCommand('copy')
  textarea.remove()
  if (!ok) throw new Error('คัดลอกไม่สำเร็จ')
}
