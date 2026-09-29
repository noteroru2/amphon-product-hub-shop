import { useEffect,useState } from 'react'
import { ChevronLeft, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react'
import type { Profile } from '../types/product'
import { listChannelConnections, saveChannelCredentials, disconnectChannel, startChannelAuthorization, testChannelConnection, type ChannelConnectionAdmin } from '../lib/channelSettings'

const labels:Record<string,string>={lazada:'Lazada',tiktok_shop:'TikTok Shop',facebook_page:'Facebook Page',shopee:'Shopee'}
const blank={clientId:'',clientSecret:'',accessToken:'',authorizationUrl:'',externalAccountId:''}
const providerHelp:Record<string,string>={
 facebook_page:'Meta App ตั้งครั้งเดียว แล้ว Authorize เพื่อให้ระบบรับ Page Access Token และตรวจ Page ID — ไม่ต้องกรอก Refresh Token',
 lazada:'ใช้ App Key + App Secret จาก Lazada Open Platform แล้วกด Authorize Seller; Access/Refresh Token ให้ระบบรับและเก็บอัตโนมัติ',
 tiktok_shop:'ใช้ App Key + App Secret และ Seller Authorization URL จาก TikTok Shop Partner Center; หลัง Authorize ระบบจะตรวจ Authorized Shop / shop_cipher',
 shopee:'Direct API ยังไม่เปิดสำหรับบัญชีนี้ ระบบคง WAITING_ACCESS และใช้ Manual Listing +18%'
}
export function ChannelSettings({profile,onBack}:{profile:Profile;onBack:()=>void}){
 const [rows,setRows]=useState<ChannelConnectionAdmin[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [editing,setEditing]=useState<string|null>(null);const [form,setForm]=useState(blank)
 const allowed=['owner','admin'].includes(profile.role)
 async function load(){setBusy(true);try{setRows(await listChannelConnections());setError(null)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 useEffect(()=>{if(allowed)void load()},[allowed])
 if(!allowed)return <section className="screen page-pad"><button className="back-link" onClick={onBack}><ChevronLeft/>กลับ</button><div className="empty-state"><ShieldCheck/><h2>Owner/Admin เท่านั้น</h2></div></section>
 async function save(row:ChannelConnectionAdmin){setBusy(true);try{await saveChannelCredentials(row.channelKey,row.connectionKey,form);setEditing(null);setForm(blank);await load()}catch(e){setError(e instanceof Error?e.message:String(e));setBusy(false)}}
 return <section className="screen page-pad channel-settings">
  <header className="topbar"><button className="icon-button" onClick={onBack}><ChevronLeft/></button><div><p className="eyebrow">ADMIN SETTINGS</p><h1>ช่องทางขาย / API</h1></div><button className="icon-button" onClick={()=>void load()} disabled={busy}><RefreshCw/></button></header>
  <div className="security-note"><ShieldCheck size={18}/><span>Secret/Token เก็บใน Server Vault เท่านั้น Token ที่ได้จาก OAuth จะไม่ถูกส่งกลับมาที่หน้าเว็บ</span></div>
  {error&&<div className="inline-error">{error}</div>}
  {rows.map(row=>{const key=row.channelKey+row.connectionKey;const locked=row.channelKey==='shopee';return <article className="settings-card" key={key}>
   <div className="settings-card-head"><div><strong>{labels[row.channelKey]||row.channelKey}</strong><small>{row.label} · {row.connectionKey}</small></div><span className="status-pill">{row.activationStatus==='VERIFIED'||row.activationStatus==='ACTIVE'?'AUTHORIZED':row.hasCredentials?'APP CONFIGURED':row.status}</span></div>
   <div className="settings-meta">บัญชี/ร้าน/Page: {row.externalAccountId||'ยังไม่เชื่อม'} · Credentials: {row.hasCredentials?'ตั้งค่าแล้ว':'ยังไม่มี'} · Guard: {row.activationStatus||'LOCKED'} · {row.environment||'TEST'}</div>
   <div className="security-note"><span>{providerHelp[row.channelKey]}</span></div>
   {locked?null:editing===key?<div className="settings-form">
    {row.channelKey==='facebook_page'&&<><input placeholder="Meta App ID" value={form.clientId} onChange={e=>setForm({...form,clientId:e.target.value})}/><input type="password" autoComplete="new-password" placeholder="Meta App Secret" value={form.clientSecret} onChange={e=>setForm({...form,clientSecret:e.target.value})}/><input placeholder="Page ID (เว้นว่างได้ ระบบจะตรวจหลัง Authorize)" value={form.externalAccountId} onChange={e=>setForm({...form,externalAccountId:e.target.value})}/></>}
    {row.channelKey==='lazada'&&<><input placeholder="Lazada App Key" value={form.clientId} onChange={e=>setForm({...form,clientId:e.target.value})}/><input type="password" autoComplete="new-password" placeholder="Lazada App Secret" value={form.clientSecret} onChange={e=>setForm({...form,clientSecret:e.target.value})}/></>}
    {row.channelKey==='tiktok_shop'&&<><input placeholder="TikTok Shop App Key" value={form.clientId} onChange={e=>setForm({...form,clientId:e.target.value})}/><input type="password" autoComplete="new-password" placeholder="TikTok Shop App Secret" value={form.clientSecret} onChange={e=>setForm({...form,clientSecret:e.target.value})}/><input placeholder="Seller Authorization URL จาก Partner Center" value={form.authorizationUrl} onChange={e=>setForm({...form,authorizationUrl:e.target.value})}/></>}
    <div className="settings-actions"><button onClick={()=>void save(row)} disabled={busy}>บันทึก App Credentials</button><button onClick={()=>setEditing(null)}>ยกเลิก</button></div>
   </div>:<div className="settings-actions"><button onClick={()=>{setForm(blank);setEditing(key)}}><KeyRound size={16}/>ตั้งค่า App</button>{row.hasCredentials&&<button onClick={async()=>{try{const x=await startChannelAuthorization(row.channelKey,row.connectionKey);window.location.assign(x.authorizationUrl)}catch(e){setError(e instanceof Error?e.message:String(e))}}}>Authorize Facebook / Seller</button>}{row.hasCredentials&&row.verifiedAt&&<button onClick={async()=>{try{const x=await testChannelConnection(row.channelKey,row.connectionKey);setError(x.ok?'เชื่อมต่อสำเร็จและตรวจสอบ Shop/Page แล้ว':null);await load()}catch(e){setError(e instanceof Error?e.message:String(e))}}}>Test Connection</button>}{row.hasCredentials&&<button onClick={async()=>{if(window.confirm('ยืนยันตัดการเชื่อมต่อช่องทางนี้?')){await disconnectChannel(row.channelKey,row.connectionKey);await load()}}}>Disconnect</button>}</div>}
  </article>})}
 </section>
}
