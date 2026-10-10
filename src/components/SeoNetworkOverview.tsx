import '../styles/seo-network.css'
import { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react'
import { loadSeoNetwork, loadSeoNetworkHistory, type SeoNetworkSite, type SeoNetworkSnapshot } from '../lib/seoNetwork'
import { networkIssues, sourceState } from '../lib/seoNetworkSignals'
import { SeoGscConnection } from './SeoGscConnection'

const healthLabels: Record<string, string> = { OK: 'ตรวจผ่าน', ATTENTION: 'ควรตรวจสอบ', RUNNING: 'กำลังตรวจ', WAITING: 'รอรอบตรวจ', STALE: 'ผลตรวจเก่า', REDIRECT: 'เปลี่ยนเส้นทาง' }
const sourceLabels: Record<string, string> = { FRESH: 'ข้อมูลล่าสุด', STALE: 'ข้อมูลเก่า', MISSING: 'ยังไม่มีข้อมูล', BLOCKED: 'ดึงข้อมูลถูกระงับ' }
const format = (value: number | null | undefined, digits = 0) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('th-TH', { maximumFractionDigits: digits })
const percent = (value: number | null) => value == null ? '—' : `${format(value * 100, 2)}%`
const time = (value: string | null) => value ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) : '—'

export function SeoNetworkOverview({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [sites, setSites] = useState<SeoNetworkSite[]>([])
  const [selected, setSelected] = useState('amphon')
  const [history, setHistory] = useState<SeoNetworkSnapshot[]>([])
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [view, setView] = useState<'queries' | 'health' | 'history'>('queries')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const rows = await loadSeoNetwork()
        if (active) { setSites(rows); setError('') }
      } catch (err) { if (active) setError(err instanceof Error ? err.message : String(err)) }
      finally { if (active) setLoading(false) }
    }
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [refreshSignal])

  useEffect(() => {
    let active = true
    setHistory([]); setDetailError(''); setDetailLoading(true)
    void loadSeoNetworkHistory(selected).then(rows => { if (active) setHistory(rows) })
      .catch(err => { if (active) setDetailError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (active) setDetailLoading(false) })
    return () => { active = false }
  }, [selected, sites])

  async function refresh() {
    setLoading(true)
    try { setSites(await loadSeoNetwork()); setError('') }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setLoading(false) }
  }
  const site = sites.find(row => row.id === selected)
  const latest = history[0]
  const previous = latest && history.find(row => Date.parse(latest.source_at) - Date.parse(row.source_at) >= 3 * 86_400_000 && row.coverage === latest.coverage)
  const priorities = sites.flatMap(row => networkIssues(row).map(issue => ({ ...issue, site: row })))
    .sort((a, b) => ['critical','warning','info'].indexOf(a.level) - ['critical','warning','info'].indexOf(b.level))
  const queries = [...(latest?.queries || [])].sort((a, b) => b.impressions - a.impressions)
  const next = sites.map(row => row.next_check_at).sort()[0]

  return <div className="seo-network">
    <div className="seo-network-intro">
      <div><h2>ศูนย์ตรวจทุกเว็บในเครือ</h2><p>ตรวจหน้าแรก robots.txt และ sitemap ที่ประกาศ ทุก 3 วัน • เก็บประวัติแยกจาก Experiments</p><small>รอบถัดไป {time(next || null)} (เวลาไทย)</small></div>
      <button onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''}/> โหลดผลล่าสุด</button>
    </div>
    <SeoGscConnection onChanged={() => void refresh()} />
    {error && <div className="seo-network-warning" role="alert">โหลดผลตรวจไม่ได้: {error} <button onClick={() => void refresh()}>ลองอีกครั้ง</button></div>}
    {!error && loading && sites.length === 0 && <p role="status">กำลังโหลดผลตรวจทุกเว็บ…</p>}
    {!loading && !error && sites.length === 0 && <p>ยังไม่มีเว็บไซต์ในทะเบียนตรวจ</p>}
    {sites.length > 0 && <>
      <div className="seo-tower-kpis seo-network-kpis">
        <div><span>เว็บที่ติดตาม</span><strong>{sites.length}</strong></div>
        <div><span>สุขภาพเว็บตรวจผ่าน</span><strong>{sites.filter(row => row.health_state === 'OK').length}/{sites.length}</strong></div>
        <div><span>มีข้อมูล GSC ที่นำเข้า</span><strong>{sites.filter(row => row.source_at).length}/{sites.length}</strong></div>
        <div><span>GSC ข้อมูลล่าสุดพร้อมใช้</span><strong>{sites.filter(row => sourceState(row) === 'FRESH').length}/{sites.length}</strong></div>
      </div>
      {sites.some(row => row.gsc_state !== 'READY') && <div className="seo-network-warning"><AlertTriangle size={18}/><div><strong>การดึงข้อมูล GSC ใหม่ยังติดข้อจำกัดการเชื่อมต่อ</strong><p>{sites.find(row => row.gsc_state !== 'READY')?.gsc_note}</p><small>ผลเก่าจะแสดงวันที่ต้นทาง • “—” หมายถึงยังไม่มีข้อมูล ไม่ใช่อันดับหายหรือยอดเป็นศูนย์</small></div></div>}
      <p className="seo-network-note">ช่วง 28 วัน • “ยอดรวมเว็บ” มาจาก GSC แยกตาม hostname ของเว็บนั้น • “ตัวอย่างคำค้น” เป็นข้อมูลเก่าที่รวมเฉพาะคำค้นที่นำเข้า • อันดับเฉลี่ย GSC แยกจากการตรวจอันดับหน้าค้นหา</p>
      <div className="seo-network-table-wrap"><table className="seo-network-table">
        <caption>ภาพรวมเว็บทั้งหมด • กดชื่อเว็บเพื่อดูรายละเอียด</caption>
        <thead><tr><th>เว็บไซต์</th><th>คลิก</th><th>การแสดงผล</th><th>CTR</th><th>อันดับเฉลี่ย GSC</th><th>ข้อมูลต้นทาง</th><th>สุขภาพเว็บ</th></tr></thead>
        <tbody>{sites.map(row => <tr key={row.id} className={selected === row.id ? 'selected' : ''}>
          <th><button onClick={() => setSelected(row.id)} aria-pressed={selected === row.id}>{row.label}</button></th>
          <td>{format(row.clicks)}</td><td>{format(row.impressions)}</td><td>{percent(row.ctr)}</td><td>{format(row.position, 2)}</td>
          <td><strong>{sourceLabels[sourceState(row)]}</strong><small>{row.coverage === 'SITE_TOTAL' ? 'ยอดรวมเว็บ • นำเข้า' : 'ตัวอย่างคำค้น • ต้นทาง'} {time(row.source_at)}</small>{row.data_end_date && <small>ข้อมูลถึง {row.data_end_date} • ผลล่าสุด {row.last_data_date || 'ไม่มีแถวข้อมูล'}</small>}</td>
          <td><strong>{healthLabels[row.health_state] || row.health_state}</strong><small>{time(row.last_check_at)}</small></td>
        </tr>)}</tbody>
      </table></div>
      <section className="seo-tower-section"><h2>สิ่งที่ควรตรวจต่อ</h2><div className="seo-network-priorities">
        {priorities.length === 0 ? <p>ไม่พบประเด็นจากผลตรวจที่มีอยู่</p> : priorities.slice(0, 8).map((issue, index) => <button key={`${issue.site.id}:${index}`} className={issue.level} onClick={() => { setSelected(issue.site.id); setView(issue.level === 'critical' ? 'health' : 'queries') }}>
          <strong>{issue.site.label} • {issue.text}</strong><span>{issue.action}</span>
        </button>)}
      </div><small>แสดง {Math.min(priorities.length, 8)} จาก {priorities.length} ประเด็น • เลือกเว็บเพื่อดูผลตรวจของเว็บนั้น</small></section>
      {site && <section className="seo-tower-section">
        <div className="seo-network-detail-head"><h2>{site.label}</h2><a href={site.origin} target="_blank" rel="noreferrer">เปิดเว็บ <ExternalLink size={14}/></a></div>
        <nav className="seo-network-tabs" aria-label="รายละเอียดเว็บไซต์">
          {([['queries','คีย์เวิร์ด'],['health','สุขภาพเว็บ'],['history','ประวัติผล SEO']] as const).map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
        </nav>
        {detailError && <p role="alert">โหลดประวัติไม่ได้: {detailError}</p>}
        {latest?.data_start_date && <p className="seo-network-note">ช่วงข้อมูล {latest.data_start_date} ถึง {latest.data_end_date} (วันตามเวลา Pacific ของ GSC) • วันที่ล่าสุดที่มีผล {latest.last_data_date || 'ไม่มีแถวข้อมูลในช่วงนี้'} • นำเข้า {time(latest.source_at)}<br/>ใช้ข้อมูลที่สรุปแล้ว จึงไม่รวมวันล่าสุดที่ Google ยังประมวลผล • {latest.query_truncated ? 'แสดงคำค้นสูงสุด 2,000 คู่คำค้นและหน้า' : 'รายการคำค้นอาจไม่ครบเพราะ Google จำกัดข้อมูลบางส่วน'}</p>}
        {view === 'queries' && <>
          <p className="seo-network-note">คีย์เวิร์ดเป้าหมาย: {site.tracked_queries.join(' • ')}<br/>ข้อมูลต้นทาง {time(latest?.source_at || null)} • ค่าเปลี่ยนแปลงเทียบ snapshot ก่อนอย่างน้อย 3 วัน เฉพาะคู่คำค้นและ URL เดิมเมื่อข้อมูลล่าสุดไม่เก่า</p>
          {detailLoading ? <p role="status">กำลังโหลดคีย์เวิร์ด…</p> : !latest ? <div className="seo-tower-empty">ยังไม่มีข้อมูลคีย์เวิร์ดของเว็บนี้ • {site.gsc_note}</div> : <div className="seo-network-table-wrap"><table className="seo-network-table">
            <thead><tr><th>คีย์เวิร์ด / หน้า</th><th>อันดับก่อน</th><th>ล่าสุด</th><th>เปลี่ยนแปลง</th><th>คลิก / การแสดงผล</th></tr></thead>
            <tbody>{queries.slice(0, 50).map((query, index) => {
              const old = previous?.queries.find(row => row.query === query.query && row.page === query.page)
              const delta = old?.position != null && query.position != null && sourceState(site) === 'FRESH' ? query.position - old.position : null
              return <tr key={`${query.query}:${query.page}:${index}`}><th>{query.query}<small><a href={query.page} target="_blank" rel="noreferrer">{query.page}</a></small></th><td>{format(old?.position, 2)}</td><td>{format(query.position, 2)}</td><td>{delta == null ? 'ยังเทียบไม่ได้' : delta === 0 ? 'คงเดิม' : `${delta < 0 ? 'ขึ้น' : 'ลง'} ${format(Math.abs(delta), 2)}`}</td><td>{format(query.clicks)} / {format(query.impressions)}</td></tr>
            })}</tbody>
          </table><small>แสดงสูงสุด 50 คู่คำค้นและหน้า • คำที่ไม่อยู่ในข้อมูลยังสรุปว่าอันดับหายไม่ได้</small></div>}
        </>}
        {view === 'health' && <div className="seo-network-health-detail">
          <p>ตรวจล่าสุด {time(site.last_check_at)} • รอบถัดไป {time(site.next_check_at)}</p>
          <dl><dt>หน้าแรก</dt><dd>{format(site.home_status)} {site.health_error}</dd><dt>robots.txt</dt><dd>{format(site.robots_status)} {site.robots_error} {site.robots_blocks_all ? 'พบรูปแบบ Disallow ทั้งเว็บ ควรตรวจยืนยัน' : ''}</dd><dt>{site.sitemap_path || '/sitemap.xml'}</dt><dd>{format(site.sitemap_status)} {site.sitemap_error}</dd><dt>Noindex หน้าแรก</dt><dd>{site.noindex == null ? 'ยังยืนยันไม่ได้' : site.noindex ? 'พบ noindex' : 'ไม่พบในผลตรวจ'}</dd><dt>Canonical หน้าแรก</dt><dd>{site.canonical || 'ยังไม่มีค่าที่อ่านได้'}</dd><dt>ไฟล์เปลี่ยนจากรอบก่อน</dt><dd>{site.robots_changed || site.sitemap_changed ? 'พบการเปลี่ยนแปลง' : 'ยังไม่พบ / ยังไม่มีรอบก่อน'}</dd><dt>ความเร็ว / Core Web Vitals</dt><dd>ยังไม่ได้เชื่อมตัววัดความเร็ว</dd></dl>
          <p className="seo-network-note">เป็นการตรวจ 3 URL หลักจากตำแหน่งเซิร์ฟเวอร์ ยังไม่ใช่การ crawl ทุกหน้า หรือการยืนยันว่า Google จัดทำดัชนีแล้ว</p>
          {networkIssues(site).map((issue, i) => <p key={i}>{issue.text} — {issue.action}</p>)}
        </div>}
        {view === 'history' && <div className="seo-network-table-wrap"><table className="seo-network-table"><thead><tr><th>ข้อมูลต้นทาง / นำเข้า</th><th>ช่วงข้อมูล / ประเภท</th><th>คลิก</th><th>การแสดงผล</th><th>CTR</th><th>อันดับเฉลี่ย</th></tr></thead><tbody>{history.map(row => <tr key={row.id}><td>{time(row.source_at)}</td><td>{row.coverage === 'SITE_TOTAL' ? 'ยอดรวมเว็บ' : 'ตัวอย่างคำค้น'}<small>{row.data_start_date} {row.data_end_date ? `ถึง ${row.data_end_date}` : ''}</small></td><td>{format(row.clicks)}</td><td>{format(row.impressions)}</td><td>{percent(row.ctr)}</td><td>{format(row.position, 2)}</td></tr>)}</tbody></table>{!history.length && !detailLoading && <p>ยังไม่มีประวัติผล SEO</p>}<p className="seo-network-note">เปรียบเทียบเฉพาะผลตรวจที่ใช้ประเภทข้อมูลเดียวกัน</p></div>}
      </section>}
    </>}
  </div>
}
