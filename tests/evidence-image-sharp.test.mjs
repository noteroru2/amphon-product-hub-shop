import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import worker from '../workers/evidence-publisher/index.mjs'
import {stagePrivateEvidenceImage,toPrivateWebp,privateImageRemote,parseImageArgs} from '../scripts/evidence-image-sharp.mjs'

const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const E='dd8cbc49-1caf-477c-b579-955007517b61'
const I='8ebfb3f2-1d13-404f-9cfa-93ef40672f16'
const OWNER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const key='evidence/'+E+'/'+I+'.webp'
const path=E+'/'+I+'.jpg'
function syntheticSnapshot(site='amphon') {
 return {
  request:{id:ID,evidence_id:E,image_id:I,site_id:site,page_path:'/รับซื้อโน๊ตบุ๊ค',
    claim_kind:'ASSESSMENT_ONLY',status:'PENDING_SOURCE_PR',requested_by:OWNER,private_media_key:key},
  evidence:{id:E,kind:'purchase',status:'APPROVED',approved_at:'2026-11-24T12:59:11Z',
    permission_confirmed:true,privacy_reviewed:true,transaction_verified:false,
    title:'Synthetic Lenovo',brand:'Lenovo',model:'Gaming',condition_text:'synthetic'},
  image:{id:I,evidence_id:E,approved_for_public:true,storage_path:path},
  site:{id:site,enabled:true,origin:site==='amphon'?'https://amphon.co.th':'https://winnerit.in.th'},
  project:{site_id:site,production_repo:site==='amphon'?'noteroru2/amphon.co.th':'noteroru2/new-winnerit',
    production_branch:site==='amphon'?'release/cloudflare-production':'main',
    mapping_status:'VERIFIED',central_deploy_allowed:false},
  mapping:{site_id:site,page_path:'/รับซื้อโน๊ตบุ๊ค',source_path:'src/content/services/รับซื้อโน๊ตบุ๊ค.md',
    insert_before:'## ส่งรูปเช็กราคาโน๊ตบุ๊คก่อนตัดสินใจ',enabled:true,
    reviewed_at:'2026-11-24T13:00:00Z',reviewed_by:OWNER,expected_base_sha:'a'.repeat(40)},
  requester:{id:OWNER,role:'owner',active:true},
  expected_base_sha:'a'.repeat(40)
 }
}
async function syntheticJpeg(){
 return sharp({create:{width:320,height:240,channels:3,background:{r:205,g:112,b:45}}})
    .jpeg({quality:85}).withMetadata({density:143}).toBuffer()
}
test('Sharp uses synthetic JPG -> WebP with EXIF/ICC/XMP omitted and size reduced',async()=>{
 const input=await syntheticJpeg()
 const before=await sharp(input).metadata()
 assert.equal(before.format,'jpeg')
 const result=await toPrivateWebp(input)
 const meta=await sharp(result).metadata()
 assert.equal(meta.format,'webp')
 assert.equal(meta.width,320)
 assert.equal(meta.height,240)
 assert.ok(result.length<8*1024*1024)
 assert.equal(meta.exif,undefined)
 assert.equal(meta.icc,undefined)
 assert.equal(meta.xmp,undefined)
 assert.equal(meta.iptc,undefined)
 assert.ok(result.subarray(0,4).toString()==='RIFF')
})
test('Sharp rejects SVG and unsupported, malformed and oversized input',async()=>{
 await assert.rejects(toPrivateWebp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')))
 await assert.rejects(toPrivateWebp(Buffer.from('not a supported image format'.repeat(3))))
 await assert.rejects(toPrivateWebp(Buffer.alloc(8*1024*1024+1)))
})
test('private stage dry-run never reads/writes any bytes; only owner-reviewed snapshot',async()=>{
 const calls=[]
 const result=await stagePrivateEvidenceImage(ID,{
  store:{async loadSnapshot(){calls.push('db');return syntheticSnapshot()}},
  remote:{async downloadPrivate(){calls.push('download');throw Error('never')},
    async putPrivate(){calls.push('put');throw Error('never')}},
  dryRun:true
 })
 assert.equal(result.outcome,'DRY_RUN_APPROVED')
 assert.equal(result.media_public,false)
 assert.deepEqual(calls,['db'])
})
test('protected Sharp stage performs only private R2 upload and returns no public URL',async()=>{
 const jpeg=await syntheticJpeg(),calls=[]
 let privateWebp
 const result=await stagePrivateEvidenceImage(ID,{
   store:{async loadSnapshot(){return syntheticSnapshot()}},
   remote:{async downloadPrivate(p){assert.equal(p,path);calls.push('private-download');return jpeg},
     async putPrivate(p,bytes){assert.equal(p,key);calls.push('private-put');privateWebp=bytes;return true}},
   dryRun:false
 })
 assert.deepEqual(calls,['private-download','private-put'])
 assert.equal(result.outcome,'PRIVATE_WEBP_STAGED')
 assert.equal(result.performed_write,true)
 assert.equal(result.media_public,false)
 assert.equal(result.production_deployed,false)
 assert.equal(result.storage,'PRIVATE_R2_ONLY')
 assert.equal((await sharp(privateWebp).metadata()).format,'webp')
 assert.ok(!JSON.stringify(result).includes('https://'))
 assert.ok(!JSON.stringify(result).includes('trade-evidence-private'))
})
test('approval revoked, wrong image, invalid key, non-owner prevent any download',async()=>{
 for(const mutation of [
  s=>{s.evidence.status='DRAFT'},
  s=>{s.evidence.privacy_reviewed=false},
  s=>{s.image.approved_for_public=false},
  s=>{s.requester.role='admin'},
  s=>{s.image.storage_path='../../.env'},
  s=>{s.request.private_media_key='https://public.example/image.webp'},
  s=>{s.project.mapping_status='CANDIDATE'}
 ]) {
  const snap=syntheticSnapshot();mutation(snap);let downloaded=false
  await assert.rejects(stagePrivateEvidenceImage(ID,{
   store:{async loadSnapshot(){return snap}},
   remote:{async downloadPrivate(){downloaded=true},async putPrivate(){throw Error('should not happen')}},
   dryRun:false
  }))
  assert.equal(downloaded,false)
 }
})
test('private remote constrains both source Supabase and R2 upload to fixed secret-only endpoints',async()=>{
 const jpeg=await syntheticJpeg(),uploads=[]
 const token='secure-token-placeholder-for-mock-only'
 const env={
  AMPHON_SEO_SUPABASE_URL:'https://synthetic.supabase.co',
  AMPHON_SEO_SERVICE_ROLE_KEY:'synthetic-service-key-mock'.padEnd(48,'x'),
  AMPHON_CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),
  AMPHON_CLOUDFLARE_R2_API_TOKEN:token.repeat(2)
 }
 const remote=privateImageRemote(env,async(url,opts)=>{
  const str=String(url)
  if(str.includes('storage/v1')) {
   assert.match(str,/trade-evidence-private/)
   assert.ok(!str.includes(env.AMPHON_SEO_SERVICE_ROLE_KEY))
   assert.ok(!str.includes(env.AMPHON_CLOUDFLARE_R2_API_TOKEN))
   return new Response(jpeg,{status:200,headers:{'content-type':'image/jpeg'}})
  }
  assert.match(str,/r2\/buckets\/amphon-evidence-staged-private\/objects\/evidence\//)
  assert.equal(opts.method,'PUT')
  assert.equal(opts.headers['content-type'],'application/octet-stream')
  uploads.push(opts.body)
  return new Response(null,{status:200})
 })
 const response=await remote.downloadPrivate(path)
 await remote.putPrivate(key,await toPrivateWebp(response))
 assert.equal(uploads.length,1)
 assert.equal((await sharp(uploads[0]).metadata()).format,'webp')
})
test('revoke approval while Sharp is running: never write a private image',async()=>{
 const input=await syntheticJpeg()
 let reads=0,uploads=0
 await assert.rejects(stagePrivateEvidenceImage(ID,{
   store:{async loadSnapshot(){
     reads++;const s=syntheticSnapshot()
     if(reads===2)s.evidence.privacy_reviewed=false
     return s
   }},
   remote:{async downloadPrivate(){return input},async putPrivate(){uploads++}},
   dryRun:false
 }))
 assert.equal(reads,2)
 assert.equal(uploads,0)
})
test('CLI execution is never allowed without explicit owner flag',()=>{
 assert.equal(parseImageArgs(['--request-id',ID]).dryRun,true)
 assert.throws(()=>parseImageArgs(['--request-id',ID,'--execute']))
 assert.throws(()=>parseImageArgs(['--request-id',ID,'--deploy']))
 assert.equal(parseImageArgs(['--request-id',ID,'--execute','--owner-authorized']).dryRun,false)
})
test('synthetic Hub -> Worker queue for two sites -> protected Sharp stage; no images before approval',async()=>{
 const originalFetch=globalThis.fetch
 const calls=[]
 const approvals=syntheticSnapshot()
 const saved=[]
 const fake=async (input,init={})=>{
  const url=new URL(String(input))
  calls.push({method:init.method||'GET',path:url.pathname})
  if(url.pathname==='/auth/v1/user')return Response.json({id:OWNER})
  if(url.pathname==='/rest/v1/profiles')return Response.json([{role:'owner',active:true}])
  if(url.pathname==='/rest/v1/trade_evidence')return Response.json([approvals.evidence])
  if(url.pathname==='/rest/v1/trade_evidence_images')return Response.json([approvals.image])
  if(url.pathname==='/rest/v1/commerce_seo_portfolio_projects')return Response.json([
    approvals.project,{...syntheticSnapshot('winner').project}])
  if(url.pathname==='/rest/v1/commerce_seo_sites')return Response.json([{id:'amphon'},{id:'winner'}])
  if(url.pathname==='/rest/v1/commerce_evidence_publication_requests') {
   if(init.method==='POST') {
    const body=JSON.parse(init.body)
    const receipt={id:ID,...body}
    saved.push(receipt)
    return Response.json([receipt])
   }
   return Response.json([])
  }
  throw Error('unexpected mocked fetch path: '+url.pathname)
 }
 globalThis.fetch=fake
 try{
  const env={SUPABASE_URL:'https://synthetic.supabase.co',
    SUPABASE_SECRET_KEY:'synthetic-server-key',SUPABASE_PUBLISHABLE_KEY:'synthetic-pub-key',
    ALLOWED_ORIGINS:'https://hub.amphon.co.th',
    EVIDENCE_PR_DISPATCH_ENABLED:'false',STAGED_IMAGES:{async delete(){throw Error('no delete during queue')}}}
  const req=new Request('https://worker.invalid/api/stage',{
   method:'POST',headers:{origin:'https://hub.amphon.co.th',authorization:'Bearer synthetic-session',
      'content-type':'application/json'},
   body:JSON.stringify({evidence_id:E,image_id:I,
     targets:[{site_id:'amphon',page_path:'/รับซื้อโน๊ตบุ๊ค'},
       {site_id:'winner',page_path:'/รับซื้อโน๊ตบุ๊ค'}]})
  })
  const response=await worker.fetch(req,env)
  const responseData=await response.json()
  assert.equal(response.status,201)
  assert.equal(responseData.status,'QUEUED_PRIVATE_ONLY')
  assert.equal(responseData.media_staged,false)
  assert.equal(responseData.media_public,false)
  assert.equal(responseData.draft_pr_created,false)
  assert.equal(responseData.requests.length,2)
  assert.equal(saved.length,2)
  assert.equal(calls.some(c=>c.path.includes('/storage/v1/')),false)
  assert.equal(calls.some(c=>c.path.includes('/r2/')),false)
  const jpeg=await syntheticJpeg()
  const uploads=[]
  for(const site of ['amphon','winner']) {
   const staging=await stagePrivateEvidenceImage(ID,{
     store:{async loadSnapshot(){return {...syntheticSnapshot(site),request:{...syntheticSnapshot(site).request}}}},
     remote:{
       async downloadPrivate(){return jpeg},
       async putPrivate(p,webp){uploads.push({site,key:p,webp})}
     },dryRun:false
   })
   assert.equal(staging.outcome,'PRIVATE_WEBP_STAGED')
  }
  assert.equal(uploads.length,2)
  assert.ok(uploads.every(u=>u.key===key))
  assert.ok(uploads.every(u=>u.webp.subarray(0,4).toString()==='RIFF'))
 }finally{globalThis.fetch=originalFetch}
})
