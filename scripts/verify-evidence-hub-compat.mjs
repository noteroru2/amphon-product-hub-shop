/** Historical Hub policies on disposable Local Supabase only; synthetic pixels. */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {randomUUID,createHmac} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import sharp from 'sharp'
import {createPrivateMediaHandler} from '../supabase/functions/_shared/evidence-private-media.mjs'
const locals=Object.fromEntries(readFileSync(process.env.EVIDENCE_LOCAL_ENV_FILE,'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const at=x.indexOf('=');return [x.slice(0,at),x.slice(at+1).replace(/^"|"$/g,'')]}))
const api=locals.API_URL,origin='https://hub.amphon.co.th'
assert.equal(api,'http://127.0.0.1:55321','Never accept hosted/DNS endpoints')
const original=globalThis.fetch
globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert.equal(u.origin,api,'Local-only transport');return original(input,{...init,redirect:'error'})}
const options={auth:{persistSession:false,autoRefreshToken:false}}
const service=createClient(api,locals.SERVICE_ROLE_KEY,options),anonymous=createClient(api,locals.ANON_KEY,options)
const ok=result=>{assert.equal(result.error,null,result.error?.message);return result.data}
let count=0
const check=async(name,fn)=>{await fn();console.log('PASS HUB MATRIX: '+name);count++}
const bytes=await sharp({create:{width:120,height:80,channels:3,background:'#416273'}}).jpeg().toBuffer()
const users={}
try {
 for(const role of ['owner','admin','sales']) {
  const email='hub-'+role+'-'+randomUUID()+'@example.invalid',password='SyntheticPassword-For-CI-2026!'
  const user=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user
  ok(await service.from('profiles').insert({id:user.id,role,active:true}))
  const client=createClient(api,locals.ANON_KEY,options),auth=ok(await client.auth.signInWithPassword({email,password}))
  users[role]={client,auth,id:user.id,email}
 }
 const edge=(token,id,purpose='PREVIEW',extra={})=>fetch(new URL('/functions/v1/evidence-private-media',api),{method:'POST',headers:{apikey:locals.ANON_KEY,origin,authorization:'Bearer '+token,'content-type':'application/json',...extra},body:JSON.stringify({image_id:id,purpose}),cache:'no-store'})
 for(const role of ['owner','admin']) {
  const u=users[role],id=randomUUID(),image=randomUUID(),path=id+'/'+image+'.jpg'
  u.evidence=id;u.image=image;u.path=path
  await check(role+' creates and edits evidence under real historical RLS/guard',async()=>{
   ok(await u.client.from('trade_evidence').insert({id,kind:'purchase',title:'Synthetic Hub case',story:'Synthetic evidence story for local QA only.',website_text:'Synthetic website description for local QA.',permission_confirmed:true,privacy_reviewed:true,created_by:u.id}))
   ok(await u.client.from('trade_evidence').update({title:'Edited synthetic Hub case'}).eq('id',id))
   assert.equal(ok(await u.client.from('trade_evidence').select('title,status').eq('id',id).single()).title,'Edited synthetic Hub case')
  })
  await check(role+' uploads private image and inserts scoped metadata',async()=>{
   ok(await u.client.storage.from('trade-evidence-private').upload(path,bytes,{contentType:'image/jpeg',upsert:false}))
   ok(await u.client.from('trade_evidence_images').insert({id:image,evidence_id:id,storage_path:path,approved_for_public:true}))
  })
  await check(role+' lists metadata and Storage objects',async()=>{
   assert.equal(ok(await u.client.from('trade_evidence_images').select('id').eq('evidence_id',id)).length,1)
   assert.equal(ok(await u.client.storage.from('trade-evidence-private').list(id)).filter(x=>x.name===image+'.jpg').length,1)
  })
  await check(role+' previews through actual Local Edge and authenticated private download',async()=>{
   const response=await edge(u.auth.session.access_token,image);assert.equal(response.status,200)
   assert.equal((await response.arrayBuffer()).byteLength,bytes.length);assert.match(response.headers.get('cache-control'),/no-store/)
   assert.equal(ok(await u.client.storage.from('trade-evidence-private').download(path)).size,bytes.length)
  })
  await check(role+' signing denied; approval and approved-content edit revoke/reapprove',async()=>{
   assert.ok((await u.client.storage.from('trade-evidence-private').createSignedUrl(path,60)).error)
   ok(await u.client.from('trade_evidence').update({status:'APPROVED'}).eq('id',id))
   assert.equal((await edge(u.auth.session.access_token,image,'EXPORT')).status,role==='owner'?200:403)
   ok(await u.client.from('trade_evidence').update({title:'Changed after approval synthetic'}).eq('id',id))
   assert.equal(ok(await u.client.from('trade_evidence').select('status').eq('id',id).single()).status,'DRAFT')
   ok(await u.client.from('trade_evidence').update({status:'APPROVED'}).eq('id',id))
  })
 }
 const owner=users.owner,admin=users.admin,sales=users.sales
 await check('Owner/Admin cross-staff library listing and preview retain historical permissions',async()=>{
  for(const [u,target]of [[owner,admin],[admin,owner]]) {
   assert.equal(ok(await u.client.from('trade_evidence_images').select('id').eq('id',target.image)).length,1)
   assert.equal((await edge(u.auth.session.access_token,target.image)).status,200)
  }
 })
 await check('anonymous and sales cannot upload, download, sign, preview or see metadata',async()=>{
  for(const client of [anonymous,sales.client]) {
   assert.ok((await client.storage.from('trade-evidence-private').upload(owner.evidence+'/'+randomUUID()+'.jpg',bytes,{contentType:'image/jpeg'})).error)
   assert.ok((await client.storage.from('trade-evidence-private').download(owner.path)).error)
   assert.ok((await client.storage.from('trade-evidence-private').createSignedUrl(owner.path,60)).error)
   const rows=await client.from('trade_evidence_images').select('id');assert.ok(rows.error||rows.data.length===0)
  }
  assert.equal((await edge(sales.auth.session.access_token,owner.image)).status,403)
  assert.equal((await edge('invalid',owner.image)).status,401)
  assert.equal((await fetch(new URL('/storage/v1/object/public/trade-evidence-private/'+owner.path,api))).ok,false)
 })
 // A service-minted synthetic link models a historical bearer URL. It is never logged.
 const historical=ok(await service.storage.from('trade-evidence-private').createSignedUrl(owner.path,60)).signedUrl
 await check('historical bearer URL expiry is enforced by actual Local Storage',async()=>{
  const short=ok(await service.storage.from('trade-evidence-private').createSignedUrl(owner.path,1)).signedUrl
  assert.equal((await fetch(short)).status,200)
  await new Promise(resolve=>setTimeout(resolve,2200))
  assert.equal((await fetch(short)).ok,false)
 })
 await check('consent revoke denies new Edge/direct access but preserves authorized metadata listing',async()=>{
  ok(await owner.client.from('trade_evidence').update({permission_confirmed:false}).eq('id',owner.evidence))
  for(const u of [owner,admin]) {
   assert.equal((await edge(u.auth.session.access_token,owner.image)).status,403)
   assert.ok((await u.client.storage.from('trade-evidence-private').download(owner.path)).error)
   assert.equal(ok(await u.client.storage.from('trade-evidence-private').list(owner.evidence)).length,1)
  }
  assert.equal((await fetch(historical)).status,200,'Historical bearer link is not individually revoked by RLS')
 })
 await check('reapprove restores authorized access; stale EXPORT cannot bypass DRAFT review',async()=>{
  ok(await owner.client.from('trade_evidence').update({permission_confirmed:true}).eq('id',owner.evidence))
  assert.equal((await edge(owner.auth.session.access_token,owner.image,'EXPORT')).status,403)
  assert.equal((await edge(owner.auth.session.access_token,owner.image)).status,200)
  ok(await owner.client.from('trade_evidence').update({status:'APPROVED'}).eq('id',owner.evidence))
  assert.equal((await edge(owner.auth.session.access_token,owner.image,'EXPORT')).status,200)
 })
 await check('consent withdrawn after real Storage read is denied by shared handler post-read check',async()=>{
  const handler=createPrivateMediaHandler({url:api,key:locals.ANON_KEY,allowedOrigin:origin,fetchImpl:async(input,init)=>{
   const response=await fetch(input,init)
   if(new URL(input).pathname.startsWith('/storage/v1/object/authenticated/'))ok(await owner.client.from('trade_evidence').update({permission_confirmed:false}).eq('id',owner.evidence))
   return response
  }})
  const result=await handler(new Request('http://127.0.0.1/private',{method:'POST',headers:{origin,authorization:'Bearer '+owner.auth.session.access_token},body:JSON.stringify({image_id:owner.image,purpose:'PREVIEW'})}))
  assert.equal(result.status,403);assert.equal(await result.text(),'ACCESS_DENIED')
  ok(await owner.client.from('trade_evidence').update({permission_confirmed:true,status:'APPROVED'}).eq('id',owner.evidence))
 })
 await check('actual Edge rejects forged/expired JWT, wrong CORS, GET and excessive request bytes',async()=>{
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),head=enc({alg:'HS256',typ:'JWT'})
  const payload=enc({sub:owner.id,role:'authenticated',aud:'authenticated',session_id:owner.auth.session.user?.session_id,exp:Math.floor(Date.now()/1000)-5}),unsigned=head+'.'+payload
  const expired=unsigned+'.'+createHmac('sha256',locals.JWT_SECRET).update(unsigned).digest('base64url')
  for(const token of ['invalid',expired,unsigned+'.'+'a'.repeat(43)])assert.equal((await edge(token,owner.image)).status,401)
  assert.equal((await edge(owner.auth.session.access_token,owner.image,'PREVIEW',{origin:'https://other.invalid'})).status,403)
  const headers={origin,apikey:locals.ANON_KEY,authorization:'Bearer '+owner.auth.session.access_token}
  assert.equal((await fetch(new URL('/functions/v1/evidence-private-media',api),{method:'GET',headers})).status,404)
  assert.equal((await fetch(new URL('/functions/v1/evidence-private-media',api),{method:'POST',headers,body:'x'.repeat(1025)})).status,422)
 })
 await check('stale signed-out session and inactive Admin cannot retrieve private pixels',async()=>{
  const temp=createClient(api,locals.ANON_KEY,options),login=ok(await temp.auth.signInWithPassword({email:owner.email,password:'SyntheticPassword-For-CI-2026!'}))
  ok(await temp.auth.signOut({scope:'local'}))
  assert.ok([401,403].includes((await edge(login.session.access_token,owner.image)).status))
  ok(await service.from('profiles').update({active:false}).eq('id',admin.id))
  assert.equal((await edge(admin.auth.session.access_token,owner.image)).status,403)
  assert.ok((await admin.client.storage.from('trade-evidence-private').download(owner.path)).error)
  ok(await service.from('profiles').update({active:true}).eq('id',admin.id))
 })
 for(const role of ['owner','admin'])await check(role+' deletes metadata then private object under actual Hub policies, even after consent withdrawal',async()=>{
  const u=users[role];ok(await u.client.from('trade_evidence').update({permission_confirmed:false}).eq('id',u.evidence))
  ok(await u.client.from('trade_evidence_images').delete().eq('id',u.image))
  const deleted=ok(await u.client.storage.from('trade-evidence-private').remove([u.path]));assert.equal(deleted.length,1)
  assert.ok((await service.storage.from('trade-evidence-private').download(u.path)).error)
 })
 console.log('PASS HUB MATRIX TOTAL: '+count+'; historical evidence SQL/policies/triggers; real Local Edge/Auth/Storage only')
}finally{globalThis.fetch=original}
