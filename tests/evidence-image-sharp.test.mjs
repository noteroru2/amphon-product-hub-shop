import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import worker from '../workers/evidence-publisher/index.mjs'
import {stagePrivateEvidenceImage as stageSyntheticImage,toPrivateWebp,privateImageRemote,signedPrivateR2Put,parseImageArgs} from '../scripts/evidence-image-sharp.mjs'
// These original isolated policy tests deliberately use in-memory stores. The
// actual server adapter always requires the persistent SQL operation journal.
const stagePrivateEvidenceImage=(id,options)=>stageSyntheticImage(id,{...options,store:{syntheticOnly:true,...options.store}})

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
 assert.ok(before.exif,'Synthetic input must contain metadata before stripping')
 assert.ok(before.icc)
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

test('Sharp rejects a synthetic decompression bomb above 25 megapixels and truncated JPEG pixels',async()=>{
 const oversized=await sharp({create:{width:5001,height:5000,channels:3,
  background:{r:10,g:20,b:30}}}).png().toBuffer()
 assert.ok(oversized.length<8*1024*1024,'Pixel limit must apply even to small compressed input')
 await assert.rejects(toPrivateWebp(oversized))
 const jpeg=await syntheticJpeg()
 await assert.rejects(toPrivateWebp(jpeg.subarray(0,Math.floor(jpeg.length/2))))
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
 const r2Key='r2-test-access-key-only'
 const r2Secret='r2-test-secret-key-only-do-not-use-in-production'
 const env={
  AMPHON_SEO_SUPABASE_URL:'https://synthetic.supabase.co',
  AMPHON_SEO_SERVICE_ROLE_KEY:'synthetic-service-key-mock'.padEnd(48,'x'),
  AMPHON_CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),
  AMPHON_R2_ACCESS_KEY_ID:r2Key,
  AMPHON_R2_SECRET_ACCESS_KEY:r2Secret
 }
 const remote=privateImageRemote(env,async(url,opts)=>{
  const str=String(url)
  if(str.includes('storage/v1')) {
   assert.match(str,/trade-evidence-private/)
   assert.ok(!str.includes(env.AMPHON_SEO_SERVICE_ROLE_KEY))
   assert.ok(!str.includes(env.AMPHON_R2_SECRET_ACCESS_KEY))
   return new Response(jpeg,{status:200,headers:{'content-type':'image/jpeg'}})
  }
  assert.match(str,/^[a-z]+:\/\/a{32}\.r2\.cloudflarestorage\.com\/amphon-evidence-staged-private\/evidence\//)
  assert.equal(opts.method,'PUT')
  assert.equal(opts.headers['content-type'],'image/webp')
  assert.match(opts.headers.authorization,/^AWS4-HMAC-SHA256 Credential=/)
  assert.equal(opts.headers['x-amz-content-sha256'].length,64)
  assert.match(opts.headers['x-amz-date'],/^\d{8}T\d{6}Z$/)
  uploads.push(opts.body)
  return new Response(null,{status:200})
 })
 const response=await remote.downloadPrivate(path)
 await remote.putPrivate(key,await toPrivateWebp(response))
 assert.equal(uploads.length,1)
 assert.equal((await sharp(uploads[0]).metadata()).format,'webp')
})
test('R2 SigV4 signs only private S3 PutObject with deterministic signature and scoped path',()=>{
 const bytes=Buffer.from('RIFF0000WEBPsynthetic-bytes')
 const opts={accountId:'A'.repeat(32),accessKeyId:'synthetic-r2-access-id',
  secretAccessKey:'synthetic-r2-secret-value-which-is-not-real',
  objectKey:key,bytes,now:new Date('2026-11-25T09:00:00Z')}
 const first=signedPrivateR2Put(opts),second=signedPrivateR2Put(opts)
 assert.equal(first.endpoint,second.endpoint)
 assert.equal(first.request.headers.authorization,second.request.headers.authorization)
 assert.match(first.endpoint,/^https:\/\/a{32}\.r2\.cloudflarestorage\.com\/amphon-evidence-staged-private\/evidence\//)
 assert.match(first.request.headers.authorization,/Credential=synthetic-r2-access-id\/20261125\/auto\/s3\/aws4_request/)
 assert.match(first.request.headers.authorization,/SignedHeaders=cache-control;content-type;host;if-none-match;x-amz-content-sha256;x-amz-date;x-amz-meta-sha256/)
 assert.equal(first.request.headers['if-none-match'],'*')
 assert.equal(first.request.headers['cache-control'],'private, no-store')
 assert.equal(first.request.headers['x-amz-date'],'20261125T090000Z')
 assert.equal(first.request.headers['content-type'],'image/webp')
 assert.ok(!first.endpoint.includes('api.cloudflare.com'))
 assert.ok(!first.endpoint.includes(opts.secretAccessKey))
 assert.notEqual(signedPrivateR2Put({...opts,bytes:Buffer.from('RIFF0000WEBPchanged')}).request.headers.authorization,
    first.request.headers.authorization)
 for(const wrongKey of ['https://evil.example/image.webp','../secret.webp','other-bucket/x.webp']) {
  assert.throws(()=>signedPrivateR2Put({...opts,objectKey:wrongKey}))
 }
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

test('cancel, revoke, delete or lose authorization during upload: fail closed and preserve shared private object',async()=>{
 const jpeg=await syntheticJpeg()
 for(const mutation of [s=>{s.request.status='CANCELLED'},s=>{s.evidence.permission_confirmed=false},
  s=>{s.image.approved_for_public=false},s=>{s.requester.active=false},s=>{s.image=null},
  s=>{s.request=null}]) {
  const snap=syntheticSnapshot(),objects=new Map()
  let deletes=0
  await assert.rejects(stagePrivateEvidenceImage(ID,{
   store:{async loadSnapshot(){return snap}},remote:{async downloadPrivate(){return jpeg},
    async putPrivate(k,bytes){objects.set(k,bytes);mutation(snap)},async delete(){deletes++}},dryRun:false
  }),/POST_UPLOAD_RECONCILE_REQUIRED/)
  assert.equal(objects.size,1,'In-flight write really occurred in fake R2; do not claim rollback')
  assert.equal(objects.has(key),true)
  assert.equal(deletes,0,'Another site can still reference the same object')
 }
})

test('uncertain upload response or unavailable post-upload DB never reports success or leaks upstream errors',async()=>{
 const jpeg=await syntheticJpeg()
 for(const uncertain of [true,false]) {
  let reads=0,writes=0
  await assert.rejects(stagePrivateEvidenceImage(ID,{
   store:{async loadSnapshot(){reads++;if(reads===3)throw Error('private-database-details');return syntheticSnapshot()}},
   remote:{async downloadPrivate(){return jpeg},async putPrivate(){writes++;if(uncertain)throw Error('secret-upstream-details')}},
   dryRun:false
  }),uncertain?/^Error: EVIDENCE_IMAGE_UPLOAD_RESULT_UNCERTAIN_RECONCILE_REQUIRED$/:/^Error: EVIDENCE_IMAGE_POST_UPLOAD_RECONCILE_REQUIRED$/)
  assert.equal(writes,1,'No automatic retry of an ambiguous side effect')
 }
})

test('changing an approved storage path or consent timestamp during conversion prevents upload',async()=>{
 const jpeg=await syntheticJpeg()
 for(const mutate of [s=>{s.image.storage_path=E+'/different.jpg'},s=>{s.evidence.approved_at='2026-11-26T00:00:00Z'}]) {
  const snap=syntheticSnapshot();let uploads=0
  await assert.rejects(stagePrivateEvidenceImage(ID,{store:{async loadSnapshot(){return snap}},
   remote:{async downloadPrivate(){mutate(snap);return jpeg},async putPrivate(){uploads++}},dryRun:false
  }),/APPROVAL_CHANGED_DURING_CONVERSION/)
  assert.equal(uploads,0)
 }
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
