import { useEffect, useState } from 'react'
import { ArrowLeft, BadgeCheck, Camera, ClipboardCopy, FileText, ImagePlus, LoaderCircle, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import {
  addTradeEvidenceImages, approvedEvidenceForAi, changeTradeEvidenceStatus, downloadReviewedEvidenceImage, generateFacebookDraft,
  generateWebsiteDraft, getTradeEvidenceImageUrls, listTradeEvidence, removeTradeEvidenceImage,
  saveTradeEvidence, setTradeEvidenceImageReview, listTradeEvidenceEconomics, verifyTradeTransaction,
  type EvidenceKind, type TradeEvidence, type TradeEvidenceImage, type TradeEvidenceInput,
  type TradeEvidenceEconomics,
} from '../lib/tradeEvidence'

function today() {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}
function empty(kind: EvidenceKind): TradeEvidenceInput {
  return { kind, occurred_on: today(), title: '', category: 'notebook', brand: '', model: '',
    specs_text: '', condition_text: '', story: '', service_details: '', city: '',
    related_sku: '', internal_reference: '', website_text: '', facebook_text: '',
    show_price: false, public_price: null, permission_confirmed: false, privacy_reviewed: false,
    deal_code: '', quantity: 1, transaction_amount: null, repair_cost: 0, shipping_cost: 0,
    platform_fee: 0, other_direct_cost: 0, customer_channel: 'UNKNOWN',
    channel_evidence: 'UNKNOWN', channel_evidence_ref: '', verification_reference: '' }
}
function fill(row: TradeEvidence): TradeEvidenceInput {
  return { kind: row.kind, occurred_on: row.occurred_on, title: row.title, category: row.category,
    brand: row.brand || '', model: row.model || '', specs_text: row.specs_text || '',
    condition_text: row.condition_text || '', story: row.story, service_details: row.service_details || '',
    city: row.city || '', related_sku: row.related_sku || '', internal_reference: row.internal_reference || '',
    website_text: row.website_text || '', facebook_text: row.facebook_text || '',
    show_price: row.show_price, public_price: row.public_price,
    permission_confirmed: row.permission_confirmed, privacy_reviewed: row.privacy_reviewed,
    deal_code: row.deal_code || '', quantity: row.quantity ?? 1,
    transaction_amount: row.transaction_amount, repair_cost: row.repair_cost ?? 0,
    shipping_cost: row.shipping_cost ?? 0, platform_fee: row.platform_fee ?? 0,
    other_direct_cost: row.other_direct_cost ?? 0, customer_channel: row.customer_channel || 'UNKNOWN',
    channel_evidence: row.channel_evidence || 'UNKNOWN',
    channel_evidence_ref: row.channel_evidence_ref || '',
    verification_reference: row.verification_reference || '' }
}
const categories = [['notebook','โน๊ตบุ๊ค / MacBook'],['pc','คอมพิวเตอร์'],['iphone','iPhone'],
  ['tablet','iPad / Tablet'],['camera','กล้อง'],['lens','เลนส์'],['component','อะไหล่ IT'],
  ['monitor','จอ'],['gaming','เครื่องเกม'],['other','อื่น ๆ']]
const labels = { DRAFT: 'รอตรวจ', APPROVED: 'อนุมัติแล้ว', ARCHIVED: 'เก็บเข้าคลัง' }
const channels = [
  ['UNKNOWN','ไม่ทราบช่องทาง'],['GOOGLE','Google (ลูกค้าแจ้ง)'],
  ['FACEBOOK','Facebook'],['WALK_IN','หน้าร้าน'],['REPEAT','ลูกค้าเก่า'],
  ['REFERRAL','คนรู้จักแนะนำ'],['OTHER','ช่องทางอื่น'],
] as const
const money = (n: number) => n.toLocaleString('th-TH',{minimumFractionDigits:0,maximumFractionDigits:2}) + ' ฿'

export function TradeEvidenceCenter({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<TradeEvidence[]>([])
  const [economics, setEconomics] = useState<TradeEvidenceEconomics[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [form, setForm] = useState<TradeEvidenceInput>(empty('purchase'))
  const [files, setFiles] = useState<File[]>([])
  const [urls, setUrls] = useState<Record<string,string>>({})
  const [filter, setFilter] = useState<'all' | EvidenceKind>('all')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const current = rows.find(row => row.id === selected)
  const locked = Boolean(current && current.status !== 'DRAFT')
  const images = (current?.trade_evidence_images || []).slice().sort((a,b) => a.sort_order-b.sort_order)
  const verifiedPurchaseCount = rows.filter(r => r.kind === 'purchase' && r.transaction_verified).length
  const verifiedSaleCount = rows.filter(r => r.kind === 'sale' && r.transaction_verified).length
  const realizedTotal = economics.reduce((sum,row) => sum+Number(row.realized_gross_profit_after_direct_costs),0)

  function change<K extends keyof TradeEvidenceInput>(key: K, value: TradeEvidenceInput[K]) {
    setForm(old => ({ ...old, [key]: value }))
    setDirty(true)
  }
  async function load(id?: string | null) {
    setLoading(true)
    try {
      const next = await listTradeEvidence()
      setRows(next)
      const completed = await listTradeEvidenceEconomics()
      setEconomics(completed)
      if (id) {
        const found = next.find(row => row.id === id)
        if (found) { setSelected(id); setForm(fill(found)); setDirty(false) }
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load(null) }, [])
  useEffect(() => {
    let alive = true
    void getTradeEvidenceImageUrls(images.map(x => x.storage_path))
      .then(next => { if (alive) setUrls(next) })
      .catch(() => { if (alive) setUrls({}) })
    return () => { alive = false }
  }, [selected, rows])

  function start(kind: EvidenceKind) {
    setSelected(null); setForm(empty(kind)); setFiles([]); setDirty(false); setError(''); setNotice('')
  }
  function open(row: TradeEvidence) {
    setSelected(row.id); setForm(fill(row)); setFiles([]); setDirty(false); setError(''); setNotice('')
  }
  async function perform(task: () => Promise<void>, message: string) {
    setBusy(true); setError(''); setNotice('')
    try { await task(); setNotice(message) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  function save() {
    void perform(async () => {
      const id = await saveTradeEvidence(form, selected || undefined)
      setSelected(id)
      if (files.length) await addTradeEvidenceImages(id, files)
      setFiles([])
      await load(id)
    }, 'บันทึกหลักฐานและรูปแล้ว')
  }
  function verifyTransaction(next: boolean) {
    if (!selected || dirty || files.length) { setError('บันทึกข้อมูลและรูปให้เสร็จก่อนยืนยันธุรกรรม'); return }
    if (next && !window.confirm('ยืนยันว่าตรวจราคาจริง ต้นทุน เลขอ้างอิง และรูปหลักฐานแล้ว? การยืนยันการเงินนี้ทำได้เฉพาะเจ้าของร้าน')) return
    void perform(async () => {
      await verifyTradeTransaction(selected,next)
      await load(selected)
    },next ? 'ยืนยันหลักฐานธุรกรรมแล้ว หากมีฝั่งซื้อและขายครบจะแสดงกำไร' : 'ถอนการยืนยันธุรกรรมแล้ว')
  }
  function status(next: 'APPROVED' | 'DRAFT' | 'ARCHIVED') {
    if (!selected || dirty || files.length) { setError('กรุณาบันทึกก่อนเปลี่ยนสถานะ'); return }
    if (next === 'APPROVED' && !window.confirm('ตรวจสิทธิ์ ข้อมูลส่วนตัว และภาพที่ใช้เผยแพร่ทุกภาพแล้วใช่หรือไม่?')) return
    void perform(async () => { await changeTradeEvidenceStatus(selected, next); await load(selected) },
      next === 'APPROVED' ? 'อนุมัติแล้ว (ไม่มีการโพสต์อัตโนมัติ)' : 'บันทึกสถานะแล้ว')
  }
  function review(image: TradeEvidenceImage, approved: boolean, alt: string) {
    if (!selected || locked) return
    void perform(async () => {
      await setTradeEvidenceImageReview(image.id, approved, alt)
      await load(selected)
    }, 'บันทึกผลตรวจภาพแล้ว')
  }
  function remove(image: TradeEvidenceImage) {
    if (!selected || locked || !window.confirm('ลบภาพนี้หรือไม่?')) return
    void perform(async () => { await removeTradeEvidenceImage(image); await load(selected) }, 'ลบภาพแล้ว')
  }
  async function copy(kind: 'ai' | 'website' | 'facebook') {
    if (!current || current.status !== 'APPROVED' || dirty) { setError('ต้องอนุมัติก่อนนำไปใช้'); return }
    const payload = kind === 'ai' ? approvedEvidenceForAi(current)
      : kind === 'website' ? current.website_text || '' : current.facebook_text || ''
    if (!payload) { setError('ยังไม่มีข้อความสำหรับช่องทางนี้'); return }
    try { await navigator.clipboard.writeText(payload); setNotice('คัดลอกแล้ว') }
    catch { setError('คัดลอกไม่สำเร็จ กรุณาตรวจสิทธิ์คลิปบอร์ด') }
  }

  return <section className="screen page-pad evidence-screen">
    <header className="topbar">
      <button className="icon-btn" onClick={onBack} aria-label="กลับ"><ArrowLeft /></button>
      <div><p className="eyebrow">AMPHON VERIFIED DEALS</p><h1>หลักฐานซื้อขายจริง</h1></div>
      <button className="icon-btn" onClick={() => void load(selected)} disabled={busy} aria-label="รีเฟรช"><RefreshCw /></button>
    </header>
    <p className="evidence-guard"><ShieldCheck size={20} /> รูปต้นฉบับเป็นส่วนตัว • Owner/Admin เท่านั้น • ต้องตรวจและอนุมัติก่อนใช้กับเว็บไซต์/AI/Facebook</p>
    {error && <p className="evidence-error" role="alert">{error}</p>}
    {notice && <p className="evidence-success" role="status">{notice}</p>}
    <div className="evidence-new-actions">
      <button onClick={() => start('purchase')}><Plus size={18}/> เพิ่มหลักฐานรับซื้อ</button>
      <button onClick={() => start('sale')}><Plus size={18}/> เพิ่มหลักฐานขาย</button>
    </div>
    <div className="evidence-finance-summary">
      <div><small>รับซื้อที่เจ้าของยืนยัน (รายการที่โหลด)</small><strong>{verifiedPurchaseCount}</strong></div>
      <div><small>ขายออกที่เจ้าของยืนยัน (รายการที่โหลด)</small><strong>{verifiedSaleCount}</strong></div>
      <div><small>กำไรขั้นต้นหลังต้นทุนตรงของดีลที่จับคู่และยืนยันครบ</small>
        <strong>{money(realizedTotal)}</strong></div>
      <p>นับกำไรเฉพาะดีลซื้อ–ขายที่มีรหัสตรงกัน จำนวนตรงกัน และเจ้าของยืนยันทั้งสองฝั่ง •
         ไม่ใช่กำไรสุทธิหลังค่าใช้จ่ายประจำร้าน และยังไม่ใช่กำไรที่ยืนยันว่ามาจาก Google
         {economics.length === 2000 ? ' • แสดงเพียง 2,000 ดีลล่าสุด' : ''}</p>
    </div>
    <div className="evidence-layout">
      <aside className="evidence-list">
        <div className="evidence-list-header"><strong>รายการ ({rows.length})</strong>
          <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="กรองหลักฐาน">
            <option value="all">ทั้งหมด</option><option value="purchase">รับซื้อ</option><option value="sale">ขาย</option>
          </select>
        </div>
        {loading && <p><LoaderCircle className="spin" size={17} /> กำลังโหลด</p>}
        {rows.filter(r => filter === 'all' || r.kind === filter).map(row =>
          <button className={row.id === selected ? 'evidence-row active' : 'evidence-row'}
            onClick={() => open(row)} key={row.id}>
            <small>{row.kind === 'purchase' ? 'รับซื้อ' : 'ขาย'} · {row.occurred_on}</small>
            <strong>{row.title}</strong><span>{labels[row.status]} · {row.trade_evidence_images?.length || 0} ภาพ
              {row.deal_code ? ' · '+row.deal_code : ''}
              {row.transaction_verified ? ' · ยืนยันธุรกรรมแล้ว' : ''}</span>
          </button>)}
        {!loading && rows.length === 0 && <p>ยังไม่มีหลักฐานการซื้อขาย</p>}
      </aside>
      <div className="evidence-form">
        <div className="evidence-form-header"><h2>{form.kind === 'purchase' ? 'หลักฐานการรับซื้อ' : 'หลักฐานการขาย'}</h2>
          <span className={current?.status === 'APPROVED' ? 'approved' : ''}>{current ? labels[current.status] : 'ร่างใหม่'}</span>
        </div>
        {locked && <p className="evidence-guard"><BadgeCheck size={17}/> ล็อกข้อมูลหลังอนุมัติ/เก็บเข้าคลัง กดกลับเป็นร่างก่อนแก้ไข</p>}
        <div className="evidence-fields">
          <label>ประเภทรายการ
            <select disabled={locked} value={form.kind} onChange={e => change('kind',e.target.value as EvidenceKind)}>
              <option value="purchase">หลักฐานรับซื้อ</option><option value="sale">หลักฐานขาย</option>
            </select>
          </label>
          <label>วันที่ซื้อขายจริง
            <input type="date" disabled={locked} value={form.occurred_on} onChange={e => change('occurred_on',e.target.value)}/>
          </label>
          <label className="wide">ชื่อสินค้า / รุ่น *
            <input maxLength={180} placeholder="เช่น MacBook Air M1 8/256 GB" disabled={locked} value={form.title}
              onChange={e => change('title',e.target.value)}/>
          </label>
          <label>หมวด
            <select disabled={locked} value={form.category} onChange={e => change('category',e.target.value)}>
              {categories.map(c => <option key={c[0]} value={c[0]}>{c[1]}</option>)}
            </select>
          </label>
          <label>พื้นที่ให้บริการจริง
            <input disabled={locked} placeholder="เช่น อุบลราชธานี" value={form.city || ''} onChange={e => change('city',e.target.value)}/>
          </label>
          <label>แบรนด์ <input disabled={locked} value={form.brand || ''} onChange={e => change('brand',e.target.value)}/></label>
          <label>รุ่น <input disabled={locked} value={form.model || ''} onChange={e => change('model',e.target.value)}/></label>
          <label className="wide">สเปก / อุปกรณ์ที่ได้
            <textarea rows={2} disabled={locked} value={form.specs_text || ''} onChange={e => change('specs_text',e.target.value)}/>
          </label>
          <label className="wide">สภาพและผลตรวจจริง
            <textarea rows={2} disabled={locked} value={form.condition_text || ''} onChange={e => change('condition_text',e.target.value)}/>
          </label>
          <label className="wide">เรื่องราวการซื้อขายจริง *
            <textarea rows={4} disabled={locked} placeholder="อธิบายขั้นตอนตรวจเครื่อง รับซื้อ หรือส่งมอบจริง โดยไม่ระบุตัวลูกค้า"
              value={form.story} onChange={e => change('story',e.target.value)}/>
          </label>
          <label className="wide">รายละเอียดบริการสำหรับเว็บไซต์
            <textarea rows={2} disabled={locked} value={form.service_details || ''} onChange={e => change('service_details',e.target.value)}/>
          </label>
          <label>SKU (ถ้ามี) <input disabled={locked} value={form.related_sku || ''} onChange={e => change('related_sku',e.target.value)}/></label>
          <label>เลขอ้างอิงภายใน (ไม่เผยแพร่)
            <input disabled={locked} value={form.internal_reference || ''} onChange={e => change('internal_reference',e.target.value)}/>
          </label>
        </div>
        <h3 className="evidence-subhead"><FileText size={18}/> ข้อมูลดีลและต้นทุนจริง (ภายในร้านเท่านั้น)</h3>
        <p className="evidence-note">เลขดีลต้องตรงกันระหว่างหลักฐานซื้อและขาย • ไม่ต้องเชื่อม LINE •
          ยังไม่คิดเป็นกำไรจนเจ้าของยืนยันข้อมูลสองฝั่ง • ดีลเหมาหรือแบ่งขายต้องแยกรหัสให้จำนวนตรงกัน</p>
        <div className="evidence-fields evidence-money-fields">
          <label>รหัสจับคู่ซื้อ–ขาย (ไม่ใส่ชื่อ/เบอร์ลูกค้า)
            <input disabled={locked} maxLength={80} list={form.kind === 'sale' ? 'evidence-buy-codes' : undefined}
              placeholder="เช่น AMP-2026-001" value={form.deal_code || ''}
              onChange={e => change('deal_code',e.target.value)}/>
            <datalist id="evidence-buy-codes">
              {rows.filter(row => row.kind === 'purchase' && row.deal_code)
                .map(row => <option key={row.id} value={row.deal_code || ''}/>)}
            </datalist>
          </label>
          <label>จำนวนเครื่อง / จำนวนชุดในดีล
            <input disabled={locked} type="number" min={1} max={100000} step={1} value={form.quantity}
              onChange={e => change('quantity',Number(e.target.value))}/>
          </label>
          <label>{form.kind === 'purchase' ? 'ยอดรับซื้อจริงทั้งดีล (บาท)' : 'ยอดขายออกจริงทั้งดีล (บาท)'}
            <input disabled={locked} type="number" min={0} step="0.01"
              value={form.transaction_amount ?? ''} placeholder="ยังไม่กรอก"
              onChange={e => change('transaction_amount',e.target.value === '' ? null : Number(e.target.value))}/>
          </label>
          {form.kind === 'purchase' && <label>ค่าซ่อม / ทดสอบ / อะไหล่ (บาท)
            <input disabled={locked} type="number" min={0} step="0.01" value={form.repair_cost}
              onChange={e => change('repair_cost',Number(e.target.value))}/>
          </label>}
          <label>{form.kind === 'purchase' ? 'ค่าขนส่งรับเข้า (บาท)' : 'ค่าขนส่งส่งออก (บาท)'}
            <input disabled={locked} type="number" min={0} step="0.01" value={form.shipping_cost}
              onChange={e => change('shipping_cost',Number(e.target.value))}/>
          </label>
          {form.kind === 'sale' && <label>ค่าธรรมเนียมแพลตฟอร์ม / Payment (บาท)
            <input disabled={locked} type="number" min={0} step="0.01" value={form.platform_fee}
              onChange={e => change('platform_fee',Number(e.target.value))}/>
          </label>}
          <label>ต้นทุนตรงอื่น ๆ (บาท)
            <input disabled={locked} type="number" min={0} step="0.01" value={form.other_direct_cost}
              onChange={e => change('other_direct_cost',Number(e.target.value))}/>
          </label>
          <label>{form.kind === 'purchase' ? 'ลูกค้ารู้จักร้านจากไหน' : 'ช่องทางขายออก'}
            <select disabled={locked} value={form.customer_channel}
              onChange={e => change('customer_channel',e.target.value as TradeEvidenceInput['customer_channel'])}>
              {channels.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>ความน่าเชื่อถือของช่องทาง
            <select disabled={locked} value={form.channel_evidence}
              onChange={e => change('channel_evidence',e.target.value as TradeEvidenceInput['channel_evidence'])}>
              <option value="UNKNOWN">ยังไม่ได้ยืนยัน</option>
              <option value="CUSTOMER_STATED">ลูกค้าแจ้งด้วยตนเอง</option>
              <option value="DOCUMENTED">มีหลักฐานระบุช่องทาง</option>
            </select>
          </label>
          {form.channel_evidence === 'DOCUMENTED' && <label className="wide">เลขอ้างอิงหลักฐานช่องทาง (ไม่ใส่ PII)
            <input disabled={locked} maxLength={240} value={form.channel_evidence_ref || ''}
              placeholder="รหัสคลิก/รายงาน/หลักฐานภายใน" onChange={e => change('channel_evidence_ref',e.target.value)}/>
          </label>}
          <label className="wide">เลขอ้างอิงใบรับซื้อ / ใบขาย / ธุรกรรมจริง
            <input disabled={locked} maxLength={240} placeholder="เช่น ใบรับซื้อ 2026-001 (ห้ามใส่เลขบัญชีหรือข้อมูลลูกค้า)"
              value={form.verification_reference || ''}
              onChange={e => change('verification_reference',e.target.value)}/>
          </label>
        </div>
        <p className="evidence-note">หมายเหตุ: ช่องทาง Google แบบลูกค้าแจ้ง เป็นเพียง Self-reported ไม่ใช่ข้อมูล GSC
          ราคาจริงและกำไรเก็บเป็นข้อมูลส่วนตัว ไม่รวมในข้อความเว็บไซต์/AI/Facebook หรือราคาเปิดเผยต่อสาธารณะ</p>
        {current && <div className="evidence-transaction-status">
          <span>{current.transaction_verified ? '✓ เจ้าของยืนยันธุรกรรมแล้ว' : 'ยังไม่ยืนยันตัวเลขธุรกรรม'}</span>
          <button disabled={busy || dirty || files.length > 0}
            onClick={() => verifyTransaction(!current.transaction_verified)}>
            {current.transaction_verified ? 'ถอนการยืนยัน (Owner)' : 'ยืนยันยอดจริงและหลักฐาน (Owner)'}
          </button>
        </div>}
        <h3 className="evidence-subhead"><Camera size={18}/> รูปหลักฐานจริง</h3>
        <div className="evidence-photos">
          {images.map(image => <div className="evidence-photo" key={image.id}>
            {urls[image.storage_path] ? <img loading="lazy" src={urls[image.storage_path]} alt={image.alt_text || 'ภาพหลักฐาน'}/>
              : <div className="evidence-placeholder">รูปส่วนตัว</div>}
            <input disabled={locked} defaultValue={image.alt_text} key={image.id + image.alt_text}
              placeholder="คำอธิบายภาพ" aria-label="คำอธิบายภาพ"
              onBlur={e => { if (e.target.value !== image.alt_text) review(image,image.approved_for_public,e.target.value) }}/>
            <label><input disabled={locked || busy} type="checkbox" checked={image.approved_for_public} onChange={e => {
              if (e.target.checked && !window.confirm('ตรวจแล้วว่ารูปนี้ไม่มีข้อมูลลูกค้าหรือรายละเอียดส่วนตัวที่ไม่ได้รับอนุญาต?')) return
              review(image,e.target.checked,image.alt_text)
            }}/> ผ่านการตรวจเพื่อใช้สื่อได้</label>
            {current?.status === 'APPROVED' && image.approved_for_public && <button onClick={() => void perform(() => downloadReviewedEvidenceImage(image),'ดาวน์โหลดภาพแล้ว')}><ImagePlus size={14}/> ดาวน์โหลดภาพตรวจแล้ว</button>}
            {!locked && <button disabled={busy} onClick={() => remove(image)}><Trash2 size={14}/> ลบรูป</button>}
          </div>)}
        </div>
        {!locked && <label className="evidence-upload"><ImagePlus size={20}/> เลือกหรือถ่ายภาพเพิ่ม
          <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e => {
            setFiles(old => [...old,...Array.from(e.target.files || [])]); e.target.value = ''
          }}/>
          {files.length > 0 && <span>รออัปโหลด {files.length} ภาพ</span>}
        </label>}
        {files.length > 0 && <button className="evidence-text-button" onClick={() => setFiles([])}>ล้างรูปที่รออัปโหลด</button>}
        <h3 className="evidence-subhead"><FileText size={18}/> ข้อความพร้อมใช้</h3>
        <label className="evidence-block">ข้อความเว็บไซต์ / SEO / AI
          <textarea rows={6} disabled={locked} value={form.website_text || ''} onChange={e => change('website_text',e.target.value)}/>
        </label>
        {!locked && <button className="evidence-text-button" onClick={() => change('website_text',generateWebsiteDraft(form))}>สร้างร่างเว็บไซต์จากข้อมูลจริง</button>}
        <label className="evidence-block">ร่างโพสต์ Facebook เพื่อทำเครดิตร้าน
          <textarea rows={6} disabled={locked} value={form.facebook_text || ''} onChange={e => change('facebook_text',e.target.value)}/>
        </label>
        {!locked && <button className="evidence-text-button" onClick={() => change('facebook_text',generateFacebookDraft(form))}>สร้างร่าง Facebook จากข้อมูลจริง</button>}
        <div className="evidence-review">
          <h3><ShieldCheck size={18}/> ตรวจความถูกต้องและข้อมูลส่วนตัวก่อนอนุมัติ</h3>
          <label><input type="checkbox" disabled={locked} checked={form.permission_confirmed} onChange={e => change('permission_confirmed',e.target.checked)}/>
            ยืนยันว่าร้านมีสิทธิ์นำข้อมูลและรูปไปประชาสัมพันธ์ หรือได้รับความยินยอมที่จำเป็นแล้ว</label>
          <label><input type="checkbox" disabled={locked} checked={form.privacy_reviewed} onChange={e => change('privacy_reviewed',e.target.checked)}/>
            ตรวจและปกปิดชื่อ เบอร์โทร ใบหน้า เลขบัญชี ที่อยู่ เลขซีเรียล และข้อมูลลูกค้าในภาพ/ข้อความแล้ว</label>
          <label><input type="checkbox" disabled={locked} checked={form.show_price} onChange={e => change('show_price',e.target.checked)}/>
            อนุญาตให้แสดงราคาซื้อขาย</label>
          {form.show_price && <label>ราคาที่เปิดเผยได้ (บาท)
            <input type="number" min={0} disabled={locked} value={form.public_price ?? ''} onChange={e => change('public_price',e.target.value ? Number(e.target.value) : null)}/>
          </label>}
        </div>
        <div className="evidence-footer">
          {!locked && <button disabled={busy} className="evidence-primary" onClick={save}>{busy ? <LoaderCircle className="spin" size={18}/> : null} บันทึกร่างและอัปโหลดรูป</button>}
          {current?.status === 'DRAFT' && <button disabled={busy || dirty || files.length > 0} onClick={() => status('APPROVED')} className="evidence-approve"><BadgeCheck size={18}/> อนุมัติหลักฐาน</button>}
          {current && locked && <button disabled={busy} onClick={() => status('DRAFT')}>กลับเป็นร่างเพื่อแก้ไข</button>}
          {current?.status === 'DRAFT' && <button disabled={busy || dirty} onClick={() => status('ARCHIVED')}>เก็บเข้าคลัง</button>}
        </div>
        {current?.status === 'APPROVED' && <div className="evidence-share">
          <strong>ข้อมูลที่อนุมัติแล้ว พร้อมส่งต่อทีมงาน</strong>
          <p>คัดลอกข้อความและข้อมูลที่ตรวจแล้วได้ รูปยังเป็นส่วนตัว และยังไม่โพสต์หรือเผยแพร่โดยอัตโนมัติ</p>
          <button onClick={() => void copy('website')}><ClipboardCopy size={16}/> คัดลอกข้อความเว็บ</button>
          <button onClick={() => void copy('facebook')}><ClipboardCopy size={16}/> คัดลอกโพสต์ Facebook</button>
          <button onClick={() => void copy('ai')}><ClipboardCopy size={16}/> คัดลอก JSON สำหรับ AI</button>
        </div>}
      </div>
    </div>
  </section>
}
