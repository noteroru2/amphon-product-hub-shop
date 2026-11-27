// Local-only functional A/B and separate ingress-abuse C criteria. No retries.
import fs from 'node:fs'
import http from 'node:http'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import sharp from 'sharp'
import {createPrivateMediaHandler} from '../supabase/functions/_shared/evidence-private-media.mjs'
const e=Object.fromEntries(fs.readFileSync('tests/evidence-local-supabase/.env.evidence-local-qa','utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1).replace(/^"|"$/g,'')]}))
const api=e.API_URL;assert.equal(api,'http://127.0.0.1:55321')
const native=globalThis.fetch;globalThis.fetch=(u,i)=>{assert.equal(new URL(u).origin,api);return native(u,{...i,redirect:'error'})}
const options={auth:{persistSession:false,autoRefreshToken:false}},service=createClient(api,e.SERVICE_ROLE_KEY,options),owner=createClient(api,e.ANON_KEY,options)
const ok=r=>{assert.equal(r.error,null,'Synthetic local setup/query failed');return r.data}
const email=randomUUID()+'@example.invalid',password='SyntheticPassword-For-CI-2026!',user=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user
ok(await service.from('profiles').insert({id:user.id,role:'owner',active:true}))
const token=ok(await owner.auth.signInWithPassword({email,password})).session.access_token
const id=randomUUID(),image=randomUUID(),path=id+'/'+image+'.jpg'
ok(await owner.from('trade_evidence').insert({id,kind:'purchase',title:'Synthetic dispatcher case',story:'Synthetic dispatcher contract only.',website_text:'Synthetic dispatcher website only.',permission_confirmed:true,privacy_reviewed:true}))
const bytes=await sharp({create:{width:30,height:30,channels:3,background:'#123456'}}).jpeg().toBuffer()
ok(await owner.storage.from('trade-evidence-private').upload(path,bytes,{contentType:'image/jpeg'}))
ok(await owner.from('trade_evidence_images').insert({id:image,evidence_id:id,storage_path:path,approved_for_public:true}))
const headers={apikey:e.ANON_KEY,origin:'https://hub.amphon.co.th',authorization:'Bearer '+token,'content-type':'application/json'}
const handler=createPrivateMediaHandler({url:api,key:e.ANON_KEY,allowedOrigin:headers.origin})
const results=[]
async function complete(name,body,expected,direct=false){const start=performance.now(),request=new Request(api+'/functions/v1/evidence-private-media',{method:'POST',headers,body});
 const r=direct?await handler(request):await fetch(request.url,{method:'POST',headers,body,signal:AbortSignal.timeout(8000)})
 const data=await r.arrayBuffer(),pass=r.status===expected&&(expected!==200||data.byteLength===bytes.length)&&/no-store/.test(r.headers.get('cache-control')||'')
 for(const secret of [token,e.SERVICE_ROLE_KEY,e.JWT_SECRET])assert.equal(Buffer.from(data).includes(Buffer.from(secret)),false,'Response must not contain credentials')
 results.push({name,status:r.status,ms:Math.round(performance.now()-start),bytes:data.byteLength,pass});assert.ok(pass,name)}
await complete('A gateway valid',JSON.stringify({image_id:image,purpose:'PREVIEW'}),200)
await complete('A direct valid',JSON.stringify({image_id:image,purpose:'PREVIEW'}),200,true)
await complete('B gateway oversized','x'.repeat(1025),422)
await complete('B direct oversized','x'.repeat(1025),422,true)
await complete('B gateway invalid JSON','{invalid}',403)
let controller,fetchCalls=0,timer
const directStart=performance.now(),direct=createPrivateMediaHandler({url:api,key:e.ANON_KEY,allowedOrigin:headers.origin,fetchImpl:async()=>{fetchCalls++;throw Error('NO_UPSTREAM_EXPECTED')}})
const directBody=new ReadableStream({start(c){controller=c;c.enqueue(new TextEncoder().encode('{'))}})
const keepAlive=setTimeout(()=>{},7000)
const dr=await direct(new Request(api+'/private',{method:'POST',headers,body:directBody,duplex:'half'}));clearTimeout(keepAlive)
results.push({name:'C direct unfinished',status:dr.status,ms:Math.round(performance.now()-directStart),upstream_calls:fetchCalls,pass:dr.status===422&&fetchCalls===0})
const snapshot=async()=>JSON.stringify(await Promise.all(['trade_evidence','trade_evidence_images','commerce_evidence_publication_requests'].map(async table=>ok(await service.from(table).select('*').order('id')))))
const before=await snapshot(),start=performance.now();let received=0,status=null,attempts=0,cancelled=false
await new Promise(resolve=>{
 attempts++
 const request=http.request(api+'/functions/v1/evidence-private-media',{method:'POST',headers:{...headers,'transfer-encoding':'chunked'}},response=>{status=response.statusCode;response.on('data',c=>{received+=c.length});response.resume()})
 request.on('error',()=>{});request.on('close',()=>{clearTimeout(timer);resolve()})
 timer=setTimeout(()=>{cancelled=true;request.destroy()},8000);request.write('{')
})
const after=await snapshot()
results.push({name:'C gateway unfinished',status,ms:Math.round(performance.now()-start),received_bytes:received,attempts,cancelled,
 prompt_rejection_pass:status===422,client_cancellation_pass:cancelled&&received===0&&attempts===1,no_public_data_write:before===after})
// Recovery check after client disconnect: a new complete authorized request works.
await complete('A gateway after C cancellation',JSON.stringify({image_id:image,purpose:'PREVIEW'}),200)
assert.equal(before,after,'Incomplete request must not change synthetic public records')
assert.equal(received,0);assert.equal(attempts,1)
fs.writeFileSync('.evidence-dispatcher-contract.log',JSON.stringify(results,null,2));results.forEach(r=>console.log(JSON.stringify(r)))
globalThis.fetch=native
// Preserve the failed abuse criterion; never turn absence of a response into PASS.
if(results.some(r=>r.pass===false)||!results.find(r=>r.name==='C gateway unfinished').prompt_rejection_pass)process.exitCode=2
