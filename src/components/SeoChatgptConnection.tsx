import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
export const seoConnectorUrl='https://hub.amphon.co.th/seo-connector/mcp'
async function connectorAction(action:string,body:Record<string,unknown>={}) {
 if(!supabase)throw new Error('ยังไม่ได้เชื่อมฐานข้อมูล')
 const {data,error}=await supabase.auth.getSession()
 if(error||!data.session)throw new Error('กรุณาเข้าสู่ระบบใหม่')
 const r=await fetch('https://hub.amphon.co.th/seo-connector/'+action,{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify(body)})
 const result=await r.json();if(!r.ok)throw new Error(result.error||'เชื่อมต่อไม่สำเร็จ');return result
}
export function SeoChatgptConsent({requestId,isOwner}:{requestId:string;isOwner:boolean}) {
 const [request,setRequest]=useState<{name:string;redirect_uri:string;scopes:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 useEffect(()=>{let live=true;if(isOwner)void connectorAction('request',{id:requestId}).then(r=>{if(live)setRequest(r)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[requestId,isOwner])
 async function connect(){setBusy(true);setError('');try{const r=await connectorAction('consent',{id:requestId});const u=new URL(r.redirect);if(u.protocol!=='https:'||!['chatgpt.com','chat.openai.com'].includes(u.hostname))throw new Error('ปลายทางไม่ถูกต้อง');window.location.assign(u.href)}catch(e){setError(e instanceof Error?e.message:'เชื่อมต่อไม่สำเร็จ');setBusy(false)}}
 return <main className="phone-frame"><section className="seo-network-section"><h1>เชื่อม ChatGPT กับ SEO Hub</h1>
 {!isOwner?<p role="alert">การเชื่อมต่อนี้ต้องใช้บัญชีเจ้าของร้าน</p>:<>
 <p>อนุญาตให้ {request?.name||'ChatGPT'} อ่านข้อมูล SEO/GSC ของเว็บในเครือ{request?.scopes.includes('seo:draft')?' และสร้างร่างเนื้อหาที่รอคุณทบทวนใน Hub':''}</p>
 <p>สิทธิ์นี้ไม่รวมการอนุมัติร่าง การเผยแพร่เว็บไซต์ หรือการอ่านแชทลูกค้าและข้อมูลส่วนตัว</p>
 {request&&<p>กลับไปยัง: {new URL(request.redirect_uri).hostname}</p>}
 {error&&<p role="alert">{error}</p>}
 <button disabled={busy||!request} onClick={()=>void connect()}>{busy?'กำลังเชื่อมต่อ…':'อนุญาตให้อ่านและสร้างร่าง'}</button>
 </>}
 <button disabled={busy} onClick={()=>window.location.assign('/')}>ยกเลิก</button>
 </section></main>
}
export function SeoChatgptConnection() {
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 async function disconnect(){setBusy(true);try{await connectorAction('disconnect');setNotice('ยกเลิกสิทธิ์ตัวเชื่อม ChatGPT ทั้งหมดของบัญชีนี้แล้ว')}catch(e){setNotice(e instanceof Error?e.message:'ยกเลิกไม่สำเร็จ')}finally{setBusy(false)}}
 return <details><summary>เชื่อม ChatGPT เพื่อวิเคราะห์และสร้างร่าง</summary>
 <p>เพิ่ม Custom MCP server ใน ChatGPT Plugins ตั้งชื่อ AMPHON SEO แล้วใช้ URL นี้ พร้อม OAuth จากนั้นเข้าสู่ Hub ด้วยบัญชีเจ้าของเพื่ออนุญาต</p>
 <pre className="seo-evidence-excerpt">{seoConnectorUrl}</pre>
 <button onClick={()=>void navigator.clipboard.writeText(seoConnectorUrl).then(()=>setNotice('คัดลอก URL แล้ว')).catch(()=>setNotice('กรุณาคัดลอก URL ด้านบน'))}>คัดลอก URL</button>
 <p>สั่ง ChatGPT ให้ตรวจ GSC และหลักฐานหน้าเว็บ แล้วบันทึกร่างพร้อมเหตุผล • คุณตรวจและอนุมัติใน Hub ก่อนนำไปแก้เว็บไซต์ • Experiments เริ่มหลังตรวจเนื้อหาที่เผยแพร่จริง</p>
 <p>การเชื่อมต่อไม่เรียก AI API ของร้านเพิ่ม การใช้งาน ChatGPT เป็นไปตามแพ็กเกจของคุณ</p>
 <button disabled={busy} onClick={()=>void disconnect()}>ยกเลิกสิทธิ์ ChatGPT ของบัญชีนี้ทั้งหมด</button>
 {notice&&<p role="status">{notice}</p>}
 </details>
}
