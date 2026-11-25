#!/usr/bin/env node
/**
 * Disposable genuine Supabase Local Auth/Storage/PostgREST integration test.
 * ONLY accepts loopback API_URL from a CI-created local Supabase stack.
 * All photos/user records are synthetic. NEVER talks to hosted Supabase or R2.
 */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import sharp from 'sharp'
import {createClient} from '@supabase/supabase-js'
import worker from '../workers/evidence-publisher/index.mjs'
import {storeAdapter} from './evidence-draft-pr.mjs'
import {privateImageRemote,stagePrivateEvidenceImage} from './evidence-image-sharp.mjs'

const E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const I='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const fakeOrigin='https://evidence-local-test.supabase.co'
const route=new URL('/บริการ/รับซื้อโน๊ตบุ๊ค','https://example.invalid').pathname
const storagePath=E+'/'+I+'.jpg'
const filename='evidence/'+E+'/'+I+'.webp'
const envfile=process.env.EVIDENCE_LOCAL_ENV_FILE
if(!envfile)throw Error('EVIDENCE_LOCAL_ENV_FILE_REQUIRED')
const locals=Object.fromEntries(readFileSync(envfile,'utf8').split(/\r?\n/)
  .filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{
    const at=x.indexOf('=')
    let value=x.slice(at+1).trim()
    if(value.startsWith('"')&&value.endsWith('"'))value=value.slice(1,-1)
    return [x.slice(0,at),value]
  }))
const api=locals.API_URL,anon=locals.ANON_KEY,serviceKey=locals.SERVICE_ROLE_KEY
if(!api||!/^http:\/\/(127\.0\.0\.1|localhost):55321\/?$/.test(api)||!anon||!serviceKey)
  throw Error('NOT_ISOLATED_SUPABASE_LOCAL_REFUSE_NETWORK')
const service=createClient(api,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const publicClient=createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false}})

function unwrap(out,what) {
 if(out.error)throw Error('LOCAL_'+what+'_'+out.error.code)
 return out.data
}
const inputJpeg=await sharp({create:{width:240,height:180,channels:3,
  background:{r:150,g:80,b:30}}}).jpeg({quality:85}).withMetadata().toBuffer()
const owner=unwrap(await service.auth.admin.createUser({
 email:'evidence-owner-synthetic@example.invalid',
 password:'SyntheticPassword-For-CI-2026!',
 email_confirm:true
}),'CREATE_OWNER').user
const staff=unwrap(await service.auth.admin.createUser({
 email:'evidence-admin-synthetic@example.invalid',
 password:'SyntheticPassword-For-CI-2026!',
 email_confirm:true
}),'CREATE_ADMIN').user
assert.ok(owner?.id&&staff?.id)
unwrap(await service.from('profiles').insert([
 {id:owner.id,role:'owner',active:true},{id:staff.id,role:'admin',active:true}
]),'PROFILE_INSERT')
unwrap(await service.from('commerce_seo_sites').insert([
 {id:'amphon',origin:'https://amphon.co.th',enabled:true},
 {id:'winner',origin:'https://winnerit.in.th',enabled:true}
]),'SITE_INSERT')
unwrap(await service.from('commerce_seo_portfolio_projects').insert([
 {site_id:'amphon',production_repo:'noteroru2/amphon.co.th',
  production_branch:'release/cloudflare-production',mapping_status:'VERIFIED',
  central_deploy_allowed:false},
 {site_id:'winner',production_repo:'noteroru2/new-winnerit',
  production_branch:'main',mapping_status:'VERIFIED',
  central_deploy_allowed:false}
]),'PROJECT_INSERT')
unwrap(await service.from('trade_evidence').insert({
 id:E,kind:'purchase',status:'APPROVED',permission_confirmed:true,
 privacy_reviewed:true,approved_at:new Date().toISOString(),transaction_verified:false,
 title:'Synthetic Lenovo Laptop',brand:'Lenovo',model:'IdeaPad Gaming',
 specs_text:'Synthetic i5 16GB',condition_text:'Synthetic used',city:'Test location'
}),'EVIDENCE_INSERT')
unwrap(await service.storage.createBucket('trade-evidence-private',{
 public:false,allowedMimeTypes:['image/jpeg'],fileSizeLimit:'8MB'
}),'BUCKET_CREATE')
unwrap(await service.storage.from('trade-evidence-private').upload(storagePath,inputJpeg,{
 contentType:'image/jpeg',upsert:false
}),'PRIVATE_UPLOAD')
unwrap(await service.from('trade_evidence_images').insert({
 id:I,evidence_id:E,storage_path:storagePath,approved_for_public:true
}),'IMAGE_INSERT')
unwrap(await service.from('commerce_evidence_page_source_mappings').insert([
 {site_id:'amphon',page_path:route,source_path:'src/content/services/รับซื้อโน๊ตบุ๊ค.md',
  insert_before:'## ส่งรูปเช็กราคาโน๊ตบุ๊คก่อนตัดสินใจ',expected_base_sha:'a'.repeat(40),
  enabled:true,reviewed_by:owner.id,reviewed_at:new Date().toISOString()},
 {site_id:'winner',page_path:route,source_path:'src/content/services/รับซื้อโน๊ตบุ๊ค.md',
  insert_before:'## ส่งรูปเช็กราคาโน๊ตบุ๊คก่อนตัดสินใจ',expected_base_sha:'a'.repeat(40),
  enabled:true,reviewed_by:owner.id,reviewed_at:new Date().toISOString()}
]),'REVIEWED_MAPPING_INSERT')
const userAuth=unwrap(await publicClient.auth.signInWithPassword({
 email:'evidence-owner-synthetic@example.invalid',
 password:'SyntheticPassword-For-CI-2026!'
}),'OWNER_SIGNIN')
const adminAuth=unwrap(await createClient(api,anon,{
 auth:{persistSession:false,autoRefreshToken:false}
}).auth.signInWithPassword({
 email:'evidence-admin-synthetic@example.invalid',
 password:'SyntheticPassword-For-CI-2026!'
}),'ADMIN_SIGNIN')
assert.ok(userAuth.session?.access_token && adminAuth.session?.access_token)
const originalFetch=globalThis.fetch
const attemptedExternal=[]
let uploads=0
const toLocal=(requestURL)=>{
 const u=new URL(String(requestURL))
 if(u.origin===fakeOrigin)return new URL(u.pathname+u.search,api)
 if(u.origin===new URL(api).origin)return u
 throw Error('UNEXPECTED_NETWORK_ORIGIN_'+u.hostname)
}
globalThis.fetch=async function sandboxFetch(url,init) {
 const u=new URL(String(url))
 if(u.hostname==='api.cloudflare.com') {
   attemptedExternal.push({hostname:u.hostname,method:init?.method})
   if(!u.pathname.startsWith('/client/v4/accounts/')||
      !u.pathname.includes('/r2/buckets/amphon-evidence-staged-private/objects/'))throw Error('UNSAFE_R2_PATH')
   assert.equal(init?.method,'PUT')
   const meta=await sharp(init.body).metadata()
   assert.equal(meta.format,'webp')
   assert.equal(meta.exif,undefined)
   assert.equal(meta.icc,undefined)
   uploads++
   return new Response(null,{status:200})
 }
 return originalFetch(toLocal(url),init)
}
try {
 const workerEnv={
  SUPABASE_URL:fakeOrigin,
  SUPABASE_SECRET_KEY:serviceKey,
  SUPABASE_PUBLISHABLE_KEY:anon,
  ALLOWED_ORIGINS:'https://hub.amphon.co.th',
  EVIDENCE_PR_DISPATCH_ENABLED:'false',
  STAGED_IMAGES:{async delete(){throw Error('NOT_STAGED_IN_LOCAL_CI')}}
 }
 const invoke=async (token,uri,payload)=>worker.fetch(new Request(
   'https://evidence-worker.invalid'+uri,{method:'POST',
     headers:{origin:'https://hub.amphon.co.th',
       authorization:'Bearer '+token,'content-type':'application/json'},
     body:JSON.stringify(payload)
   }),workerEnv)
 const payload={evidence_id:E,image_id:I,targets:[
  {site_id:'amphon',page_path:'/บริการ/รับซื้อโน๊ตบุ๊ค'},
  {site_id:'winner',page_path:'/บริการ/รับซื้อโน๊ตบุ๊ค'}
 ]}
 const denied=await invoke(adminAuth.session.access_token,'/api/stage',payload)
 assert.equal(denied.status,403,'Admin must not publish')
 const accepted=await invoke(userAuth.session.access_token,'/api/stage',payload)
 const result=await accepted.json()
 assert.equal(accepted.status,201,JSON.stringify(result).slice(0,400))
 assert.equal(result.status,'QUEUED_PRIVATE_ONLY')
 assert.equal(result.claim_kind,'ASSESSMENT_ONLY')
 assert.equal(result.media_public,false)
 assert.equal(result.media_staged,false)
 assert.equal(result.requests.length,2)
 // Anon and user role have no access to queue; service role can inspect receipts.
 const anonymousRows=await publicClient.from('commerce_evidence_publication_requests')
   .select('id')
 assert.ok(anonymousRows.error || anonymousRows.data?.length===0)
 const queued=unwrap(await service.from('commerce_evidence_publication_requests')
   .select('id,site_id,status,claim_kind,private_media_key'),'QUEUE_SELECT')
 assert.equal(queued.length,2)
 assert.ok(queued.every(q=>q.status==='PENDING_SOURCE_PR' && q.claim_kind==='ASSESSMENT_ONLY'))
 assert.ok(queued.every(q=>q.private_media_key===filename))
 // Node GitHub Actions uses the real local Supabase Auth + private Storage REST.
 // Cloudflare API call is intercepted; no Internet requests and no public write.
 const remote=privateImageRemote({
  AMPHON_SEO_SUPABASE_URL:fakeOrigin,
  AMPHON_SEO_SERVICE_ROLE_KEY:serviceKey,
  AMPHON_CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),
  AMPHON_CLOUDFLARE_R2_API_TOKEN:'synthetic-not-a-real-r2-api-token-00000000000'
 },globalThis.fetch)
 for(const row of queued) {
  const outcome=await stagePrivateEvidenceImage(row.id,{
    store:storeAdapter(fakeOrigin,serviceKey),remote,dryRun:false
  })
  assert.equal(outcome.outcome,'PRIVATE_WEBP_STAGED')
  assert.equal(outcome.media_public,false)
  assert.equal(outcome.claim_kind,'ASSESSMENT_ONLY')
 }
 assert.equal(uploads,2)
 // Complete the chain through a simulated GitHub DRAFT PR against a fake API.
 // Draft receipts are written ONLY to the disposable LOCAL Supabase database.
 const {executeEvidenceDraftPr}=await import('./evidence-draft-pr-core.mjs')
 const source='---\ntitle: "รับซื้อโน๊ตบุ๊ค"\n---\n# รับซื้อโน๊ตบุ๊ค\n\n## ส่งรูปเช็กราคาโน๊ตบุ๊คก่อนตัดสินใจ\n'
 const commits=[]
 const github={
  async getBranchHead(){return 'a'.repeat(40)},
  async getBranchRef(){return null},
  async getOverlappingOpenPrs(){return []},
  async getFile(){return {type:'file',size:source.length,blob_sha:'b'.repeat(40),content:source}},
  async getCommitTree(){return 'c'.repeat(40)},
  async createTree(repo,base,files){
   assert.equal(files.length,1)
   assert.match(files[0].content,/ประเมินเบื้องต้น/)
   assert.doesNotMatch(files[0].content,/\.webp|trade-evidence-private|storage\/v1/)
   return 'c'.repeat(40)
  },
  async createCommit(){return 'd'.repeat(40)},
  async createBranch(repo,branch){commits.push({repo,branch})},
  async createDraftPr(repo,body){
    assert.equal(body.draft,true)
    return {draft:true,number:999,url:'https://github.com/'+repo+'/pull/999'}
  }
 }
 for(const row of queued) {
   const response=await executeEvidenceDraftPr(row.id,{
     store:storeAdapter(fakeOrigin,serviceKey),github,dryRun:false
   })
   assert.equal(response.outcome,'DRAFT_PR_CREATED')
   assert.equal(response.media_public,false)
 }
 assert.equal(commits.length,2)
 const after=unwrap(await service.from('commerce_evidence_publication_requests')
   .select('status,draft_pr_url'),'LOCAL_DRAFT_RECEIPTS')
 assert.equal(after.length,2)
 assert.ok(after.every(r=>r.status==='DRAFT_PR_OPEN'))
 // Ensure original data never became public in Storage.
 const buckets=unwrap(await service.storage.listBuckets(),'LIST_BUCKETS')
 assert.equal(buckets.find(b=>b.name==='trade-evidence-private')?.public,false)
 assert.ok(attemptedExternal.every(x=>x.hostname==='api.cloudflare.com'&&x.method==='PUT'))
 // R2 public GET path is unavailable even in mocked worker.
 const response=await worker.fetch(new Request('https://evidence-worker.invalid/media/evidence/x.webp'),workerEnv)
 assert.equal(response.status,404)
 console.log('PASS LOCAL SUPABASE E2E: real Auth/RLS/PostgREST/private Storage, '+queued.length+' queues, Sharp -> simulated private R2 only')
}finally {
 globalThis.fetch=originalFetch
}
