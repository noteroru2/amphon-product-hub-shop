import { useCallback, useEffect, useState } from 'react'
import { loadSeoGrowth, manageSeoGrowth, type GrowthOpportunity, type KeywordOwner, type LeadGuard } from '../lib/seoGrowth'
import { activeOpportunity, growthKindLabels, guardLabels, guardNotes } from '../lib/seoGrowthSignals'
import type { SeoNetworkSite } from '../lib/seoNetwork'
import { manageSeoLab } from '../lib/seoLab'

const num = (value: number | null, digits = 0) => value == null ? '—' : Number(value).toLocaleString('th-TH', { maximumFractionDigits: digits })
const when = (value: string | null) => value ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }) : '—'

export function SeoGrowthCenter({ sites }: { sites: SeoNetworkSite[] }) {
  const [tab, setTab] = useState<'opportunities' | 'ownership' | 'guard'>('opportunities')
  const [opportunities, setOpportunities] = useState<GrowthOpportunity[]>([])
  const [owners, setOwners] = useState<KeywordOwner[]>([])
  const [pages, setPages] = useState<LeadGuard[]>([])
  const [siteFilter, setSiteFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [ownerSite, setOwnerSite] = useState('amphon')
  const [page, setPage] = useState('')
  const [note, setNote] = useState('')
  const load = useCallback(async () => {
    const result = await loadSeoGrowth()
    setOpportunities(result.opportunities); setOwners(result.owners); setPages(result.pages)
  }, [])
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try { const result = await loadSeoGrowth(); if (active) { setOpportunities(result.opportunities); setOwners(result.owners); setPages(result.pages); setError('') } }
      catch (err) { if (active) setError(err instanceof Error ? err.message : String(err)) }
    }
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  async function act(action: string, data: Record<string, unknown> = {}) {
    setBusy(true); setError(''); setNotice('')
    try {
      await manageSeoGrowth(action, data); await load()
      setNotice(action === 'refresh' ? 'ประมวลผลโอกาสแล้ว • ผลตรวจหน้าเว็บทยอยเข้าตามคิว ไม่ได้ดึง GSC ใหม่' : 'บันทึกแล้ว • ไม่มีการแก้ไขเว็บหรือส่งเข้า auto-executor')
      if (action === 'owner' || action === 'page') setEditing(false)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  const label = (id: string) => sites.find(s => s.id === id)?.label || id
  const matches = (row: { site_id: string }) => !siteFilter || row.site_id === siteFilter
  const open = opportunities.filter(row => activeOpportunity(row) && matches(row))
  return <section className="seo-tower-section seo-growth-center">
    <div className="seo-network-detail-head"><h2>SEO Growth Center</h2><button disabled={busy} onClick={() => void act('refresh')}>{busy ? 'กำลังประมวลผล…' : 'ประมวลผลและโหลดล่าสุด'}</button></div>
    <p className="seo-network-note">ข้อเสนอจาก GSC • ไม่มีการแก้ Title, เนื้อหา, noindex หรือส่งเข้า executor • คะแนนเป็นลำดับงาน ไม่ใช่คะแนน Google</p>
    <nav className="seo-network-tabs" aria-label="เครื่องมือพัฒนา SEO">
      <button aria-pressed={tab === 'opportunities'} onClick={() => { setTab('opportunities'); setEditing(false) }}>โอกาส SEO ({opportunities.filter(row => activeOpportunity(row)).length})</button>
      <button aria-pressed={tab === 'ownership'} onClick={() => { setTab('ownership'); setEditing(false) }}>เจ้าของคำค้น ({owners.length})</button>
      <button aria-pressed={tab === 'guard'} onClick={() => { setTab('guard'); setEditing(false) }}>ตรวจหน้าสร้างลูกค้า ({pages.length})</button>
    </nav>
    <label>เว็บไซต์ <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}><option value="">ทุกเว็บ</option>{sites.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
    {error && <p role="alert" className="seo-network-warning">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {tab === 'opportunities' && <>
      <p className="seo-network-note">คัดคู่คำค้น–หน้า: แสดงผล ≥50 และอันดับ 4–20 / CTR &lt;2% เมื่อแสดงผล ≥100 และอันดับ 1–10 / คำซ้ำหลายหน้า ≥20 • เป็นเกณฑ์เบื้องต้น ไม่ใช่ benchmark • แสดงสูงสุด 300 งาน ข้อมูลคำค้นอาจไม่ครบ • GSC คลิกไม่เท่ากับจำนวนลูกค้า</p>
      {!open.length ? <p>ไม่มีงานเปิดที่ผ่านเกณฑ์ในข้อมูลล่าสุด • ไม่ได้หมายความว่าไม่มีโอกาส SEO</p> : <div className="seo-network-table-wrap"><table className="seo-network-table"><thead><tr><th>หน้า / คำค้น</th><th>โอกาส</th><th>หลักฐาน</th><th>ดำเนินการ</th></tr></thead><tbody>{open.map(row => <tr key={row.id}>
        <th>{label(row.site_id)}<small>{row.query}</small><a href={row.page} target="_blank" rel="noreferrer">{row.page}</a></th>
        <td>{growthKindLabels[row.kind]}<small>ลำดับงาน {row.priority}/100</small></td>
        <td>{num(row.clicks)} คลิก / {num(row.impressions)} แสดงผล<small>อันดับ {num(row.position, 2)} • CTR {row.ctr == null ? '—' : `${num(Number(row.ctr) * 100, 2)}%`}</small><small>นำเข้า {when(row.source_at)}</small></td>
        <td><p>{row.recommendation}</p><button disabled={busy} onClick={() => { setBusy(true); void manageSeoLab('create', { opportunity_id: row.id }).then(() => setNotice('สร้างงานแล้ว • เปิดแท็บเนื้อหา / อนุมัติด้านล่าง ระบบโหลดรายการใหม่ภายใน 1 นาที')).catch(err => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false)) }}>สร้างงานเนื้อหา</button> <button disabled={busy} onClick={() => void act('review', { id: row.id, status: 'REVIEWED' })}>ตรวจแล้ว / ยังไม่แก้เว็บ</button> <button disabled={busy} onClick={() => void act('review', { id: row.id, status: 'DISMISSED' })}>พักงาน</button></td>
      </tr>)}</tbody></table></div>}
      {opportunities.some(row => matches(row) && ['REVIEWED', 'DISMISSED'].includes(row.status)) && <details><summary>งานตรวจแล้ว / พักงาน</summary>{opportunities.filter(row => matches(row) && ['REVIEWED', 'DISMISSED'].includes(row.status)).map(row => <p key={row.id}>{label(row.site_id)} • {row.query} • {growthKindLabels[row.kind]} <button disabled={busy} onClick={() => void act('review', { id: row.id, status: 'OPEN' })}>เปิดงานอีกครั้ง</button></p>)}</details>}
    </>}
    {tab === 'ownership' && <>
      <p className="seo-network-note">แผนเริ่มต้นเป็นข้อเสนอจากทะเบียนคำค้นและหน้าใน GSC • ต้องให้เจ้าของยืนยัน • พบหลายเว็บในคำเดียวกันยังไม่ใช่หลักฐานการแย่งอันดับ</p>
      <button onClick={() => { setKeyword(''); setPage(''); setNote(''); setEditing(true) }}>เพิ่มเจ้าของคำค้น (เจ้าของร้าน)</button>
      <div className="seo-network-table-wrap"><table className="seo-network-table"><thead><tr><th>คำค้น</th><th>เว็บ / หน้าหลัก</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>{owners.filter(matches).map(row => <tr key={row.keyword}><th>{row.keyword}</th><td>{label(row.site_id)}<small><a href={row.primary_page} target="_blank" rel="noreferrer">{row.primary_page}</a></small></td><td>{row.confirmed ? 'เจ้าของยืนยันแล้ว' : 'เสนอ • ยังไม่ยืนยัน'}<small>{row.note}</small></td><td><button onClick={() => { setKeyword(row.keyword); setOwnerSite(row.site_id); setPage(row.primary_page); setNote(row.note); setEditing(true) }}>แก้ / ยืนยัน</button></td></tr>)}</tbody></table></div>
    </>}
    {tab === 'guard' && <>
      <p className="seo-network-note">ตรวจ HTTP, Title, canonical, noindex, H1 และการเปลี่ยนแปลง ทุก 72 ชั่วโมง • หน้าที่เสนอจากเจตนาคำค้นยังไม่ได้ยืนยันว่ามีลูกค้าจริง • ไม่ใช่ URL Inspection, crawl ทั้งเว็บ, robots รายหน้า หรือ Core Web Vitals • HTTP ผ่านไม่ได้แปลว่าจัดทำดัชนีแล้ว</p>
      <button onClick={() => { setPage(''); setEditing(true) }}>เพิ่มหน้าสร้างลูกค้า (เจ้าของร้าน)</button>
      <div className="seo-network-table-wrap"><table className="seo-network-table"><thead><tr><th>หน้า</th><th>ผลตรวจ</th><th>รายละเอียด</th><th>สถานะหน้า</th></tr></thead><tbody>{pages.filter(matches).map(row => <tr key={row.id}><th>{label(row.site_id)}<small><a href={row.page} target="_blank" rel="noreferrer">{row.page}</a></small></th><td>{guardLabels[row.guard_state] || row.guard_state}<small>HTTP {num(row.status_code)} • {when(row.requested_at)}</small></td><td>{row.title || '—'}<small>Canonical: {row.canonical || '—'}</small>{guardNotes(row).map((text, i) => <small key={i}>{text}</small>)}</td><td>{row.confirmed ? 'เจ้าของยืนยัน' : 'หน้าเสนอจากข้อมูล'}{!row.confirmed && <button disabled={busy} onClick={() => void act('page', { site_id: row.site_id, page: row.page })}>ยืนยันหน้าสร้างลูกค้า</button>}</td></tr>)}</tbody></table></div>
    </>}
    {editing && tab !== 'opportunities' && <form className="seo-growth-form" onSubmit={e => { e.preventDefault(); void act(tab === 'ownership' ? 'owner' : 'page', { keyword, site_id: ownerSite, page, note }) }}>
      <h3>{tab === 'ownership' ? 'ยืนยันเจ้าของคำค้น' : 'เพิ่มหน้าสร้างลูกค้า'}</h3>
      {tab === 'ownership' && <label>คำค้น<input required maxLength={200} value={keyword} onChange={e => setKeyword(e.target.value)} /></label>}
      <label>เว็บไซต์<select value={ownerSite} onChange={e => { setOwnerSite(e.target.value); setPage(`${sites.find(s => s.id === e.target.value)?.origin || ''}/`) }}>{sites.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <label>URL หน้าหลัก<input type="url" required value={page} onChange={e => setPage(e.target.value)} placeholder="https://…" /></label>
      {tab === 'ownership' && <label>เหตุผล / หมายเหตุ<input maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>}
      <p>บันทึกเฉพาะแผนใน Hub และคิวตรวจ • ไม่เปลี่ยนเว็บจริง • ใช้สิทธิ์เจ้าของร้าน</p>
      <button disabled={busy} type="submit">ยืนยันและบันทึก</button> <button type="button" onClick={() => setEditing(false)}>ยกเลิก</button>
    </form>}
  </section>
}
