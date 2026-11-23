import test from 'node:test'
import assert from 'node:assert/strict'
import { githubAdapter, supabaseStore } from '../scripts/seo-draft-pr-executor-adapters.mjs'

const SHA='a'.repeat(40)
const TREE='b'.repeat(40)
const REPO='noteroru2/amphon.co.th'
const TOKEN='ghs_'+ 'x'.repeat(40)
const RESP=(obj,status=200)=>new Response(JSON.stringify(obj),{
 status,headers:{'content-type':'application/json'},
})

test('GitHub adapter uses scoped REST endpoints and authorization headers', async t=>{
 const calls=[]
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls.push({url,options})
  if(String(url).endsWith('/git/ref/heads/release/cloudflare-production'))
   return RESP({object:{sha:SHA}})
  if(String(url).includes('/contents/src/pages/notebook.astro'))
   return RESP({type:'file',encoding:'base64',sha:TREE,size:19,
    content:Buffer.from('<h1>notebook</h1>').toString('base64')})
  if(String(url).endsWith('/git/commits/'+SHA))return RESP({tree:{sha:TREE}})
  throw Error('Unexpected GitHub URL '+url)
 })
 const github=githubAdapter(TOKEN)
 assert.equal(await github.getBranchHead(REPO,'release/cloudflare-production'),SHA)
 const file=await github.getFile(REPO,'src/pages/notebook.astro',SHA)
 assert.equal(file.content,'<h1>notebook</h1>')
 assert.equal(file.blob_sha,TREE)
 assert.equal(await github.getCommitTree(REPO,SHA),TREE)
 assert.ok(calls.every(call=>String(call.url).startsWith('https://api.github.com/repos/noteroru2/amphon.co.th/')))
 assert.ok(calls.every(call=>call.options.headers.Authorization==='Bearer '+TOKEN))
 assert.ok(calls.every(call=>call.options.headers['X-GitHub-Api-Version']==='2022-11-28'))
 assert.equal(calls[0].url,'https://api.github.com/repos/noteroru2/amphon.co.th/git/ref/heads/release/cloudflare-production')
})

test('GitHub adapter prohibits traversal and invalid reference before external writes',async t=>{
 let count=0
 t.mock.method(globalThis,'fetch',async()=>{count++;return RESP({})})
 const github=githubAdapter(TOKEN)
 await assert.rejects(()=>github.getFile(REPO,'src/pages/../../.env',SHA),/INVALID_CONTENT_PATH/)
 await assert.rejects(()=>github.getFile(REPO,'src/pages/notebook.astro','wrongsha'),/INVALID_COMMIT_SHA/)
 await assert.rejects(()=>github.getBranchHead(REPO,'release/../main'),/INVALID_BRANCH/)
 await assert.rejects(()=>github.getBranchHead('n/a/b','main'),/INVALID_REPO/)
 assert.equal(count,0)
})

test('GitHub adapter only requests an explicit draft PR and validates response URL',async t=>{
 const calls=[]
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls.push({url,options})
  if(String(url).endsWith('/pulls'))
   return RESP({draft:true,number:17,html_url:'https://github.com/noteroru2/amphon.co.th/pull/17'})
  return RESP({})
 })
 const github=githubAdapter(TOKEN)
 const draft=await github.createDraftPr(REPO,{
  head:'seo/owner-reviewed-uuid',base:'release/cloudflare-production',draft:true,
  title:'SEO review',body:'Owner review only',
 })
 assert.equal(draft.draft,true)
 assert.equal(draft.number,17)
 assert.equal(calls.length,1)
 assert.equal(calls[0].options.method,'POST')
 assert.equal(JSON.parse(calls[0].options.body).draft,true)
 assert.equal(calls[0].url,'https://api.github.com/repos/noteroru2/amphon.co.th/pulls')
})

test('Supabase server-side adapter uses only validated URL and never forwards secret as query argument',async t=>{
 const KEY='service_role_test_'+'y'.repeat(40)
 const seen=[]
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  seen.push({url:String(url),options})
  const u=new URL(url)
  assert.equal(u.origin,'https://abc-def.supabase.co')
  assert.equal(options.headers.apikey,KEY)
  assert.equal(options.headers.Authorization,'Bearer '+KEY)
  assert.equal(u.searchParams.has('apikey'),false)
  const table=u.pathname.split('/').pop()
  if(table==='commerce_seo_source_change_requests')return RESP([{id:'11111111-1111-4111-8111-111111111111',site_id:'amphon',job_id:16,evidence_id:20,
   gsc_receipt_id:'711d5aba-710a-4db7-a1d9-d1df4558ec40',focus_query:'รับซื้อโน๊ตบุ๊ค'}])
  if(table==='commerce_seo_source_change_pr_runs')return RESP([])
  if(table==='commerce_seo_sites')return RESP([{id:'amphon',enabled:true,origin:'https://amphon.co.th'}])
  if(table==='commerce_seo_portfolio_projects')return RESP([{site_id:'amphon',mapping_status:'VERIFIED'}])
  if(table==='commerce_seo_content_jobs')return RESP([{id:16}])
  if(table==='commerce_seo_content_evidence')return RESP([{id:20}])
  if(table==='seo_connector_receipts')return RESP([{id:'711d5aba-710a-4db7-a1d9-d1df4558ec40'}])
  if(table==='commerce_seo_portfolio_keyword_roles')return RESP([{keyword:'รับซื้อโน๊ตบุ๊ค'}])
  throw Error('Unexpected table: '+table)
 })
 const store=supabaseStore({url:'https://abc-def.supabase.co',key:KEY})
 const result=await store.loadSnapshot('11111111-1111-4111-8111-111111111111')
 assert.equal(result.request.site_id,'amphon')
 assert.equal(result.project.mapping_status,'VERIFIED')
 assert.equal(result.existingRun,null)
 assert.equal(seen.length,8)
 assert.ok(seen.every(v=>!v.url.includes(KEY)))
})

test('Supabase receipt write includes only audited fields and requires one-row acknowledgement',async t=>{
 const KEY='service_role_test_'+'y'.repeat(40)
 let payload
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  payload=JSON.parse(options.body)
  return RESP([{request_id:'11111111-1111-4111-8111-111111111111'}],201)
 })
 const store=supabaseStore({url:'https://abc-def.supabase.co',key:KEY})
 const record={request_id:'11111111-1111-4111-8111-111111111111',
  site_id:'amphon',repository:REPO,target_branch:'main',base_commit_sha:SHA,
  draft_branch:'seo/owner-reviewed-11111111-1111-4111-8111-111111111111',
  pr_number:27,pr_url:'https://github.com/noteroru2/amphon.co.th/pull/27',
  pr_head_sha:TREE,change_sha256:'f'.repeat(64),changed_paths:['src/pages/notebook.astro'],
  owner_password:'NEVER_FORWARD',
 }
 const saved=await store.recordRun(record)
 assert.equal(saved.request_id,record.request_id)
 assert.equal(payload.owner_password,undefined)
 assert.equal(payload.pr_url,record.pr_url)
 assert.equal(Object.keys(payload).length,11)
})
