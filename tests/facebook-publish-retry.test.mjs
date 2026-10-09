import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from '../workers/r2-upload/node_modules/typescript/lib/typescript.js'
const source=readFileSync(new URL('../workers/r2-upload/src/channel-auth.ts',import.meta.url),'utf8').replace("import { facebookSoldMessage } from './facebook-content'",'const facebookSoldMessage=()=>"sold"')
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {runFacebookRotationSweep}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
test('ledger write failure resumes external post; learning failure preserves POSTED',async()=>{
 const original=globalThis.fetch,job={id:'job',product_id:'product',connection_key:'page_1',template_id:'ROT-1'},env={SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'test'}
 let creates=0,ledgerWrites=0,failLearning=false
 globalThis.fetch=async(url,init={})=>{
  const u=String(url),body=init.body?JSON.parse(String(init.body).startsWith('{')?init.body:'{}'):{}
  const ok=x=>new Response(JSON.stringify(x),{status:200})
  if(u.includes('/rest/v1/rpc/facebook_rotation_claim_due'))return ok([{...job}])
  if(u.includes('/rest/v1/rpc/central_channel_read_credentials'))return ok({pageId:'page',pageAccessToken:'test'})
  if(u.includes('/rest/v1/rpc/'))return ok(0)
  if(u.includes('/rest/v1/products?'))return ok([{status:'published',one_availability:'IN_STOCK'}])
  if(u.includes('/rest/v1/commerce_public_listing_v'))return ok([{status:'published',sku:'AT-NB',title:'Laptop',price:10000,images:[]}])
  if(u.includes('/rest/v1/facebook_rotation_queue?')){Object.assign(job,body);return ok(null)}
  if(u.includes('/rest/v1/facebook_post_ledger?')){assert.ok(u.includes('on_conflict=post_id'));ledgerWrites++;return ledgerWrites===1?new Response('DB temporarily unavailable',{status:503}):ok(null)}
  if(u.includes('/rest/v1/facebook_learning_ledger')&&init.method==='POST')return failLearning?new Response('Learning unavailable',{status:503}):ok(null)
  if(u.includes('/rest/v1/facebook_learning_ledger'))return ok([])
  if(u.includes('/feed')){creates++;return ok({id:'page_post'})}
  if(u.includes('graph.facebook.com'))return ok({id:'page_post',permalink_url:'https://facebook.test/post'})
  throw new Error('Unexpected URL '+u)
 }
 try{
  await runFacebookRotationSweep(env)
  assert.equal(job.post_id,'page_post');assert.equal(job.status,'FAILED');assert.equal(creates,1)
  failLearning=true
  await runFacebookRotationSweep(env)
  assert.equal(creates,1);assert.equal(job.status,'POSTED')
 }finally{globalThis.fetch=original}
})
