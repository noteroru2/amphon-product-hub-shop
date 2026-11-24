import {assertPublicationEligible, publicMediaKey, validatePublicationTargets} from '../../src/lib/evidencePublisherPolicy.ts'

const json=(value,status=200,extra={})=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}
})
const uuid=/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i

function originHeader(request,env) {
  const origin=request.headers.get('origin')||''
  const allowed=(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)
  return allowed.includes(origin) ? origin : null
}
function addCors(response,origin) {
  if(!origin)return response
  const headers=new Headers(response.headers)
  headers.set('access-control-allow-origin',origin)
  headers.set('vary','Origin')
  headers.set('access-control-allow-headers','Authorization, Content-Type')
  headers.set('access-control-allow-methods','POST, OPTIONS')
  return new Response(response.body,{status:response.status,headers})
}
async function supabase(env,path,{method='GET',body,auth}={}) {
  const endpoint=new URL(path,env.SUPABASE_URL)
  const res=await fetch(endpoint,{method,headers:{
    'apikey':env.SUPABASE_SECRET_KEY,
    'authorization':'Bearer '+(auth||env.SUPABASE_SECRET_KEY),
    ...(body?{'content-type':'application/json','prefer':'return=representation'}:{})
  },body:body?JSON.stringify(body):undefined,redirect:'error'})
  if(!res.ok)throw Error('DATABASE_REQUEST_FAILED')
  return res.json()
}
async function owner(env,request) {
  const authorization=request.headers.get('authorization')||''
  if(!/^Bearer\s+[^\s]+$/.test(authorization))throw Error('UNAUTHORIZED')
  const identity=await fetch(new URL('/auth/v1/user',env.SUPABASE_URL),{
    headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization},redirect:'error'
  })
  if(!identity.ok)throw Error('UNAUTHORIZED')
  const user=await identity.json()
  if(!uuid.test(user.id||''))throw Error('UNAUTHORIZED')
  const rows=await supabase(env,'/rest/v1/profiles?id=eq.'+encodeURIComponent(user.id)+'&select=id,role,active')
  if(rows.length!==1||rows[0].role!=='owner'||rows[0].active!==true)throw Error('FORBIDDEN')
  return user.id
}
function validEnv(env) {
  if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||!env.SUPABASE_PUBLISHABLE_KEY||
     !env.PUBLIC_ORIGIN||!env.ASSETS||!env.IMAGES)throw Error('WORKER_NOT_CONFIGURED')
  const privateUrl=new URL(env.SUPABASE_URL),publicUrl=new URL(env.PUBLIC_ORIGIN)
  if(privateUrl.protocol!=='https:'||publicUrl.protocol!=='https:'||privateUrl.username||publicUrl.username||
     privateUrl.search||publicUrl.search||privateUrl.hash||publicUrl.hash)throw Error('INVALID_WORKER_CONFIG')
}
async function publish(request,env) {
  const actor=await owner(env,request)
  const text=await request.text()
  if(text.length>12000)throw Error('PAYLOAD_TOO_LARGE')
  const input=JSON.parse(text)
  if(!input||typeof input!=='object'||!uuid.test(input.evidence_id||'')||!uuid.test(input.image_id||''))
    throw Error('INVALID_ID')
  const evidenceId=input.evidence_id,imageId=input.image_id
  const targets=validatePublicationTargets(input.targets)
  const [evidenceRows,imageRows,siteRows]=await Promise.all([
    supabase(env,'/rest/v1/trade_evidence?id=eq.'+evidenceId+
      '&select=id,kind,status,permission_confirmed,privacy_reviewed,approved_at,transaction_verified'),
    supabase(env,'/rest/v1/trade_evidence_images?id=eq.'+imageId+
      '&select=id,evidence_id,storage_path,approved_for_public'),
    supabase(env,'/rest/v1/commerce_seo_sites?enabled=eq.true&select=id,origin')
  ])
  if(evidenceRows.length!==1||imageRows.length!==1)throw Error('EVIDENCE_NOT_FOUND')
  const evidence=evidenceRows[0],image=imageRows[0]
  const {claim_kind}=assertPublicationEligible(evidence,image,evidenceId)
  const allowed=new Set(siteRows.map(site=>site.id))
  if(targets.some(t=>!allowed.has(t.site_id)))throw Error('SITE_NOT_ENABLED')
  const imageKey=publicMediaKey(evidenceId,imageId)
  let saved=await env.ASSETS.head(imageKey)
  if(!saved) {
    // Private storage fetched only with server key; never expose source or a signed URL.
    const privatePath='/storage/v1/object/trade-evidence-private/'+
      image.storage_path.split('/').map(encodeURIComponent).join('/')
    const original=await fetch(new URL(privatePath,env.SUPABASE_URL),{
      headers:{apikey:env.SUPABASE_SECRET_KEY,authorization:'Bearer '+env.SUPABASE_SECRET_KEY},
      redirect:'error'
    })
    const size=Number(original.headers.get('content-length')||0)
    if(!original.ok||size>8_388_608)throw Error('PRIVATE_IMAGE_READ_FAILED')
    if(!/^image\/(jpeg|png|webp)$/i.test(original.headers.get('content-type')||''))
      throw Error('UNSUPPORTED_IMAGE')
    // Decoding and re-encoding discards the original file's EXIF/GPS blocks.
    const transformed=(await env.IMAGES.input(original.body)
      .transform({width:1400,fit:'scale-down'})
      .output({format:'image/webp',quality:82})).response()
    if(!transformed.ok)throw Error('TRANSFORM_FAILED')
    const bytes=await transformed.arrayBuffer()
    if(bytes.byteLength>8_388_608||bytes.byteLength<12)throw Error('OUTPUT_TOO_LARGE')
    const header=new Uint8Array(bytes.slice(0,12))
    const ascii=String.fromCharCode(...header)
    if(!ascii.startsWith('RIFF')||ascii.slice(8,12)!=='WEBP')throw Error('INVALID_WEBP_OUTPUT')
    await env.ASSETS.put(imageKey,bytes,{
      httpMetadata:{contentType:'image/webp',cacheControl:'public, max-age=31536000, immutable'},
      customMetadata:{evidenceId,imageId,reviewed:'true'}
    })
    saved=await env.ASSETS.head(imageKey)
  }
  if(!saved)throw Error('MEDIA_WRITE_FAILED')
  const mediaUrl=new URL('/media/'+imageKey,env.PUBLIC_ORIGIN).href
  // A server-controlled queue, never a live website release.
  const receipts=await supabase(env,'/rest/v1/commerce_evidence_publication_requests',{
    method:'POST',body:targets.map(t=>({
      evidence_id:evidenceId,image_id:imageId,site_id:t.site_id,page_path:t.page_path,
      public_media_key:imageKey,public_media_url:mediaUrl,claim_kind,
      requested_by:actor,status:'PENDING_SOURCE_PR'
    }))
  })
  return json({status:'PENDING_SOURCE_PR',claim_kind,media_url:mediaUrl,
    requests:receipts.map(x=>({id:x.id,site_id:x.site_id,page_path:x.page_path,status:x.status})),
    notice:'Queued for a separately reviewed source Draft PR. No website change, merge, or deploy was performed.'},201)
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url)
    if(request.method==='GET'&&url.pathname.startsWith('/media/evidence/')) {
      const match=/^\/media\/evidence\/([a-f\d-]{36})\/([a-f\d-]{36})\.webp$/i.exec(url.pathname)
      if(!match||!uuid.test(match[1])||!uuid.test(match[2]))return new Response('Not found',{status:404})
      if(!env.ASSETS)return new Response('Unavailable',{status:503})
      const obj=await env.ASSETS.get(publicMediaKey(match[1],match[2]))
      if(!obj)return new Response('Not found',{status:404})
      return new Response(obj.body,{headers:{
        'content-type':'image/webp','cache-control':'public,max-age=3600',
        'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'"
      }})
    }
    if(url.pathname!=='/api/publish')return new Response('Not found',{status:404})
    const origin=originHeader(request,env)
    if(!origin)return json({error:'ORIGIN_FORBIDDEN'},403)
    if(request.method==='OPTIONS')return addCors(new Response(null,{status:204}),origin)
    if(request.method!=='POST')return addCors(json({error:'METHOD_NOT_ALLOWED'},405),origin)
    try {
      validEnv(env)
      return addCors(await publish(request,env),origin)
    } catch(error) {
      const code=error instanceof Error?error.message:'UNKNOWN'
      const clientCodes=new Set(['UNAUTHORIZED','FORBIDDEN','INVALID_ID','TARGET_COUNT_INVALID',
        'TARGET_INVALID','SITE_INVALID','PAGE_PATH_INVALID','DUPLICATE_TARGET',
        'EVIDENCE_APPROVAL_REQUIRED','IMAGE_NOT_APPROVED','EVIDENCE_NOT_FOUND','SITE_NOT_ENABLED'])
      const status=code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:clientCodes.has(code)?422:500
      return addCors(json({error:status===500?'PUBLISHER_FAILED':code},status),origin)
    }
  }
}
