#!/usr/bin/env node
/** Protected, on-demand queue -> DRAFT PR only. NEVER merge or deploy. */
import {pathToFileURL} from 'node:url'
import {githubAdapter} from './seo-draft-pr-executor-adapters.mjs'
import {executeEvidenceDraftPr,inspectSnapshot} from './evidence-draft-pr-core.mjs'
const uuid=/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const die=msg=>{throw Error('EVIDENCE_PR_'+msg)}
const selectOne=(rows,label)=>{
 if(!Array.isArray(rows)||rows.length!==1)die(label+'_NOT_UNIQUE')
 return rows[0]
}
export function storeAdapter(url,key) {
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url||''))die('SUPABASE_URL_INVALID')
 if(typeof key!=='string'||key.length<30)die('SUPABASE_KEY_REQUIRED')
 const base=url.replace(/\/$/,'')+'/rest/v1/'
 async function request(table,filter={},select='*',{method='GET',payload}={}) {
   const params=new URLSearchParams({select})
   for(const [k,v] of Object.entries(filter))params.set(k, 'eq.'+String(v))
   const res=await fetch(base+table+'?'+params.toString(),{
     method,headers:{'apikey':key,'authorization':'Bearer '+key,
       ...(payload?{'content-type':'application/json','prefer':'return=representation'}:{})},
     ...(payload?{body:JSON.stringify(payload)}:{}),
     redirect:'error',signal:AbortSignal.timeout(16000)
   })
   if(!res.ok)die('DATABASE_'+table+'_'+res.status)
   return res.json()
 }
 return {
  async loadSnapshot(id) {
   if(!uuid.test(id||''))die('REQUEST_ID_INVALID')
   const r=selectOne(await request('commerce_evidence_publication_requests',{id}),
     'REQUEST')
   const [evidence,image,site,project,mapping,requester]=await Promise.all([
      request('trade_evidence',{id:r.evidence_id}),
      request('trade_evidence_images',{id:r.image_id}),
      request('commerce_seo_sites',{id:r.site_id},'id,origin,enabled'),
      request('commerce_seo_portfolio_projects',{site_id:r.site_id},
        'site_id,production_repo,production_branch,mapping_status,central_deploy_allowed'),
      request('commerce_evidence_page_source_mappings',{site_id:r.site_id,page_path:r.page_path}),
      request('profiles',{id:r.requested_by},'id,role,active')
   ])
   const m=selectOne(mapping,'REVIEWED_MAPPING')
   return {request:r,evidence:selectOne(evidence,'EVIDENCE'),image:selectOne(image,'IMAGE'),
     site:selectOne(site,'SITE'),project:selectOne(project,'PROJECT'),mapping:m,
     requester:selectOne(requester,'REQUESTER'),expected_base_sha:m.expected_base_sha}
  },
  async recordDraft(id,pr,headSha,baseSha,cfg) {
    if(!uuid.test(id||'')||!/^https:\/\/github.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr.url||''))
      die('PR_RECORD_INVALID')
    const result=await request('commerce_evidence_publication_requests',
      {id,status:'PENDING_SOURCE_PR'},'*',{method:'PATCH',payload:{
        status:'DRAFT_PR_OPEN',draft_pr_number:pr.number,draft_pr_url:pr.url,draft_commit_sha:headSha
      }})
    if(!Array.isArray(result)||result.length!==1)die('PR_RECORD_FAILED_RECONCILE')
    return result[0]
  }
 }
}
export function parseArgs(args) {
 const o={requestId:null,dryRun:true,authorized:false,resolve:false}
 for(let i=0;i<args.length;i++) {
   const a=args[i]
   if(a==='--request-id'&&args[i+1])o.requestId=args[++i]
   else if(a==='--dry-run')o.dryRun=true
   else if(a==='--execute')o.dryRun=false
   else if(a==='--owner-authorized')o.authorized=true
   else if(a==='--resolve-target')o.resolve=true
   else die('UNKNOWN_FLAG')
 }
 if(!uuid.test(o.requestId||''))die('REQUEST_ID_REQUIRED')
 if(!o.dryRun&&!o.authorized)die('OWNER_APPROVAL_REQUIRED')
 if(o.resolve&&!o.dryRun)die('TARGET_RESOLVE_READ_ONLY')
 return o
}
export async function run(args=process.argv.slice(2),env=process.env) {
 const o=parseArgs(args),store=storeAdapter(env.AMPHON_SEO_SUPABASE_URL,env.AMPHON_SEO_SERVICE_ROLE_KEY)
 if(o.resolve) {
   const s=await store.loadSnapshot(o.requestId)
   const cfg=inspectSnapshot(s)
   const [owner,repository]=cfg.repo.split('/')
   return {target_owner:owner,target_repository:repository,queue_id:o.requestId}
 }
 const github=githubAdapter(env.AMPHON_SEO_GITHUB_TOKEN)
 return executeEvidenceDraftPr(o.requestId,{store,github,dryRun:o.dryRun})
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 run().then(result=>{
   // Never log raw text, storage keys or private user data.
   if(process.argv.includes('--resolve-target')) {
     console.log('owner='+result.target_owner+'\nrepository='+result.target_repository)
   } else console.log(JSON.stringify(result,null,2))
 }).catch(error=>{console.error(error instanceof Error?error.message:'EVIDENCE_PR_FAILED');process.exitCode=1})
}
