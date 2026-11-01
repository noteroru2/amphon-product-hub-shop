import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../src/facebook-graph-usage.ts',import.meta.url),'utf8')
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {facebookObservedFetch}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
const env={SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'secret-do-not-log'}
function ok(body,headers={}){return new Response(JSON.stringify(body),{status:200,headers})}
test('capture sanitized Meta usage for a SUCCESSFUL Graph call',async()=>{
 const old=globalThis.fetch,events=[]
 globalThis.fetch=async(url,init)=>{
  if(String(url).startsWith('https://db.test')){events.push(JSON.parse(init.body));return ok(null)}
  return ok({id:'post_1'},{'x-app-usage':'{"call_count":28}',
   'x-business-use-case-usage':'{"page":[{"type":"pages","call_count":44,"estimated_time_to_regain_access":0}]}'})
 }
 try{
  const r=await facebookObservedFetch(env,'page_1','post-verify','https://graph.facebook.com/test')
  assert.equal(r.status,200);assert.equal(events.length,1)
  assert.equal(events[0].p_app_call_percent,28)
  assert.equal(events[0].p_business_call_percent,44)
  assert.equal(events[0].p_business_recovery_minutes,0)
  assert.equal(events[0].p_connection_key,'page_1')
  assert.equal(events[0].p_error_code,null)
  assert.equal(JSON.stringify(events[0]).includes('secret-do-not-log'),false)
 }finally{globalThis.fetch=old}
})
test('capture error_code, error_subcode and trace id from FAILED Graph call',async()=>{
 const old=globalThis.fetch,events=[]
 globalThis.fetch=async(url,init)=>{
  if(String(url).startsWith('https://db.test')){events.push(JSON.parse(init.body));return ok(null)}
  return new Response(JSON.stringify({error:{code:368,error_subcode:1404006,fbtrace_id:'traceABC',message:'blocked'}}),{status:400})
 }
 try{
  const r=await facebookObservedFetch(env,'page_2','feed-publish','https://graph.facebook.com/test')
  assert.equal(r.status,400)
  assert.equal(events[0].p_error_code,368)
  assert.equal(events[0].p_error_subcode,1404006)
  assert.equal(events[0].p_fbtrace_id,'traceABC')
 }finally{globalThis.fetch=old}
})
test('stop before feed when a photo upload reports >=80% Meta usage',async()=>{
 const old=globalThis.fetch,events=[]
 globalThis.fetch=async(url,init)=>{
  if(String(url).startsWith('https://db.test')){events.push(JSON.parse(init.body));return ok(null)}
  return ok({id:'unpublished_photo'},{'x-app-usage':'{"call_count":85}'})
 }
 try{
  await assert.rejects(()=>facebookObservedFetch(env,'page_1','photo-upload','https://graph.facebook.com/test'),/META_USAGE_SAFETY_HOLD/)
  assert.equal(events.length,1)
  assert.equal(events[0].p_app_call_percent,85)
 }finally{globalThis.fetch=old}
})
