import { compressImage } from './image'
import { supabase } from './supabase'

export type EvidenceKind = 'purchase' | 'sale'
export type EvidenceStatus = 'DRAFT' | 'APPROVED' | 'ARCHIVED'

export interface TradeEvidenceImage {
  id: string
  evidence_id: string
  storage_path: string
  sort_order: number
  alt_text: string
  approved_for_public: boolean
}

export interface TradeEvidence {
  id: string
  kind: EvidenceKind
  occurred_on: string
  title: string
  category: string
  brand: string | null
  model: string | null
  specs_text: string | null
  condition_text: string | null
  story: string
  service_details: string | null
  city: string | null
  related_sku: string | null
  internal_reference: string | null
  website_text: string | null
  facebook_text: string | null
  show_price: boolean
  public_price: number | null
  deal_code: string | null
  quantity: number
  transaction_amount: number | null
  repair_cost: number
  shipping_cost: number
  platform_fee: number
  other_direct_cost: number
  customer_channel: 'UNKNOWN' | 'GOOGLE' | 'FACEBOOK' | 'WALK_IN' | 'REPEAT' | 'REFERRAL' | 'OTHER'
  channel_evidence: 'UNKNOWN' | 'CUSTOMER_STATED' | 'DOCUMENTED'
  source_site_id?: string | null
  source_page_path?: string | null
  channel_evidence_ref: string | null
  verification_reference: string | null
  transaction_verified: boolean
  transaction_verified_at: string | null
  transaction_verified_by: string | null
  permission_confirmed: boolean
  privacy_reviewed: boolean
  status: EvidenceStatus
  created_at: string
  updated_at: string
  approved_at: string | null
  trade_evidence_images: TradeEvidenceImage[]
}

export type TradeEvidenceInput = Pick<TradeEvidence,
  'kind' | 'occurred_on' | 'title' | 'category' | 'brand' | 'model' |
  'specs_text' | 'condition_text' | 'story' | 'service_details' |
  'city' | 'related_sku' | 'internal_reference' | 'website_text' |
  'facebook_text' | 'show_price' | 'public_price' | 'permission_confirmed' | 'privacy_reviewed' |
  'deal_code' | 'quantity' | 'transaction_amount' | 'repair_cost' | 'shipping_cost' |
  'platform_fee' | 'other_direct_cost' | 'customer_channel' | 'channel_evidence' |
  'channel_evidence_ref' | 'verification_reference' | 'source_site_id' | 'source_page_path'>

export interface TradeEvidenceEconomics {
  purchase_evidence_id: string
  sale_evidence_id: string
  deal_code: string
  title: string
  category: string
  quantity: number
  purchased_on: string
  sold_on: string
  buyer_acquisition_channel: TradeEvidence['customer_channel']
  buyer_channel_evidence: TradeEvidence['channel_evidence']
  acquisition_amount: number
  repair_cost: number
  inbound_shipping_cost: number
  other_acquisition_cost: number
  sale_amount: number
  outbound_shipping_cost: number
  sale_platform_fee: number
  other_selling_cost: number
  realized_gross_profit_after_direct_costs: number
  seo_attribution_proven: false
}

function client() {
  if (!supabase) throw new Error('ไม่ได้เชื่อมต่อ Supabase')
  return supabase
}

export function normalizedSourcePath(value: string) {
  const path = value.trim()
  if (!path.startsWith('/') || path.startsWith('//') || /[?#\\\s]/.test(path))
    throw new Error('กรอกเฉพาะพาธที่ขึ้นต้นด้วย / โดยตัดข้อความหลัง ? และ # ออก')
  const normalized = new URL(path, 'https://example.com').pathname.replace(/\/+$/, '') || '/'
  if (normalized.length > 2048) throw new Error('พาธยาวเกิน 2048 ตัวอักษร')
  return normalized
}

export async function listSourceSites() {
  const { data, error } = await client().from('commerce_seo_sites').select('id,origin').eq('enabled',true).order('origin')
  if (error) throw error
  return (data || []) as {id:string; origin:string}[]
}

export async function countVerifiedPageTrades(site: string, path: string, kind: EvidenceKind) {
  const {count,error} = await client().from('trade_evidence').select('id',{head:true,count:'exact'})
    .eq('transaction_verified',true).eq('source_site_id',site).eq('source_page_path',normalizedSourcePath(path)).eq('kind',kind)
  if (error || count == null) throw new Error(error?.message || 'อ่านยอดดีลไม่ได้')
  return count
}

function ensureSafe(input: TradeEvidenceInput) {
  if (input.title.trim().length < 3) throw new Error('กรอกชื่อรุ่นหรือชื่อสินค้าอย่างน้อย 3 ตัวอักษร')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurred_on)) throw new Error('วันที่ไม่ถูกต้อง')
  if (input.deal_code && !/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(input.deal_code.trim())) {
    throw new Error('รหัสดีลต้องยาว 3–80 ตัวอักษร และใช้เฉพาะ A–Z, 0–9, จุด, ขีด หรือขีดล่าง')
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 100000)
    throw new Error('จำนวนสินค้าต้องเป็นจำนวนเต็มบวก')
  if ([input.transaction_amount,input.repair_cost,input.shipping_cost,input.platform_fee,
    input.other_direct_cost].some(x => x != null && (!Number.isFinite(x) || x < 0))) {
    throw new Error('จำนวนเงินต้องไม่ติดลบและเป็นตัวเลขที่ถูกต้อง')
  }
  if (input.channel_evidence === 'DOCUMENTED' && (!input.channel_evidence_ref?.trim()
      || input.channel_evidence_ref.trim().length < 4)) {
    throw new Error('หากเลือกมีหลักฐานช่องทาง ต้องใส่รหัสหลักฐานอ้างอิงอย่างน้อย 4 ตัวอักษร')
  }
  if (input.channel_evidence === 'DOCUMENTED' && input.customer_channel === 'UNKNOWN') {
    throw new Error('เลือกช่องทางที่มีหลักฐานก่อน')
  }
  if (input.show_price && (input.public_price == null || !Number.isFinite(input.public_price) || input.public_price < 0)) {
    throw new Error('กรอกราคาที่อนุญาตให้เปิดเผย หรือยกเลิกการแสดงราคา')
  }
}

export async function listTradeEvidence(): Promise<TradeEvidence[]> {
  const { data, error } = await client()
    .from('trade_evidence')
    .select('*,trade_evidence_images(*)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data || []) as TradeEvidence[]
}

export async function saveTradeEvidence(input: TradeEvidenceInput, id?: string): Promise<string> {
  ensureSafe(input)
  // Every edit creates a new draft; approval is always a separate, deliberate action.
  const payload = { ...input, title: input.title.trim(), story: input.story.trim(),
    deal_code: input.deal_code?.trim().toUpperCase() || null,
    verification_reference: input.verification_reference?.trim() || null,
    channel_evidence_ref: input.channel_evidence_ref?.trim() || null,
    source_site_id: input.source_site_id || null,
    source_page_path: input.source_page_path?.trim() ? normalizedSourcePath(input.source_page_path) : null,
    status: 'DRAFT' }
  const query = id
    ? client().from('trade_evidence').update(payload).eq('id', id)
    : client().from('trade_evidence').insert(payload)
  const { data, error } = await query.select('id').single()
  if (error) throw error
  return data.id as string
}

// Owner-only DB guard validates receipt/reference and at least one private image.
export async function verifyTradeTransaction(id: string, verified: boolean): Promise<void> {
  const { error } = await client().from('trade_evidence')
    .update({ transaction_verified: verified }).eq('id', id)
  if (error) throw error
}

// This view only returns whole-quantity purchase+sale matches verified by owner.
// It is not a ranking or Google acquisition report; do not expose in public copy.
export async function listTradeEvidenceEconomics(): Promise<TradeEvidenceEconomics[]> {
  const { data, error } = await client().from('trade_evidence_economics_v')
    .select('*').order('sold_on', { ascending: false }).limit(2000)
  if (error) throw error
  return (data || []) as TradeEvidenceEconomics[]
}

export async function changeTradeEvidenceStatus(id: string, status: EvidenceStatus): Promise<void> {
  const { error } = await client().from('trade_evidence').update({ status }).eq('id', id)
  if (error) throw error
}

export async function addTradeEvidenceImages(id: string, files: File[]): Promise<void> {
  if (!files.length) return
  const backend = client()
  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('รองรับเฉพาะ JPEG, PNG และ WebP')
    }
    if (file.size > 20 * 1024 * 1024) throw new Error('รูปต้นฉบับต้องไม่เกิน 20MB')
    // Canvas transcode removes EXIF/GPS metadata; review visible private details separately.
    const blob = await compressImage(file, 1800, 0.84)
    if (blob.size > 8 * 1024 * 1024) throw new Error('รูปหลังบีบอัดต้องไม่เกิน 8MB')
    const path = id + '/' + crypto.randomUUID() + '.jpg'
    const { error: uploadError } = await backend.storage.from('trade-evidence-private')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    if (uploadError) throw uploadError
    const { error: rowError } = await backend.from('trade_evidence_images').insert({
      evidence_id: id,
      storage_path: path,
      sort_order: Date.now() + index,
      alt_text: '',
      approved_for_public: false,
    })
    if (rowError) {
      await backend.storage.from('trade-evidence-private').remove([path])
      throw rowError
    }
  }
}

export async function setTradeEvidenceImageReview(
  imageId: string, approvedForPublic: boolean, altText: string,
): Promise<void> {
  const { error } = await client().from('trade_evidence_images')
    .update({ approved_for_public: approvedForPublic, alt_text: altText.slice(0, 240) })
    .eq('id', imageId)
  if (error) throw error
}

export async function removeTradeEvidenceImage(image: TradeEvidenceImage): Promise<void> {
  const backend = client()
  // Prevent dangling public metadata if deletion is denied; remove row first, object second.
  const { error } = await backend.from('trade_evidence_images').delete().eq('id', image.id)
  if (error) throw error
  const { error: storageError } = await backend.storage.from('trade-evidence-private').remove([image.storage_path])
  if (storageError) throw storageError
}

export async function getTradeEvidenceImageUrls(paths: string[]) {
  if (!paths.length) return {} as Record<string, string>
  const result: Record<string, string> = {}
  const backend = client()
  await Promise.all(paths.map(async (path) => {
    const { data, error } = await backend.storage.from('trade-evidence-private')
      .createSignedUrl(path, 15 * 60)
    if (!error && data?.signedUrl) result[path] = data.signedUrl
  }))
  return result
}

export async function downloadReviewedEvidenceImage(image: TradeEvidenceImage): Promise<void> {
  if (!image.approved_for_public) throw new Error('ภาพนี้ยังไม่ได้ผ่านการตรวจความเป็นส่วนตัว')
  const { data, error } = await client().storage.from('trade-evidence-private').download(image.storage_path)
  if (error || !data) throw error || new Error('ดาวน์โหลดรูปไม่สำเร็จ')
  const url = URL.createObjectURL(data)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'amphon-trade-' + image.id + '.jpg'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export function generateWebsiteDraft(e: TradeEvidenceInput) {
  const verb = e.kind === 'purchase' ? 'รับซื้อ' : 'จำหน่าย'
  const location = e.city?.trim() ? ' ที่' + e.city.trim() : ''
  return [
    'ตัวอย่างงาน' + verb + 'จริงของ AMPHON TRADING' + location,
    e.title.trim(),
    e.specs_text?.trim() ? 'สเปก: ' + e.specs_text.trim() : '',
    e.condition_text?.trim() ? 'สภาพและการตรวจ: ' + e.condition_text.trim() : '',
    e.story.trim(),
    e.service_details?.trim() ? 'ขั้นตอนบริการ: ' + e.service_details.trim() : '',
  ].filter(Boolean).join('\n\n')
}

export function generateFacebookDraft(e: TradeEvidenceInput) {
  const action = e.kind === 'purchase' ? 'รับซื้อเข้าเรียบร้อยแล้ว' : 'ส่งมอบสินค้าเรียบร้อยแล้ว'
  return [
    '📸 เครดิตซื้อขายจริง AMPHON TRADING',
    '✅ ' + action,
    '📦 ' + e.title.trim(),
    e.specs_text?.trim() ? '⚙️ ' + e.specs_text.trim() : '',
    e.condition_text?.trim() ? '🔎 ' + e.condition_text.trim() : '',
    e.city?.trim() ? '📍 ' + e.city.trim() : '',
    e.story.trim(),
    e.show_price && e.public_price != null ? '💰 ' + e.public_price.toLocaleString('th-TH') + ' บาท' : '',
    '#AMPHONTRADING #ซื้อขายจริง #สินค้าไอทีมือสอง',
  ].filter(Boolean).join('\n')
}

export function approvedEvidenceForAi(e: TradeEvidence) {
  if (e.status !== 'APPROVED') throw new Error('ต้องอนุมัติหลักฐานก่อนส่งต่อ AI หรือเว็บไซต์')
  return JSON.stringify({
    type: e.kind, transactionDate: e.occurred_on, title: e.title,
    category: e.category, brand: e.brand, model: e.model,
    specs: e.specs_text, condition: e.condition_text, experience: e.story,
    serviceDetails: e.service_details, city: e.city, relatedSku: e.related_sku,
    websiteCopy: e.website_text, facebookCopy: e.facebook_text,
    publicPrice: e.show_price ? e.public_price : null,
    imagePaths: (e.trade_evidence_images || []).filter(i => i.approved_for_public)
      .map(i => ({ path: i.storage_path, alt: i.alt_text })),
    mediaAccess: 'private: authenticated server-side access required; do not embed storage path publicly',
    verified: { approvedAt: e.approved_at, manuallyPrivacyReviewed: true },
  }, null, 2)
}
