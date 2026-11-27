// Gateway tests. Only fixed loopback; diagnostics entry/faults exist in test copies.
import fs from 'node:fs'
import {randomUUID,createHmac} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import sharp from 'sharp'
import http from 'node:http'
const e=Object.fromEntries(fs.readFileSync('tests/evidence-local-supabase/.env.evidence-local-qa','utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1).replace(/^"|"$/g,'')]}))
const api=e.API_URL;if(api!=='http://127.0.0.1:55321')throw Error('LOCAL_ONLY')
const original=globalThis.fetch;globalThis.fetch=(u,i)=>{if(new URL(u).origin!==api)throw Error('LOCAL_ONLY');return original(u,{...i,redirect:'error'})}
// Dispatcher health does not initialize the private user worker. Bound startup
// readiness separately; never retry the actual timed/security test requests.
const readyDeadline=Date.now()+10000;let ready=false
while(Date.now()<readyDeadline){try{const r=await fetch(api+'/functions/v1/_internal/health',{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
if(!ready)throw Error('LOCAL_RUNTIME_NOT_READY_WITHIN_10_SECONDS')
const opts={auth:{persistSession:false,autoRefreshToken:false}},service=createClient(api,e.SERVICE_ROLE_KEY,opts),users={}
const ok=r=>{if(r.error)throw Error('SYNTHETIC_SETUP_FAILED');return r.data}
for(const role of ['owner','admin','sales']) {
 const email=randomUUID()+'@example.invalid',password='SyntheticPassword-For-CI-2026!',u=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user
 ok(await service.from('profiles').insert({id:u.id,role,active:true}))
 const c=createClient(api,e.ANON_KEY,opts),a=ok(await c.auth.signInWithPassword({email,password}));users[role]={c,token:a.session.access_token}
}
const id=randomUUID(),image=randomUUID(),path=id+'/'+image+'.jpg',owner=users.owner
ok(await owner.c.from('trade_evidence').insert({id,kind:'purchase',title:'Synthetic ingress',story:'Synthetic diagnostic evidence only.',website_text:'Synthetic diagnostic website only.',permission_confirmed:true,privacy_reviewed:true}))
const bytes=await sharp({create:{width:40,height:40,channels:3,background:'#123456'}}).jpeg().toBuffer()
ok(await owner.c.storage.from('trade-evidence-private').upload(path,bytes,{contentType:'image/jpeg'}))
ok(await owner.c.from('trade_evidence_images').insert({id:image,evidence_id:id,storage_path:path,approved_for_public:true}))
const results=[]
async function run(name,token,expected,{mode,body,route='evidence-private-media',deadline=8000,min=0,max=7500}={}) {
 const start=performance.now();let status=null,phases='',passed=false
 try {
  const r=await fetch(api+'/functions/v1/'+route,{method:'POST',headers:{apikey:e.ANON_KEY,origin:'https://hub.amphon.co.th',...(token?{authorization:'Bearer '+token}:{}),...(mode?{'x-synthetic-mode':mode}:{})},body:body||JSON.stringify({image_id:image,purpose:'PREVIEW'}),duplex:'half',signal:AbortSignal.timeout(deadline)})
  status=r.status;phases=r.headers.get('server-timing')||'';await r.arrayBuffer()
  passed=status===expected&&(status!==200||/no-store/.test(r.headers.get('cache-control')||''))
 }catch{}
 const ms=Math.round(performance.now()-start);passed=passed&&ms>=min&&ms<max
 const row={name,status,ms,phases,result:passed?'PASS':'FAIL'};results.push(row);console.log(JSON.stringify(row))
}
await run('owner-cold',owner.token,200)
await run('owner-warm',owner.token,200)
await run('admin-preview',users.admin.token,200)
await run('anonymous',null,401)
await run('staff-denied',users.sales.token,403)
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),unsigned=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:randomUUID(),aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)-10})
await run('expired-jwt',unsigned+'.'+createHmac('sha256',e.JWT_SECRET).update(unsigned).digest('base64url'),401)
await users.admin.c.auth.signOut({scope:'local'})
await run('revoked-session',users.admin.token,401)
await run('request-byte-limit',owner.token,422,{body:'x'.repeat(1025)})
await run('response-byte-limit',owner.token,403,{mode:'oversize'})
await run('consent-during-read',owner.token,403,{mode:'revoke'})
ok(await owner.c.from('trade_evidence').update({permission_confirmed:true}).eq('id',id))
await run('storage-stalled',owner.token,403,{mode:'stall',deadline:18000,min:14000,max:17500})
await run('handler-unavailable',owner.token,404,{route:'evidence-handler-not-installed'})
const start=performance.now()
await new Promise(resolve=>{
 const request=http.request(api+'/functions/v1/evidence-private-media',{method:'POST',headers:{apikey:e.ANON_KEY,origin:'https://hub.amphon.co.th',authorization:'Bearer '+owner.token,'transfer-encoding':'chunked'}},response=>{
  const ms=Math.round(performance.now()-start),row={name:'incomplete-body',status:response.statusCode,ms,phases:response.headers['server-timing']||'',result:response.statusCode===422&&ms>=4500&&ms<7500?'PASS':'FAIL'}
  results.push(row);console.log(JSON.stringify(row));response.resume();request.destroy();clearTimeout(timer);resolve()
 })
 const timer=setTimeout(()=>{request.destroy();const row={name:'incomplete-body',status:null,ms:Math.round(performance.now()-start),result:'FAIL'};results.push(row);console.log(JSON.stringify(row));resolve()},8000)
 request.on('error',()=>{});request.write('{')
})
fs.writeFileSync('.evidence-ingress-results.log',JSON.stringify(results,null,2))
globalThis.fetch=original
if(results.some(r=>r.result==='FAIL'))process.exitCode=1
