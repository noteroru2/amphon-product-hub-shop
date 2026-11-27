import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createPrivateMediaHandler} from '../supabase/functions/_shared/evidence-private-media.mjs'
import {loadPrivateEvidenceImage} from '../src/lib/evidencePrivateMediaClient.mjs'
const image='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const path=image+'/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg'
const origin='https://hub.synthetic.invalid',url='https://synthetic.supabase.co'
function harness(options={}) {
 let grants=0,reads=0
 const handler=createPrivateMediaHandler({url,key:'synthetic-publishable',allowedOrigin:origin,
  now:options.now||Date.now,fetchImpl:async(input,init)=>{
   const u=new URL(input);assert.equal(u.origin,url);assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error')
   if(u.pathname==='/auth/v1/user')return new Response('{}',{status:options.expired?401:200})
   if(u.pathname==='/rest/v1/rpc/evidence_private_access') {
    grants++
    if(options.denied||(options.revoked&&grants===2))return new Response(null,{status:403})
    return Response.json({storage_path:path,version:[options.changed&&grants===2?'changed':'approved']})
   }
   assert.match(u.pathname,/^\/storage\/v1\/object\/authenticated\/trade-evidence-private\//)
   reads++
   if(options.upstreamError)throw Error('PRIVATE_UPSTREAM_SECRET_DETAIL')
   return new Response(new Uint8Array(options.oversized?8*1024*1024+1:32),{headers:{'content-type':options.badMime?'image/svg+xml':'image/jpeg'}})
  }})
 const invoke=(body=JSON.stringify({image_id:image,purpose:'EXPORT'}),method='POST',requestOrigin=origin)=>handler(
  new Request('https://handler.invalid/private',{method,headers:{origin:requestOrigin,authorization:'Bearer synthetic'},...(method==='POST'?{body}:{})}))
 return {invoke,counts:()=>({grants,reads})}
}
test('authenticated private response checks before/after, never returns a signed URL, and is no-store',async()=>{
 const h=harness(),r=await h.invoke()
 assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private, no-store/)
 assert.equal(r.headers.get('expires'),'0');assert.equal((await r.arrayBuffer()).byteLength,32)
 assert.deepEqual(h.counts(),{grants:2,reads:1})
})
test('expired, revoked, unreviewed and changed authorization never return private pixels',async()=>{
 for(const options of [{expired:true},{denied:true},{revoked:true},{changed:true}]) {
  const h=harness(options),r=await h.invoke()
  assert.equal(r.status,options.expired?401:403)
  assert.equal(await r.text(),options.expired?'UNAUTHORIZED':'ACCESS_DENIED')
  assert.match(r.headers.get('cache-control'),/no-store/)
 }
})
test('body byte bounds, non-POST and wrong origin fail before any private reads',async()=>{
 const h=harness()
 assert.equal((await h.invoke('x'.repeat(1025))).status,422)
 assert.equal((await h.invoke(undefined,'GET')).status,404)
 assert.equal((await h.invoke(undefined,'POST','https://other.invalid')).status,403)
 assert.deepEqual(h.counts(),{grants:0,reads:0})
})

test('oversized/unsafe upstream images and upstream errors never return pixels or private error details',async()=>{
 for(const options of [{oversized:true},{badMime:true},{upstreamError:true}]) {
  const response=await harness(options).invoke()
  assert.equal(response.status,403);assert.equal(await response.text(),'ACCESS_DENIED')
  assert.match(response.headers.get('cache-control'),/no-store/)
 }
})
test('private access deadline expires while bytes are read',async()=>{
 let calls=0;const h=harness({now:()=>calls++?60000:0})
 assert.equal((await h.invoke()).status,403)
})
test('owned response deadline cancels stalled Storage bytes even when transport ignores abort',async()=>{
 let cancelled=false,timer
 const handler=createPrivateMediaHandler({url,key:'synthetic',allowedOrigin:origin,upstreamTimeoutMs:20,
  fetchImpl:async(input)=>new URL(input).pathname.startsWith('/auth/')?Response.json({}):new URL(input).pathname.startsWith('/rest/')?
   Response.json({storage_path:path,version:['synthetic']}):new Response(new ReadableStream({cancel(){cancelled=true}}),{headers:{'content-type':'image/jpeg'}})})
 try {
  const r=await Promise.race([handler(new Request('https://handler.invalid',{method:'POST',headers:{origin,authorization:'Bearer synthetic'},body:JSON.stringify({image_id:image,purpose:'PREVIEW'})})),new Promise((_r,reject)=>{timer=setTimeout(()=>reject(Error('STORAGE_UNBOUNDED')),500)})])
  assert.equal(r.status,403);assert.equal(cancelled,true)
 }finally{clearTimeout(timer)}
})

test('stalled incoming body is cancelled within its deadline before any authorization call',async()=>{
 let cancelled=false,calls=0
 const handler=createPrivateMediaHandler({url,key:'synthetic',allowedOrigin:origin,inputTimeoutMs:20,
  fetchImpl:async()=>{calls++;throw Error('DO_NOT_CALL')}})
 const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'))},cancel(){cancelled=true}})
 let timer
 try {
  const response=await Promise.race([handler(new Request('https://handler.invalid/private',{method:'POST',
   headers:{origin,authorization:'Bearer synthetic'},body,duplex:'half'})),
   new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('INPUT_NOT_BOUNDED')),500)})])
  assert.equal(response.status,422);assert.equal(await response.text(),'REQUEST_INVALID')
  assert.equal(cancelled,true);assert.equal(calls,0)
 }finally{clearTimeout(timer)}
})
test('browser adapter uses POST authorization/no-store; Hub no longer mints signed URLs or trusts stale download flags',async()=>{
 const blob=await loadPrivateEvidenceImage({baseUrl:url,publishableKey:'synthetic',accessToken:'synthetic',imageId:image,purpose:'EXPORT',
  fetchImpl:async(input,init)=>{assert.equal(init.method,'POST');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
   assert.match(String(input),/\/functions\/v1\/evidence-private-media$/);return new Response('synthetic',{headers:{'content-type':'image/jpeg'}})}})
 assert.equal(blob.size,9)
 const source=readFileSync(new URL('../src/lib/tradeEvidence.ts',import.meta.url),'utf8')
 assert.doesNotMatch(source,/createSignedUrl|\.download\(image\.storage_path\)/)
 assert.match(source,/60000/)
 const ui=readFileSync(new URL('../src/components/TradeEvidenceCenter.tsx',import.meta.url),'utf8')
 assert.match(ui,/attempt===generation/);assert.match(ui,/visibilitychange/);assert.match(ui,/unsubscribe/)
})
