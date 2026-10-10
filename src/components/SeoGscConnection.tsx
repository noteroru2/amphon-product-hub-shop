import { useEffect, useState } from 'react'
import { gscAction, type GscStatus } from '../lib/seoGsc'

const messages: Record<string,string> = {
  connected:'เชื่อม Google สำเร็จ ระบบกำลังทยอยดึงข้อมูลทุกเว็บที่บัญชีนี้มีสิทธิ์',
  cancelled:'ยกเลิกการอนุญาต Google แล้ว',
  'invalid-state':'คำขอเชื่อมหมดอายุ กรุณากดเชื่อมใหม่',
  failed:'เชื่อมไม่สำเร็จ ตรวจ Redirect URI, เปิด Search Console API และสถานะ Google OAuth แล้วลองใหม่',
  'missing-permission':'ยังไม่ได้รับสิทธิ์อ่าน GSC หรือสิทธิ์ใช้งานอัตโนมัติ กรุณาเชื่อมใหม่',
  'no-sites':'บัญชีนี้ยังไม่มีสิทธิ์ในเว็บที่ติดตาม กรุณาเลือกบัญชี Google ที่ใช้ดู GSC ของเว็บในเครือ',
}
export function SeoGscConnection({ onChanged }: { onChanged: () => void }) {
  const [status,setStatus]=useState<GscStatus | null>(null)
  const [expanded,setExpanded]=useState(false)
  const [editing,setEditing]=useState(false)
  const [clientId,setClientId]=useState('')
  const [secret,setSecret]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  async function load() {
    try { setStatus(await gscAction<GscStatus>('status')); setError('') }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  useEffect(()=>{
    const url=new URL(window.location.href); const result=url.searchParams.get('gsc')
    if(result) {
      setMessage(messages[result] || 'ตรวจสถานะการเชื่อม Google'); setExpanded(true)
      url.searchParams.delete('gsc'); window.history.replaceState(window.history.state,'',url.toString())
    }
    void load()
    const timer=window.setInterval(()=>{ if(document.visibilityState==='visible') void load() },60_000)
    return ()=>window.clearInterval(timer)
  },[])
  async function action(name:string,payload:Record<string,unknown>={}) {
    setBusy(true); setError(''); setMessage('')
    try {
      const result=await gscAction<{url?:string}>(name,payload)
      if(name==='start' && result.url) {
        const url=new URL(result.url)
        if(url.origin!=='https://accounts.google.com') throw new Error('URL เชื่อม Google ไม่ถูกต้อง')
        window.location.assign(url.toString()); return
      }
      if(name==='configure') { setSecret(''); setClientId(''); setEditing(false); setMessage('บันทึกแล้ว กดเชื่อม Google Search Console เพื่ออนุญาตบัญชี') }
      if(name==='sync') setMessage('เข้าคิวดึงข้อมูลแล้ว ระบบทยอยตรวจเว็บละรอบ โปรดโหลดผลล่าสุดในอีกไม่กี่นาที')
      if(name==='disconnect') setMessage('หยุดการดึงจากบัญชีนี้แล้ว ประวัติผลตรวจยังคงอยู่')
      await load(); onChanged()
    } catch(err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <section className="seo-gsc-connection">
    <div className="seo-network-detail-head"><div><h3>Google Search Console โดยตรง</h3><p>{status?.configured ? `${status.connections.filter(c=>c.state==='READY').length} บัญชีพร้อมใช้งาน • ${status.jobs.length} เว็บเข้าคิวดึงข้อมูลทุก 3 วัน` : 'ตั้งค่า Google OAuth แล้วอนุญาตบัญชีที่ดูแลเว็บในเครือ'}</p></div><button onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>{expanded?'ซ่อนการเชื่อมต่อ':'ตั้งค่า / เชื่อม Google'}</button></div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {expanded && <>
      <p>อ่านข้อมูลเท่านั้น • ไม่แก้ไขเว็บไซต์หรือการตั้งค่า Search Console • เก็บสิทธิ์เชื่อมต่อฝั่งเซิร์ฟเวอร์</p>
      {(!status?.configured || editing) && <form onSubmit={event=>{ event.preventDefault(); void action('configure',{client_id:clientId,client_secret:secret}) }}>
        <ol><li>เปิด <a href="https://console.cloud.google.com/apis/library/searchconsole.googleapis.com" target="_blank" rel="noreferrer">Google Cloud → Search Console API</a> และกด Enable</li><li>ตั้ง Google Auth Platform และสร้าง OAuth Client ชนิด Web application</li><li>ใส่ Authorized redirect URI ตามด้านล่าง แล้วนำ Client ID และ Client Secret มากรอก (เฉพาะเจ้าของ)</li></ol>
        <label>Authorized redirect URI<input readOnly value={status?.redirect_uri || 'https://mfpdtlxwdbxitgfzdape.supabase.co/functions/v1/seo-gsc/callback'} onFocus={e=>e.currentTarget.select()}/></label>
        <label>Client ID<input required value={clientId} onChange={e=>setClientId(e.target.value)} autoComplete="off"/></label>
        <label>Client Secret<input required type="password" value={secret} onChange={e=>setSecret(e.target.value)} autoComplete="off"/></label>
        <button disabled={busy || !status} type="submit">บันทึกการตั้งค่า Google</button>
        <p className="seo-network-note">หาก OAuth ยังอยู่ใน Testing ให้เพิ่มบัญชีคุณเป็น Test user และเตรียมเปลี่ยนเป็น Production สำหรับงานระยะยาว เพราะสิทธิ์ที่ออกในโหมดทดสอบอาจหมดอายุ</p>
      </form>}
      {status?.configured && <div className="seo-network-tabs"><button disabled={busy} onClick={()=>void action('start')}>เชื่อม Google Search Console</button><button disabled={busy || !status.jobs.length} onClick={()=>void action('sync')}>ดึงข้อมูลใหม่ทุกเว็บ</button><button disabled={busy} onClick={()=>setEditing(!editing)}>{editing?'ปิดการตั้งค่า':'แก้ไข OAuth Client (เจ้าของ)'}</button></div>}
      {status?.connections.map(c=><div key={c.id} className="seo-gsc-account"><span>{c.state==='READY'?'เชื่อมแล้ว':c.state==='REAUTH'?'ต้องอนุญาตใหม่':c.state} • มีสิทธิ์ {c.property_count} properties</span><button disabled={busy} onClick={()=>void action('disconnect',{id:c.id})}>หยุดเชื่อมบัญชีนี้</button></div>)}
      {status?.jobs.some(j=>j.last_error) && <p>บางเว็บดึงไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ รายละเอียดแสดงในสถานะของแต่ละเว็บ</p>}
    </>}
  </section>
}
