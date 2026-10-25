import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const uri=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64')
const guardUri=uri(compile('../src/facebook-write-guard.ts'))
const {withFacebookPageWrite,FacebookWriteDeferred}=await import(guardUri)
const channel=compile('../src/channel-auth.ts').replace("'./facebook-write-guard'",JSON.stringify(guardUri)).replace("'./facebook-content'",JSON.stringify(uri(compile('../src/facebook-content.ts')))).replace("'./facebook-warranty-repair'",JSON.stringify(uri(compile('../src/facebook-warranty-repair.ts'))))
const {runFacebookSoldSyncSweep}=await import(uri(channel))
const env={SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'test'}
const ok=x=>new Response(JSON.stringify(x))
test('cooldown makes zero external writes; it is not recorded as a new failure',async()=>{
 const old=globalThis.fetch;let writes=0,calls=0
 globalThis.fetch=async()=>{calls++;return ok({retry_at:'2026-10-26T00:00:00Z'})}
 try{await assert.rejects(()=>withFacebookPageWrite(env,'page_1',async()=>{writes++}),FacebookWriteDeferred);assert.equal(writes,0);assert.equal(calls,1)}finally{globalThis.fetch=old}
})
test('completion database failure preserves a successful external post ID',async()=>{
 const old=globalThis.fetch,log=console.error;console.error=()=>{}
 globalThis.fetch=async url=>String(url).endsWith('claim')?ok({token:'lease'}):new Response('offline',{status:503})
 try{assert.deepEqual(await withFacebookPageWrite(env,'page_1',async()=>({postId:'page_post'})),{postId:'page_post'})}finally{globalThis.fetch=old;console.error=log}
})
for(const scenario of ['verified','readback-mismatch','restocked','restricted'])test('sold sync '+scenario,async()=>{
 const old=globalThis.fetch;let patches=[],edits=0,completion=[],reads=0
 globalThis.fetch=async(url,init={})=>{
  const u=String(url),body=init.body?String(init.body):''
  if(u.endsWith('facebook_sold_sync_candidates'))return ok([{id:'ledger',product_id:'product',connection_key:'page_1',post_id:'page_post',sku:'AT-NB',title:'Laptop'}])
  if(u.endsWith('facebook_page_write_claim'))return ok({token:'lease'})
  if(u.endsWith('facebook_page_write_result')){completion.push(JSON.parse(body));return ok(null)}
  if(u.includes('/products?'))return ok([{status:scenario==='restocked'?'published':'sold',one_availability:scenario==='restocked'?'IN_STOCK':'SOLD',sold_at:'2026-10-25T00:00:00Z'}])
  if(u.endsWith('central_channel_read_credentials'))return ok({pageId:'page',pageAccessToken:'test'})
  if(u.includes('/facebook_post_ledger?')){patches.push(JSON.parse(body));return ok(null)}
  if(u.includes('graph.facebook.com')){
   if(init.method==='POST'){edits++;if(scenario==='restricted')return new Response(JSON.stringify({error:{code:368,message:'temporarily blocked'}}),{status:400});return ok({success:true})}
   reads++;return ok({message:reads===1||scenario==='readback-mismatch'?'Laptop\nราคา 9,900 บาท':'#ขายแล้วครับ #ขอบคุณลูกค้าทุกท่าน\n\nLaptop\nราคา XXX'})
  }
  throw new Error('Unexpected URL '+u)
 }
 try{
  const results=await runFacebookSoldSyncSweep(env)
  assert.equal(results[0].ok,scenario==='verified')
  assert.equal(patches.some(p=>p.status==='SOLD'),scenario==='verified')
  assert.equal(edits,scenario==='restocked'?0:1)
  if(scenario==='restricted')assert.match(completion[0].p_error,/:368:/)
 }finally{globalThis.fetch=old}
})
