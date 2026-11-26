import {assertPublicationEligible, publicMediaKey, validatePublicationTargets} from '../../src/lib/evidencePublisherPolicy.ts'
import {evidenceServiceHeaders} from '../../src/lib/evidenceSupabaseServerAuth.mjs'

// Evidence Publisher queues approved metadata ONLY. Source images are never handled
// in this Cloudflare Worker. Owner-protected Node GitHub Actions runs Sharp later.
// No public GET media route, public image URL, merge, or deployment here.
const json=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
})
const uuid=/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
function allowedOrigin(request,env) {
  const origin=request.headers.get('origin')||''
  return (env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean).includes(origin)?origin:null
}
function cors(response,origin) {
  const headers=new Headers(response.headers)
  headers.set('access-control-allow-origin',origin)
  headers.set('access-control-allow-methods','POST, OPTIONS')
  headers.set('access-control-allow-headers','Authorization, Content-Type')
  headers.set('vary','Origin')
  return new Response(response.body,{status:response.status,headers})
}
function configuration(env) {
  if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||!env.SUPABASE_PUBLISHABLE_KEY)
    throw Error('WORKER_NOT_CONFIGURED')
  const endpoint=new URL(env.SUPABASE_URL)
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)
    throw Error('WORKER_NOT_CONFIGURED')
}
async function body(request) {
  if(Number(request.headers.get('content-length')||0)>12000)throw Error('BODY_TOO_LARGE')
  const data=await request.text()
  if(data.length>12000)throw Error('BODY_TOO_LARGE')
  const parsed=JSON.parse(data)
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('BODY_INVALID')
  return parsed
}
async function db(env,path,{method='GET',body:payload}={}) {
  const res=await fetch(new URL(path,env.SUPABASE_URL),{
    method,headers:{
      ...evidenceServiceHeaders(env.SUPABASE_SECRET_KEY),
      ...(payload?{'content-type':'application/json','prefer':'return=representation'}:{})
    },body:payload?JSON.stringify(payload):undefined,redirect:'error'
  })
  if(!res.ok)throw Error(res.status===409?'QUEUE_CONFLICT':'DATABASE_REQUEST_FAILED')
  return res.status===204?[]:res.json()
}
async function requireOwner(request,env) {
  const bearer=request.headers.get('authorization')||''
  if(!/^Bearer\s+[^\s]+$/.test(bearer))throw Error('UNAUTHORIZED')
  const res=await fetch(new URL('/auth/v1/user',env.SUPABASE_URL),{
    headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:bearer},redirect:'error'
  })
  if(!res.ok)throw Error('UNAUTHORIZED')
  const user=await res.json()
  if(!uuid.test(user.id||''))throw Error('UNAUTHORIZED')
  const rows=await db(env,'/rest/v1/profiles?id=eq.'+user.id+'&select=role,active')
  if(rows.length!==1||rows[0].role!=='owner'||rows[0].active!==true)throw Error('FORBIDDEN')
  return user.id
}
async function recheck(env,evidenceId,imageId) {
  const [records,images,projects]=await Promise.all([
    db(env,'/rest/v1/trade_evidence?id=eq.'+evidenceId+
      '&select=id,kind,status,permission_confirmed,privacy_reviewed,approved_at,transaction_verified'),
    db(env,'/rest/v1/trade_evidence_images?id=eq.'+imageId+
      '&select=id,evidence_id,storage_path,approved_for_public'),
    db(env,'/rest/v1/commerce_seo_portfolio_projects?mapping_status=eq.VERIFIED&select=site_id,production_repo,production_branch,central_deploy_allowed')
  ])
  if(records.length!==1||images.length!==1)throw Error('EVIDENCE_NOT_FOUND')
  const claim=assertPublicationEligible(records[0],images[0],evidenceId)
  const eligible=projects.filter(x=>x.production_repo&&x.production_branch&&x.central_deploy_allowed===false)
  const sites=await db(env,'/rest/v1/commerce_seo_sites?enabled=eq.true&select=id')
  return {claim, sites:new Set(sites.map(x=>x.id).filter(id=>eligible.some(p=>p.site_id===id)))}
}
// The Cloudflare Worker never downloads or re-encodes private customer photos.
// This route only queues approved metadata. Sharp runs in an owner-protected
// GitHub Actions Node.js runner AFTER a separate authorization gate.
// Workflow dispatch is scoped to the CENTRAL Hub repository's Actions:write permission only.
// The workflow has a protected owner-reviewed environment and independently checks
// the VERIFIED target repo before creating any Draft PR. No site repo write credentials here.
async function dispatchOwnerApprovedDraftJobs(env,receipts) {
  if(env.EVIDENCE_PR_DISPATCH_ENABLED!=='true')
    return receipts.map(r=>({request_id:r.id,dispatch:'PENDING_PROTECTED_WORKFLOW'}))
  if(!env.GITHUB_DISPATCH_TOKEN||env.GITHUB_DISPATCH_TOKEN.length<20)
    throw Error('DISPATCH_NOT_CONFIGURED')
  const results=[]
  for(const receipt of receipts) {
    if(receipt.status!=='PENDING_SOURCE_PR') {
      results.push({request_id:receipt.id,dispatch:'ALREADY_REVIEWED'});continue
    }
    try {
      const response=await fetch('https://api.github.com/repos/noteroru2/amphon-product-hub-shop/actions/workflows/evidence-draft-pr-execute.yml/dispatches',{
        method:'POST',headers:{
          authorization:'Bearer '+env.GITHUB_DISPATCH_TOKEN,
          accept:'application/vnd.github+json',
          'x-github-api-version':'2022-11-28',
          'content-type':'application/json',
          'user-agent':'amphon-evidence-publisher'
        },body:JSON.stringify({ref:'main',inputs:{request_id:receipt.id}}),
        redirect:'error',signal:AbortSignal.timeout(12000)
      })
      results.push({request_id:receipt.id,dispatch:response.status===204?'PROTECTED_REVIEW_REQUESTED':'DISPATCH_FAILED'})
    }catch{
      results.push({request_id:receipt.id,dispatch:'DISPATCH_FAILED'})
    }
  }
  return results
}
async function stage(request,env,actor) {
  const input=await body(request)
  if(!uuid.test(input.evidence_id||'')||!uuid.test(input.image_id||''))
    throw Error('INVALID_ID')
  const targets=validatePublicationTargets(input.targets)
  const {claim,sites}=await recheck(env,input.evidence_id,input.image_id)
  if(targets.some(x=>!sites.has(x.site_id)))throw Error('SITE_NOT_VERIFIED')
  const key=publicMediaKey(input.evidence_id,input.image_id)
  const receipts=[]
  for(const target of targets) {
    const query='/rest/v1/commerce_evidence_publication_requests?evidence_id=eq.'+input.evidence_id+
      '&image_id=eq.'+input.image_id+'&site_id=eq.'+target.site_id+
      '&page_path=eq.'+encodeURIComponent(target.page_path)+
      '&select=id,site_id,page_path,status'
    const existing=await db(env,query)
    if(existing.length) {
      if(existing[0].status==='CANCELLED')throw Error('CANCELLED_REQUEST_REQUIRES_NEW_REVIEW')
      receipts.push(existing[0]);continue
    }
    const created=await db(env,'/rest/v1/commerce_evidence_publication_requests',{method:'POST',body:{
      evidence_id:input.evidence_id,image_id:input.image_id,
      site_id:target.site_id,page_path:target.page_path,private_media_key:key,
      claim_kind:claim.claim_kind,requested_by:actor,status:'PENDING_SOURCE_PR'
    }})
    if(created.length!==1)throw Error('QUEUE_INSERT_FAILED')
    receipts.push(created[0])
  }
  const dispatch=await dispatchOwnerApprovedDraftJobs(env,receipts)
  return json({status:'QUEUED_PRIVATE_ONLY',claim_kind:claim.claim_kind,requests:receipts,
    media_staged:false,
    dispatch,media_public:false,site_source_modified:false,draft_pr_created:false,production_deployed:false},201)
}
async function cancel(request,env) {
  const input=await body(request)
  if(!uuid.test(input.request_id||''))throw Error('INVALID_ID')
  const path='/rest/v1/commerce_evidence_publication_requests?id=eq.'+input.request_id+
    '&select=id,status'
  const records=await db(env,path)
  if(records.length!==1)throw Error('QUEUE_NOT_FOUND')
  if(records[0].status!=='PENDING_SOURCE_PR')throw Error('DRAFT_PR_REQUIRES_REVIEW')
  const updated=await db(env,'/rest/v1/commerce_evidence_publication_requests?id=eq.'+
    input.request_id+'&status=eq.PENDING_SOURCE_PR',{method:'PATCH',body:{status:'CANCELLED'}})
  if(updated.length!==1)throw Error('QUEUE_STATE_CHANGED')
  // Cancellation is metadata-only. Never delete a shared private R2 key here:
  // another request can be queued between a last-reference read and deletion.
  // Image retention/cleanup must use a separately approved, locked janitor.
  return json({status:'CANCELLED',media_public:false,private_media_cleanup:'DEFERRED_LOCKED_REVIEW'})
}
export default {
 async fetch(request,env) {
  const url=new URL(request.url)
  if(url.pathname!=='/api/stage'&&url.pathname!=='/api/cancel')return new Response('Not found',{status:404})
  const origin=allowedOrigin(request,env)
  if(!origin)return json({error:'ORIGIN_FORBIDDEN'},403)
  if(request.method==='OPTIONS')return cors(new Response(null,{status:204}),origin)
  if(request.method!=='POST')return cors(json({error:'METHOD_NOT_ALLOWED'},405),origin)
  try {
    configuration(env)
    const actor=await requireOwner(request,env)
    const response=url.pathname==='/api/stage'?await stage(request,env,actor):await cancel(request,env)
    return cors(response,origin)
  } catch(err) {
    const code=err instanceof Error?err.message:'UNKNOWN'
    const client=new Set(['UNAUTHORIZED','FORBIDDEN','INVALID_ID','BODY_TOO_LARGE','BODY_INVALID',
      'TARGET_COUNT_INVALID','TARGET_INVALID','SITE_INVALID','PAGE_PATH_INVALID','DUPLICATE_TARGET',
      'EVIDENCE_NOT_FOUND','EVIDENCE_APPROVAL_REQUIRED','IMAGE_NOT_APPROVED','SITE_NOT_VERIFIED',
      'CANCELLED_REQUEST_REQUIRES_NEW_REVIEW','QUEUE_NOT_FOUND','DRAFT_PR_REQUIRES_REVIEW','QUEUE_STATE_CHANGED'])
    const status=code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:client.has(code)?422:500
    return cors(json({error:status===500?'PUBLISHER_FAILED':code},status),origin)
  }
 }
}
