#!/usr/bin/env node
/**
 * AMPHON private Evidence image processor. Node.js/GitHub Actions ONLY.
 * Sharp must never be imported in Cloudflare Workers or browser bundles.
 *
 * Performs PRIVATE Supabase Storage -> Sharp stripped WebP -> PRIVATE R2.
 * No public URLs, GitHub PR publishing, merged commits, or deployment.
 */
import sharp from 'sharp'
import {createHash,createHmac} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {storeAdapter} from './evidence-draft-pr.mjs'
import {inspectSnapshot} from './evidence-draft-pr-core.mjs'

const UUID=/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const MAX_BYTES=8*1024*1024
const MAX_PIXELS=25_000_000
const BUCKET='amphon-evidence-staged-private'
const fail=code=>{throw Error('EVIDENCE_IMAGE_'+code)}

export function validateStagingImage(snapshot) {
  const gate=inspectSnapshot(snapshot)
  const {request,image}=snapshot
  if (!UUID.test(image?.id||'')||image.id!==request.image_id)fail('IMAGE_ID_INVALID')
  if (typeof image.storage_path!=='string' ||
      !new RegExp('^'+request.evidence_id+'/[A-Za-z0-9_.-]+[.](jpe?g|png|webp)$','i').test(image.storage_path))
    fail('PRIVATE_STORAGE_PATH_INVALID')
  const expected='evidence/'+request.evidence_id+'/'+request.image_id+'.webp'
  if(request.private_media_key!==expected)fail('DESTINATION_KEY_MISMATCH')
  return {...gate,privatePath:image.storage_path,key:expected}
}

export async function toPrivateWebp(bytes) {
  if (!(bytes instanceof Uint8Array)||bytes.byteLength<12||bytes.byteLength>MAX_BYTES)
    fail('SOURCE_SIZE_INVALID')
  let meta
  try {meta=await sharp(bytes,{limitInputPixels:MAX_PIXELS,failOn:'error'}).metadata()}
  catch {fail('SOURCE_IMAGE_INVALID')}
  if (!['jpeg','png','webp'].includes(meta.format) || !meta.width || !meta.height ||
      meta.width*meta.height>MAX_PIXELS)fail('SOURCE_FORMAT_OR_DIMENSIONS_INVALID')
  // Never .keepMetadata() / .withMetadata(). Rotation corrects EXIF orientation.
  // Re-encoding strips EXIF/GPS/comments/ICC by default, but not visible PII.
  let output
  try {
    output=await sharp(bytes,{limitInputPixels:MAX_PIXELS,failOn:'error'})
      .rotate()
      .resize({width:1400,withoutEnlargement:true,fit:'inside'})
      .webp({quality:82,effort:4})
      .toBuffer()
  }catch {fail('WEBP_CONVERSION_FAILED')}
  if(output.byteLength<12||output.byteLength>MAX_BYTES)fail('OUTPUT_SIZE_INVALID')
  const outMeta=await sharp(output,{limitInputPixels:MAX_PIXELS}).metadata()
  if(outMeta.format!=='webp'||outMeta.exif||outMeta.xmp||outMeta.icc||outMeta.iptc||
     outMeta.width>1400)fail('OUTPUT_NOT_PRIVACY_STRIPPED')
  return output
}

async function boundedRead(response) {
  if(!response.ok)fail('STORAGE_DOWNLOAD_FAILED')
  const mime=(response.headers.get('content-type')||'').toLowerCase()
  if(!/^image\/(jpeg|png|webp)(?:;|$)/.test(mime))fail('STORAGE_MIME_INVALID')
  const stated=Number(response.headers.get('content-length')||0)
  if(!Number.isFinite(stated)||stated<0||stated>MAX_BYTES)fail('STORAGE_SIZE_INVALID')
  if(!response.body)fail('STORAGE_BODY_MISSING')
  const reader=response.body.getReader()
  const parts=[];let total=0
  try {
    while(true) {
      const {done,value}=await reader.read()
      if(done)break
      total+=value.byteLength
      if(total>MAX_BYTES)fail('STORAGE_SIZE_INVALID')
      parts.push(value)
    }
  }finally {reader.releaseLock()}
  const joined=new Uint8Array(total)
  let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.length}
  return joined
}
// R2 S3-compatible, bucket-restricted credentials. Cloudflare's narrow
// Object Read & Write permission is NOT supported by the R2 REST API.
// Sign an exact path-style S3 PutObject with AWS Signature V4 and region "auto".
// No AWS SDK, paid product, public URL, or browser credentials are needed.
const sha256=data=>createHash('sha256').update(data).digest('hex')
const hmac=(key,data)=>createHmac('sha256',key).update(data).digest()
export function signedPrivateR2Put({accountId,accessKeyId,secretAccessKey,objectKey,bytes,now=new Date()}) {
 if(!/^[a-f0-9]{32}$/i.test(accountId||''))fail('R2_ACCOUNT_INVALID')
 if(typeof accessKeyId!=='string'||accessKeyId.length<10||
    typeof secretAccessKey!=='string'||secretAccessKey.length<20)fail('R2_CREDENTIALS_INVALID')
 if(!/^evidence\/[\da-f-]{36}\/[\da-f-]{36}[.]webp$/i.test(objectKey||''))
   fail('R2_KEY_INVALID')
 if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>MAX_BYTES)
   fail('R2_BYTES_INVALID')
 if(Number.isNaN(now.getTime()))fail('SIGNING_TIME_INVALID')
 const host=accountId.toLowerCase()+'.r2.cloudflarestorage.com'
 const path='/'+BUCKET+'/'+objectKey.split('/').map(encodeURIComponent).join('/')
 const amzDate=now.toISOString().replace(/[:-]|\.\d{3}/g,'')
 const date=amzDate.slice(0,8)
 const scope=date+'/auto/s3/aws4_request'
 const payloadHash=sha256(bytes)
 const signedHeaders='content-type;host;x-amz-content-sha256;x-amz-date'
 const canonicalHeaders='content-type:image/webp\nhost:'+host+
   '\nx-amz-content-sha256:'+payloadHash+'\nx-amz-date:'+amzDate+'\n'
 const canonicalRequest=['PUT',path,'',canonicalHeaders,signedHeaders,payloadHash].join('\n')
 const stringToSign=['AWS4-HMAC-SHA256',amzDate,scope,sha256(canonicalRequest)].join('\n')
 const signingKey=hmac(hmac(hmac(hmac('AWS4'+secretAccessKey,date),'auto'),'s3'),'aws4_request')
 const signature=hmac(signingKey,stringToSign).toString('hex')
 return {
   endpoint:'https://'+host+path,
   request:{
     method:'PUT',
     headers:{
       authorization:'AWS4-HMAC-SHA256 Credential='+accessKeyId+'/'+scope+
         ', SignedHeaders='+signedHeaders+', Signature='+signature,
       'content-type':'image/webp',
       'x-amz-content-sha256':payloadHash,
       'x-amz-date':amzDate
     },
     body:bytes,
     redirect:'error',
     signal:AbortSignal.timeout(30000)
   }
 }
}
export function privateImageRemote(env,fetchImpl=fetch) {
 const supabase=env.AMPHON_SEO_SUPABASE_URL
 const key=env.AMPHON_SEO_SERVICE_ROLE_KEY
 const accountId=env.AMPHON_CLOUDFLARE_ACCOUNT_ID
 const accessKeyId=env.AMPHON_R2_ACCESS_KEY_ID
 const secretAccessKey=env.AMPHON_R2_SECRET_ACCESS_KEY
 if(!/^https:\/\/[a-z0-9-]+[.]supabase[.]co\/?$/.test(supabase||'') ||
    typeof key!=='string'||key.length<30)fail('SUPABASE_NOT_CONFIGURED')
 if(!/^[a-f0-9]{32}$/i.test(accountId||'') ||
    typeof accessKeyId!=='string'||accessKeyId.length<10 ||
    typeof secretAccessKey!=='string'||secretAccessKey.length<20)
    fail('PRIVATE_R2_NOT_CONFIGURED')
 return {
  async downloadPrivate(storagePath) {
    if(typeof storagePath!=='string'||!/^[-a-z0-9/_.]+$/i.test(storagePath)||
       storagePath.includes('..')||storagePath.startsWith('/'))fail('STORAGE_PATH_INVALID')
    const path='/storage/v1/object/trade-evidence-private/'+
      storagePath.split('/').map(encodeURIComponent).join('/')
    const response=await fetchImpl(new URL(path,supabase),{
      headers:{apikey:key,authorization:'Bearer '+key},
      redirect:'error',signal:AbortSignal.timeout(30000)
    })
    return boundedRead(response)
  },
  async putPrivate(objectKey,bytes) {
    const signed=signedPrivateR2Put({accountId,accessKeyId,secretAccessKey,objectKey,bytes})
    const response=await fetchImpl(signed.endpoint,signed.request)
    if(!response.ok)fail('R2_PRIVATE_UPLOAD_FAILED')
    return true
  }
 }
}
export async function stagePrivateEvidenceImage(id,{store,remote,dryRun=true}) {
 if(!UUID.test(id||''))fail('REQUEST_ID_INVALID')
 const snap=await store.loadSnapshot(id)
 const gate=validateStagingImage(snap)
 const result={outcome:'DRY_RUN_APPROVED',request_id:id,site_id:snap.request.site_id,
   media_public:false,production_deployed:false,performed_write:false,
   claim_kind:gate.claim,storage:'PRIVATE_R2_ONLY'}
 if(dryRun)return result
 const original=await remote.downloadPrivate(gate.privatePath)
 const cleaned=await toPrivateWebp(original)
 // Recheck current owner/consent/individual-image approval immediately before
 // writing R2; revoke during conversion must fail closed, not publish stale data.
 const current=validateStagingImage(await store.loadSnapshot(id))
 if(current.key!==gate.key||current.privatePath!==gate.privatePath||current.claim!==gate.claim)
   fail('APPROVAL_CHANGED_DURING_CONVERSION')
 await remote.putPrivate(gate.key,cleaned)
 return {...result,outcome:'PRIVATE_WEBP_STAGED',performed_write:true,
   output_bytes:cleaned.length,output_sha256:createHash('sha256').update(cleaned).digest('hex')}
}
export function parseImageArgs(args) {
 const result={id:null,dryRun:true,ownerAuthorized:false}
 for(let i=0;i<args.length;i++) {
   if(args[i]==='--request-id'&&args[i+1])result.id=args[++i]
   else if(args[i]==='--dry-run')result.dryRun=true
   else if(args[i]==='--execute')result.dryRun=false
   else if(args[i]==='--owner-authorized')result.ownerAuthorized=true
   else fail('INVALID_CLI_ARGUMENT')
 }
 if(!UUID.test(result.id||''))fail('REQUEST_ID_REQUIRED')
 if(!result.dryRun&&!result.ownerAuthorized)fail('OWNER_APPROVAL_REQUIRED')
 return result
}
export async function runImageCli(args=process.argv.slice(2),env=process.env) {
 const parsed=parseImageArgs(args)
 const store=storeAdapter(env.AMPHON_SEO_SUPABASE_URL,env.AMPHON_SEO_SERVICE_ROLE_KEY)
 // Even a dry-run must not access R2 or any source image.
 const remote=parsed.dryRun?null:privateImageRemote(env)
 return stagePrivateEvidenceImage(parsed.id,{store,remote,dryRun:parsed.dryRun})
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 runImageCli().then(result=>console.log(JSON.stringify(result,null,2)))
  .catch(err=>{const code=err instanceof Error?err.message:'EVIDENCE_IMAGE_UNKNOWN'
    console.error(code.startsWith('EVIDENCE_')?code:'EVIDENCE_IMAGE_REMOTE_FAILURE')
    process.exitCode=1
  })
}
