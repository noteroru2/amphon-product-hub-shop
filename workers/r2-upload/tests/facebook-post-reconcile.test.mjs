import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const src=readFileSync(new URL('../src/facebook-post-reconcile.ts',import.meta.url),'utf8')
const code=ts.transpileModule(src.replace(
  "import { facebookObservedFetch } from './facebook-graph-usage'",
  'const facebookObservedFetch=async(env,key,op,url,init)=>fetch(url,init)',
),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {reconcileFacebookPublishAttempts}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const env={SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'test-not-logged'}
const ok=j=>new Response(JSON.stringify(j),{status:200})
const fixed=new Date()
const stamp=new Date(fixed.getTime()-5*60*1000).toISOString()
const marker='AMPHON-1234567890abcdef'
const candidate={queue_id:'00000000-0000-4000-8000-000000000001',
  connection_key:'page_1',marker,started_at:stamp,sku:'AT-NB-2610-123',attempt_no:1}
const post={id:'123_456',created_time:new Date(Date.parse(stamp)+40*1000).toISOString(),
 message:'Laptop\n🔗 ดูรายละเอียด: https://shop.amphon.co.th/product/AT-NB-2610-123\n🔖 รหัสประกาศ: '+marker}
test('reconcile precisely one marked published post, save ID before verification, never POST to Graph',async()=>{
 const original=globalThis.fetch,events=[]
 globalThis.fetch=async(url,init={})=>{
  const u=String(url)
  if(u.startsWith('https://graph.facebook.com')){
   events.push({type:'graph',method:init.method||'GET'})
   if(u.includes('published_posts'))return ok({data:[post],paging:{}})
   return ok({id:post.id,permalink_url:'https://facebook.test/post/456'})
  }
  if(u.includes('facebook_publish_reconcile_claim'))return ok([candidate])
  if(u.includes('central_channel_read_credentials'))return ok({pageId:'123',pageAccessToken:'redacted'})
  if(u.includes('facebook_publish_capture')){events.push({type:'capture',body:JSON.parse(init.body)});return ok({ok:true,post_id:post.id})}
  if(u.includes('facebook_post_ledger?')){events.push({type:'ledger'});return ok(null)}
  if(u.includes('facebook_rotation_queue?')){events.push({type:'queue'});return ok(null)}
  throw new Error('unexpected '+u)
 }
 try{
  const results=await reconcileFacebookPublishAttempts(env)
  assert.equal(results[0].status,'RECOVERED')
  assert.equal(events.filter(e=>e.type==='graph'&&e.method!=='GET').length,0)
  assert.equal(events.find(e=>e.type==='capture')?.body.p_post_id,'123_456')
  assert.equal(events.find(e=>e.type==='capture')?.body.p_marker,marker)
  assert.ok(events.findIndex(e=>e.type==='capture')<events.findIndex(e=>e.type==='ledger'))
 }finally{globalThis.fetch=original}
})
test('no matching marker never attributes a different Post ID',async()=>{
 const original=globalThis.fetch,events=[]
 globalThis.fetch=async(url,init={})=>{
  const u=String(url)
  if(u.includes('facebook_publish_reconcile_claim'))return ok([candidate])
  if(u.includes('central_channel_read_credentials'))return ok({pageId:'123',pageAccessToken:'redacted'})
  if(u.startsWith('https://graph.facebook.com'))return ok({data:[{...post,message:post.message.replace(marker,'AMPHON-DIFFERENT')}],paging:{}})
  if(u.includes('facebook_publish_reconcile_result')){events.push(JSON.parse(init.body));return ok(null)}
  throw new Error('unexpected '+u)
 }
 try{
  const results=await reconcileFacebookPublishAttempts(env)
  assert.equal(results[0].status,'NOT_FOUND')
  assert.equal(events[0].p_error,'NO_EXACT_POST_MATCH')
 }finally{globalThis.fetch=original}
})
test('legacy untagged content requires exact SKU and narrow publication window',async()=>{
 const original=globalThis.fetch,events=[]
 const legacy={...candidate,marker:null}
 globalThis.fetch=async(url,init={})=>{
  const u=String(url)
  if(u.includes('facebook_publish_reconcile_claim'))return ok([legacy])
  if(u.includes('central_channel_read_credentials'))return ok({pageId:'123',pageAccessToken:'redacted'})
  if(u.startsWith('https://graph.facebook.com')){
   if(u.includes('published_posts'))return ok({data:[{...post,message:'https://shop.amphon.co.th/product/AT-NB-2610-123'}]})
   return ok({id:post.id})
  }
  if(u.includes('facebook_publish_capture')){events.push(JSON.parse(init.body));return ok({ok:true,post_id:post.id})}
  if(u.includes('facebook_rotation_queue?')||u.includes('facebook_post_ledger?'))return ok(null)
  throw new Error('unexpected '+u)
 }
 try{
  assert.equal((await reconcileFacebookPublishAttempts(env))[0].status,'RECOVERED')
  assert.equal(events[0].p_marker,null)
  assert.equal(events[0].p_post_id,post.id)
 }finally{globalThis.fetch=original}
})
test('Graph permission error is terminal review, not retry loop',async()=>{
 const original=globalThis.fetch,events=[]
 globalThis.fetch=async(url,init={})=>{
  const u=String(url)
  if(u.includes('facebook_publish_reconcile_claim'))return ok([candidate])
  if(u.includes('central_channel_read_credentials'))return ok({pageId:'123',pageAccessToken:'redacted'})
  if(u.startsWith('https://graph.facebook.com'))return new Response(
   JSON.stringify({error:{code:10,message:'Permission denied'}}),{status:400})
  if(u.includes('facebook_publish_reconcile_result')){events.push(JSON.parse(init.body));return ok(null)}
  throw new Error('unexpected '+u)
 }
 try{
  assert.equal((await reconcileFacebookPublishAttempts(env))[0].status,'PERMISSION_REVIEW')
  assert.equal(events[0].p_permission_denied,true)
 }finally{globalThis.fetch=original}
})
