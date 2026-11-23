import { useState } from 'react'
import { ClipboardCopy, ShieldCheck, ExternalLink } from 'lucide-react'
import type { SiteReleaseGate, ReleaseLevel, MeasurementStatus } from '../../supabase/functions/seo-connector/releaseMeasurement'

type Props = {
  siteId: string
  gates?: SiteReleaseGate[]
  lastUpdated?: string
}
const levelLabel: Record<ReleaseLevel,string> = {
  NO_LEDGER_EVENT:'ยังไม่มีข้อมูล Release',
  COMMIT_ONLY:'พบ Commit เท่านั้น',
  PROVIDER_DEPLOY_ONLY:'Provider แจ้ง Deploy • ยังไม่ยืนยัน Production',
  LEDGER_CLAIM_INCOMPLETE:'Ledger อ้างว่ายืนยันแล้ว แต่หลักฐานไม่ครบ',
  PRODUCTION_EVIDENCE_COMPLETE:'มีหลักฐาน Production ครบตามเกณฑ์ Ledger',
}
const statusLabel:Record<MeasurementStatus,string> = {
  PRODUCTION_NOT_VERIFIED:'ยังเริ่มวัดผล Release นี้ไม่ได้',
  URL_SCOPE_UNKNOWN:'ยังไม่ระบุ URL ที่ถูกแก้',
  WAITING_FINAL_GSC:'รอข้อมูล Final ของ Google',
  DATE_SCOPED_GSC_REQUIRED:'ถึงรอบขอข้อมูล GSC แบบระบุวันที่แล้ว',
}
const proofNames:Record<string,string> = {
  VERIFY_REPO_AND_HOSTING_MAPPING:'ตรวจ Repo/Hosting Production อีกครั้ง',
  PROVIDER_PRODUCTION_DEPLOY_RECEIPT:'ยังไม่มีหลักฐาน Deploy จาก Hosting',
  PRODUCTION_COMMIT_SHA_40_HEX:'ต้องยืนยัน Commit SHA ที่รันจริง',
  POST_DEPLOY_QA_PASS:'ต้องมี QA หลัง Deploy ที่ผ่านจริง',
  GITHUB_SHA_HOSTING_CORRELATION:'ต้องจับคู่ Hosting SHA กับ GitHub',
  APEX_DOMAIN_HOSTING_ROUTE_PROOF:'ต้องยืนยันว่าโดเมนจริงชี้ไป Deployment นี้',
  LIVE_HTTP_RESPONSE_PROOF:'ต้องมีหลักฐาน HTTP ของหน้าเว็บ Production',
  HOSTING_DEPLOYMENT_ID:'ต้องมี Deployment ID จาก Provider',
  PRODUCTION_VERIFIED_LEDGER_EVENT:'ต้องบันทึกเหตุการณ์ Production Verified',
  VERIFIED_AFFECTED_URL_SCOPE:'ต้องระบุ URL ที่เปลี่ยนและผ่านการตรวจ',
}
const asDate=(raw:string|null)=>raw ? new Date(raw).toLocaleString(
  'th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'},
) : '—'

export function SeoReleaseVerificationPanel({siteId,gates,lastUpdated}:Props) {
  const [copyResult,setCopyResult]=useState('')
  const selected=gates?.find(row=>row.site_id===siteId)
  const verified=(gates||[]).filter(row=>row.level==='PRODUCTION_EVIDENCE_COMPLETE').length
  const provider=(gates||[]).filter(row=>row.provider_deploy_count>0).length
  async function copyVerificationOrder(){
    if(!selected)return
    const packet={
      schema:'amphon.seo.release-verification-order.v1',
      assembled_at:new Date().toISOString(),
      source:'HUB_RELEASE_LEDGER_READ_ONLY',
      site_id:siteId,
      release_gate:selected,
      instructions:[
        'ยืนยัน Mapping Repo/Branch กับ Hosting Project จริง ไม่เชื่อเพียง Commit Observed',
        'ตรวจ Provider deployment ID และ SHA ที่ Build/Deploy โดยใช้ GitHub และ Hosting ที่เชื่อม',
        'ยืนยันโดเมน Public จริงและตอบ HTTP สำเร็จ พร้อมหลักฐานตรวจหน้าที่กระทบ',
        'บันทึก PRODUCTION_VERIFIED ได้เฉพาะหลังทวน QA PASS, Github SHA, Domain Route, HTTP และ Deployment ID จริง',
        'วัดผล GSC จาก Query/Page ที่กำหนดช่วงวันที่ก่อน-หลัง Release เฉพาะ URL ที่เปลี่ยน ห้ามเปรียบเทียบ Rolling Window ปนกัน',
        'อ้างอิงวันและแหล่งที่มาของข้อมูล GSC Final และไม่อ้างว่า Average Position เป็นอันดับสด',
        'ห้าม Merge, Deploy, เปลี่ยน DNS หรือเขียนสถานะ Verified หากยังไม่มีหลักฐาน',
      ],
      excluded_permissions:['merge','deploy','dns_change','customer_data_access'],
    }
    try{
      await navigator.clipboard.writeText(
        'ตรวจหลักฐาน Production และเตรียมแผนวัดผล SEO จากข้อมูลจริง โดยห้ามเขียน Verified เองโดยไร้หลักฐาน\n'+
        JSON.stringify(packet,null,2),
      )
      setCopyResult('คัดลอกคำสั่งตรวจ Release พร้อมรายการหลักฐานแล้ว')
    }catch{setCopyResult('คัดลอกไม่ได้ กรุณาตรวจสิทธิ์ Clipboard')}
  }
  return <section className="seo-release-panel" aria-label="Production Release Verification">
    <div className="seo-dev-heading">
      <div><h3>Production Release Verification</h3>
        <p>ตรวจความสัมพันธ์ GitHub SHA → Hosting → URL จริง → GSC Final ก่อนสรุปผล</p>
      </div>
      <button type="button" onClick={()=>void copyVerificationOrder()} disabled={!selected}>
        <ClipboardCopy size={16} aria-hidden/> คัดลอกคำสั่งตรวจ Release
      </button>
    </div>
    {!gates?<p className="seo-dev-warning">
      ฟังก์ชันตรวจ Release เวอร์ชันใหม่ยังไม่ตอบข้อมูลจาก Edge Function หรือยังไม่ได้ Deploy
    </p>:<>
      <div className="seo-dev-stats">
        <div><small>เว็บที่มีเหตุการณ์ Deploy</small><strong>{provider}/{gates.length}</strong></div>
        <div><small>Production มีหลักฐานครบ</small><strong>{verified}/{gates.length}</strong></div>
        <div><small>เว็บไซต์ที่ยังขาดหลักฐาน</small><strong>{gates.length-verified}</strong></div>
        <div><small>การอนุญาต Deploy อัตโนมัติ</small><strong>ปิด</strong></div>
      </div>
      {selected&&<>
        <div className="seo-dev-selected">
          <div className="seo-dev-selected-title">
            <ShieldCheck size={18} aria-hidden />
            <strong>{selected.label}</strong>
            <span className="seo-dev-release-state">{levelLabel[selected.level]}</span>
          </div>
          <div className="seo-dev-selected-grid">
            <div><small>เหตุการณ์ล่าสุด</small><strong>{selected.latest_event_kind||'ยังไม่มี'}</strong></div>
            <div><small>ข้อมูลจาก Provider</small><strong>{selected.latest_provider||'ยังไม่มี'}</strong></div>
            <div><small>วันเหตุการณ์ล่าสุด</small><strong>{asDate(selected.latest_event_at)}</strong></div>
            <div><small>SHA ล่าสุดใน Ledger</small><strong>{selected.latest_sha?.slice(0,12)||'ยังไม่ยืนยัน SHA'}</strong></div>
          </div>
          <strong className="seo-dev-release-subtitle">หลักฐานที่ยังขาด</strong>
          {selected.missing_evidence.length===0 ? <p className="seo-dev-footnote">
            เกณฑ์หลักฐานใน Ledger ครบแล้ว ต้องตรวจ Provider และ Hosting จริงซ้ำก่อนใช้ตัดสินใจ
          </p>:
            <ul className="seo-dev-proof-list">{selected.missing_evidence.map(code=>
              <li key={code}>{proofNames[code]||code}</li>)}</ul>}
          <strong className="seo-dev-release-subtitle">แผนตรวจผลหลัง Release แบบระบุวันที่</strong>
          <div className="seo-dev-measure-table-wrap"><table className="seo-dev-measure-table">
            <thead><tr><th>รอบ</th><th>ก่อน Release</th><th>หลัง Release</th><th>สถานะ</th></tr></thead>
            <tbody>{selected.measurement_windows.map(row=>
              <tr key={row.days}>
                <th>{row.days} วัน</th>
                <td>{row.baseline_start ? row.baseline_start+' ถึง '+row.baseline_end : '—'}</td>
                <td>{row.after_start ? row.after_start+' ถึง '+row.after_end : '—'}</td>
                <td>{statusLabel[row.status]}</td>
              </tr>)}</tbody>
          </table></div>
          <p className="seo-dev-footnote">
            ไม่มีการคำนวณอันดับเพิ่ม/ลดจาก Rolling GSC Snapshot • ต้องมี GSC ที่กรอง URL, คำค้น และช่วงก่อน/หลังให้ตรงกันก่อน
            {lastUpdated?' • รอบข้อมูล GSC ล่าสุด '+lastUpdated:''}
          </p>
        </div>
      </>}
      <div className="seo-dev-site-list">
        {gates.map(site=><div key={site.site_id} className="seo-dev-site-row">
          <span>{site.label}</span>
          <span className="seo-dev-site-state">{levelLabel[site.level]}</span>
        </div>)}
      </div>
    </>}
    {copyResult&&<p role="status" className="seo-dev-footnote">{copyResult}</p>}
    <p className="seo-dev-footnote">อ่านสถานะจาก Release Ledger เท่านั้น • ไม่มีปุ่มยืนยัน Production หรือ Deploy อัตโนมัติในหน้านี้</p>
  </section>
}
