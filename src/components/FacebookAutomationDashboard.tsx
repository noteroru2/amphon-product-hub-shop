import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { getFacebookAutomationDashboard, type FacebookAutomationDashboard } from '../lib/channelSettings'

const labels:Record<string,string>={
 READY:'พร้อมโพสต์',WAITING_BUDGET:'รอโควตา',WAITING_GAP:'รอเวลา/เว้นช่วง',
 META_COOLDOWN:'Meta พักการใช้งาน',NEEDS_REVIEW:'ต้องตรวจ Post ID',
 FAILED:'โพสต์ผิดพลาด',POSTING:'กำลังโพสต์',REPAIR_PENDING:'รอยืนยันข้อมูล',
 PAUSED:'พักการโพสต์',
}
const time=(value?:string|null)=>{
 if(!value)return '—'
 const date=new Date(value)
 return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('th-TH',{
  timeZone:'Asia/Bangkok',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',
 }).format(date)
}
const money=(v:number|null)=>v==null?'—':Number(v).toLocaleString('th-TH',{maximumFractionDigits:0})+' ฿'
export default function FacebookAutomationDashboard(){
 const [data,setData]=useState<FacebookAutomationDashboard|null>(null)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const refresh=useCallback(async()=>{
  try{setData(await getFacebookAutomationDashboard());setError('')}
  catch(e){setError(e instanceof Error?e.message:'โหลดรายงาน Facebook ไม่สำเร็จ')}
  finally{setLoading(false)}
 },[])
 useEffect(()=>{
  void refresh()
  const id=window.setInterval(()=>void refresh(),60_000)
  return()=>window.clearInterval(id)
 },[refresh])
 const statuses=['READY','WAITING_BUDGET','WAITING_GAP','META_COOLDOWN','NEEDS_REVIEW','FAILED','POSTING','REPAIR_PENDING']
 return <section className="auto-publish-banner facebook-automation-dashboard" aria-label="Facebook Automation">
  <div style={{display:'flex',alignItems:'center',gap:10,justifyContent:'space-between',flexWrap:'wrap'}}>
   <div>
    <strong>Facebook Automation · รายงาน Production</strong>
    <small style={{display:'block'}}>โพสต์จริง, คิวรอ, Meta API Usage และ Post ID · อัปเดต {time(data?.generatedAt)}</small>
   </div>
   <button type="button" onClick={()=>void refresh()} disabled={loading} aria-label="รีเฟรชรายงาน Facebook">
    <RefreshCw size={15}/> {loading?'กำลังโหลด':'รีเฟรช'}
   </button>
  </div>
  {error&&<div role="alert" className="distribution-error">{error}</div>}
  {data&&<>
   <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
    {data.pages.map(p=><div key={p.connectionKey} style={{
     flex:'1 1 260px',minWidth:220,padding:12,border:'1px solid var(--border,#d4d4d8)',borderRadius:10
    }}>
     <strong>{p.connectionKey==='page_1'?'เพจ 1':'เพจ 2'} · {p.postsToday} โพสต์วันนี้</strong>
     <small style={{display:'block'}}>ยืนยัน Post ID: {p.confirmedReceipts} รายการ · 7 วัน: {p.postsLast7Days} โพสต์</small>
     <small style={{display:'block'}}>Meta usage สูงสุด {p.usagePercent}% · API errors 24 ชม. {p.graphErrors24h}</small>
     <small style={{display:'block'}}>Feed ตอบสำเร็จ 24 ชม. {p.feedSuccess24h} · รอตรวจ Post ID {p.needsPostIdReview}</small>
     {p.cooldownReason&&p.cooldownUntil&&new Date(p.cooldownUntil)>new Date()&&
       <small style={{display:'block'}}>Meta cooldown: {time(p.cooldownUntil)}</small>}
     {data.financeVisible&&<small style={{display:'block'}}>
      ยอดขายที่ระบุแหล่งตรง {p.directSales??0} รายการ · กำไร {money(p.directProfit)}
     </small>}
    </div>)}
   </div>
   <small style={{display:'block'}}>ตั้งค่า: สูงสุด {data.settings?.rolling_24h_budget??'—'} โพสต์/เพจ/24 ชม. · ห่างกัน ≥{data.settings?.min_page_gap_minutes??'—'} นาที · เวลา {data.settings?.publish_window_start_hour??9}:00–{data.settings?.publish_window_end_hour??21}:00</small>
   <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
    {statuses.map(status=>{
     const total=data.pages.reduce((sum,p)=>sum+Number(p.queueCounts[status]||0),0)
     return <span key={status} style={{
      border:'1px solid var(--border,#d4d4d8)',borderRadius:8,padding:'6px 10px',fontSize:12,
     }}>{labels[status]} <strong>{total}</strong></span>
    })}
   </div>
   <div style={{display:'flex',flexWrap:'wrap',gap:20}}>
    {data.pages.map(p=>{
     const last7=data.daily.filter(x=>x.connection_key===p.connectionKey).slice(0,7).reverse()
     return <div key={p.connectionKey} style={{flex:'1 1 280px'}}>
      <strong>แนวโน้ม 7 วัน · {p.connectionKey==='page_1'?'เพจ 1':'เพจ 2'}</strong>
      {last7.map(day=><div key={day.day_bkk} style={{display:'flex',alignItems:'center',gap:8,margin:'6px 0',fontSize:12}}>
       <span style={{width:70}}>{day.day_bkk.slice(5)}</span>
       <div style={{height:9,flex:1,borderRadius:6,background:'var(--border,#e4e4e7)',overflow:'hidden'}}>
        <div style={{height:'100%',width:Math.min(100,Number(day.posted_count)/Math.max(6,Number(data.settings?.rolling_24h_budget||6))*100)+'%',background:'var(--primary,#2563eb)'}}/>
       </div>
       <strong style={{minWidth:16}}>{day.posted_count}</strong>
      </div>)}
      {!last7.length&&<small>ยังไม่มีประวัติในช่วงนี้</small>}
     </div>
    })}
   </div>
   <div style={{width:'100%',overflowX:'auto'}}>
    <strong>คิวงาน · เรียงจากกำหนดโพสต์</strong>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
     <thead><tr><th style={{textAlign:'left'}}>เพจ</th><th style={{textAlign:'left'}}>สินค้า</th><th style={{textAlign:'left'}}>สถานะ</th><th>อายุสต๊อก</th><th>กำหนดการ</th></tr></thead>
     <tbody>{data.queue.slice(0,18).map(q=><tr key={q.id}>
      <td>{q.connection_key}</td>
      <td><strong>{q.sku}</strong><small style={{display:'block'}}>{q.title}</small></td>
      <td>{['FAILED','NEEDS_REVIEW','META_COOLDOWN'].includes(q.attention_state)?<AlertTriangle size={14}/>:<CheckCircle2 size={14}/>} {labels[q.attention_state]||q.attention_state}</td>
      <td style={{textAlign:'center'}}>{q.stock_age_days} วัน</td>
      <td style={{textAlign:'center'}}>{time(q.next_eligible_at||q.scheduled_at)}</td>
     </tr>)}</tbody>
    </table>
    {!data.queue.length&&<small>ไม่มีคิวค้าง</small>}
   </div>
   <small>ยอดขาย/กำไรแสดงเฉพาะ Direct attribution จากระบบร้าน ไม่ใช่ Engagement ที่อ่านจาก Meta และการใช้งาน API ต่ำไม่ได้รับประกันว่า Meta จะไม่บล็อกโพสต์</small>
  </>}
 </section>
}
