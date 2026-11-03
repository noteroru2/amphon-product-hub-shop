import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const load=async(path)=>{
 const src=readFileSync(new URL('../src/'+path,import.meta.url),'utf8')
 const js=ts.transpileModule(src,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022
 }}).outputText
 return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
}
const {facebookQueueSelected}=await load('facebook-manual-queue.ts')
const {facebookAutomationReport}=await load('facebook-automation-report.ts')
const env={SUPABASE_URL:'https://unit-db.test',SUPABASE_SECRET_KEY:'safe-test-key'}

test('owner manual publish only enqueues; repeated clicks reuse queue, never call Graph /feed',async()=>{
 const original=globalThis.fetch,urls=[]
 globalThis.fetch=async(url,init)=>{
  urls.push(String(url))
  assert.match(String(url),/\/rpc\/facebook_manual_publish_enqueue$/)
  const body=JSON.parse(init.body)
  assert.equal(body.p_connection_key,'page_1')
  assert.equal(body.p_product_id,'11111111-1111-4111-8111-111111111111')
  return new Response(JSON.stringify({ok:true,status:'QUEUED',queueId:'queue-1',reusedQueue:urls.length>1}),{status:200})
 }
 try{
  const request={productId:'11111111-1111-4111-8111-111111111111',connectionKeys:['page_1','page_1']}
  const first=await facebookQueueSelected(env,{profile:{role:'owner'}},request)
  const second=await facebookQueueSelected(env,{profile:{role:'owner'}},request)
  assert.equal(first.results.length,1)
  assert.equal(first.results[0].queueId,'queue-1')
  assert.equal(second.results[0].reusedQueue,true)
  assert.equal(urls.length,2)
  assert.equal(urls.some(url=>url.includes('graph.facebook')),false)
 }finally{globalThis.fetch=original}
})
test('staff cannot bypass owner manual posting',async()=>{
 await assert.rejects(()=>facebookQueueSelected(env,{profile:{role:'sales'}},
  {productId:'11111111-1111-4111-8111-111111111111',connectionKeys:['page_1']}),/ADMIN_ONLY/)
})
test('invalid pages and duplicate page count are rejected before any write',async()=>{
 await assert.rejects(()=>facebookQueueSelected(env,{profile:{role:'owner'}},
  {productId:'11111111-1111-4111-8111-111111111111',connectionKeys:['page_1','attacker']}),/VALID_FACEBOOK_PAGES/)
})
test('Graph failed outcome from DB remains distinct from queued or published',async()=>{
 const original=globalThis.fetch
 globalThis.fetch=async()=>new Response(JSON.stringify({ok:false,status:'NEEDS_REVIEW'}),{status:200})
 try{
  const value=await facebookQueueSelected(env,{profile:{role:'admin'}},
   {productId:'11111111-1111-4111-8111-111111111111',connectionKeys:['page_2']})
  assert.equal(value.ok,false)
  assert.equal(value.results[0].status,'NEEDS_REVIEW')
  assert.equal(value.results[0].postId,undefined)
 }finally{globalThis.fetch=original}
})
test('dashboard separates operational status from restricted direct profit',async()=>{
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
 const rows=path=>path.startsWith('facebook_rotation_settings')?[{active_connection_keys:['page_1'],rolling_24h_budget:6,min_page_gap_minutes:120}]:
  path.startsWith('facebook_automation_queue_status_v')?[{id:'q1',connection_key:'page_1',attention_state:'WAITING_BUDGET',scheduled_at:new Date().toISOString()}]:
  path.startsWith('facebook_automation_daily_v')?[{day_bkk:today,connection_key:'page_1',posted_count:3}]:
  path.startsWith('facebook_graph_usage_samples')?[{connection_key:'page_1',operation:'feed-publish',http_status:200,business_call_percent:1}]:
  path.startsWith('facebook_publish_attempts')?[{connection_key:'page_1',state:'CONFIRMED',post_id:'p1'}]:
  path.startsWith('facebook_content_sale_performance_v')?[{connection_key:'page_1',direct_sales:2,direct_profit:2000}]:
  path.startsWith('facebook_post_ledger')?[{connection_key:'page_1',post_id:'p1',status:'LIVE'}]:[]
 const owner=await facebookAutomationReport(async path=>rows(path),'owner')
 const sales=await facebookAutomationReport(async path=>rows(path),'sales')
 assert.equal(owner.pages[0].postsToday,3)
 assert.equal(owner.pages[0].usagePercent,1)
 assert.equal(owner.pages[0].queueCounts.WAITING_BUDGET,1)
 assert.equal(owner.pages[0].confirmedReceipts,1)
 assert.equal(owner.pages[0].directSales,2)
 assert.equal(owner.pages[0].directProfit,2000)
 assert.equal(sales.pages[0].directProfit,null)
 assert.equal(sales.financeVisible,false)
})
