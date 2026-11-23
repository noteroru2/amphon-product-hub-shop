#!/usr/bin/env node
/**
 * Operator-triggered READ ONLY evidence discovery.
 * Inputs can select only a site from the enabled, verified Supabase registry.
 * Never writes to Google, GitHub, Cloudflare, or Supabase.
 *
 * Secret inputs (GitHub Actions protected environment, never browser):
 * AMPHON_SEO_SUPABASE_URL, AMPHON_SEO_SERVICE_ROLE_KEY
 * AMPHON_CLOUDFLARE_ACCOUNT_ID, AMPHON_CLOUDFLARE_API_TOKEN
 * AMPHON_SEO_GITHUB_READ_TOKEN (optional for public repositories)
 */
import {pathToFileURL} from 'node:url'
import {digestBody,sha40,validateEvidenceTarget,
  assessProductionDiscovery} from './seo-production-evidence-core.mjs'

const fail=x=>{throw Error('SEO_PRODUCTION_EVIDENCE_'+x)}
const STAGES=new Set(['SUPABASE_SITES','SUPABASE_PROJECTS','GITHUB_BRANCH','GITHUB_COMPARE','CLOUDFLARE_DEPLOYMENTS'])
const jsonGet=async(url,headers={},stage)=>{ 
  if(!STAGES.has(stage))fail('INVALID_UPSTREAM_STAGE')
  const response=await fetch(url,{method:'GET',headers:{
    Accept:'application/json',...headers,
  },redirect:'error',signal:AbortSignal.timeout(15000)})
  // Stage + numeric status only. Never log URL, response body, auth header, or secrets.
  if(!response.ok)fail(stage+'_HTTP_'+response.status)
  return response.json()
}
const encodeRepo=repo=>repo.split('/').map(encodeURIComponent).join('/')
const encodeBranch=branch=>branch.split('/').map(encodeURIComponent).join('/')
const tokenHeader=t=>t?{Authorization:'Bearer '+t}:{}
function safeSupabaseBase(raw) {
  if(typeof raw!=='string')fail('SUPABASE_URL_REQUIRED')
  const u=new URL(raw)
  if(u.protocol!=='https:'||u.username||u.password||u.port||
    !/^[a-z0-9-]+\.supabase\.co$/i.test(u.hostname)||u.pathname!=='/')
    fail('UNSAFE_SUPABASE_URL')
  return u.origin
}
const noSecrets=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{}
export function parseArgs(args){
  const a={siteId:null,expectedSha:null}
  for(let i=0;i<args.length;i++){
    if(args[i]==='--site-id'&&args[i+1])a.siteId=args[++i]
    else if(args[i]==='--expected-sha'&&args[i+1])a.expectedSha=args[++i]
    else fail('INVALID_ARGUMENT')
  }
  if(!/^[a-z0-9_-]{2,32}$/.test(a.siteId||''))fail('SITE_ID_REQUIRED')
  if(a.expectedSha!==null&&!sha40(a.expectedSha))fail('EXPECTED_SHA_MUST_BE_40_HEX')
  return a
}
async function loadApprovedMapping(env,siteId){
  const base=safeSupabaseBase(env.AMPHON_SEO_SUPABASE_URL)
  const key=env.AMPHON_SEO_SERVICE_ROLE_KEY
  if(typeof key!=='string'||key.length<24)fail('READ_ONLY_STORE_CREDENTIAL_REQUIRED')
  const headers={apikey:key,Authorization:'Bearer '+key}
  const [sites,projects]=await Promise.all([
    jsonGet(base+'/rest/v1/commerce_seo_sites?'+new URLSearchParams({
      select:'id,label,origin,enabled',id:'eq.'+siteId,limit:'1',
    }),headers,'SUPABASE_SITES'),
    jsonGet(base+'/rest/v1/commerce_seo_portfolio_projects?'+new URLSearchParams({
      select:'site_id,production_repo,production_branch,hosting_provider,hosting_project_id,mapping_status,central_deploy_allowed',
      site_id:'eq.'+siteId,limit:'1',
    }),headers,'SUPABASE_PROJECTS')
  ])
  if(!Array.isArray(sites)||sites.length!==1||
    !Array.isArray(projects)||projects.length!==1)fail('MAPPING_NOT_FOUND')
  return {site:sites[0],project:projects[0]}
}
async function loadGithub(ref,sha,env) {
  const base='https://api.github.com/repos/'+encodeRepo(ref.repo)
  const headers={
    'X-GitHub-Api-Version':'2022-11-28',
    'Accept':'application/vnd.github+json',
    ...tokenHeader(env.AMPHON_SEO_GITHUB_READ_TOKEN || env.GITHUB_TOKEN),
  }
  const branch=await jsonGet(base+'/git/ref/heads/'+encodeBranch(ref.branch),headers,'GITHUB_BRANCH')
  const refSha=branch?.object?.sha
  let compare=null
  if(sha40(sha)&&sha40(refSha)&&sha.toLowerCase()!==refSha.toLowerCase()){
    const params=encodeURIComponent(sha)+'...'+encodeBranch(ref.branch)
    compare=await jsonGet(base+'/compare/'+params,headers,'GITHUB_COMPARE')
  }
  return {ref_sha:refSha,compare}
}
async function loadCloudflare(ref,env) {
  const account=env.AMPHON_CLOUDFLARE_ACCOUNT_ID
  const token=env.AMPHON_CLOUDFLARE_API_TOKEN
  if(!/^[a-f0-9]{32}$/i.test(account||'')||
    typeof token!=='string'||token.length<20)
    fail('CLOUDFLARE_READ_CREDENTIALS_REQUIRED')
  const path='https://api.cloudflare.com/client/v4/accounts/'+account+
    '/workers/scripts/'+encodeURIComponent(ref.worker)+'/deployments'
  const response=await jsonGet(path,tokenHeader(token),'CLOUDFLARE_DEPLOYMENTS')
  if(response?.success!==true)fail('INVALID_CLOUDFLARE_PROVIDER_RESPONSE')
  return response
}
async function probePublicOrigin(origin) {
  try {
    const response=await fetch(origin+'/',{
      method:'GET',redirect:'manual',signal:AbortSignal.timeout(15000),
      headers:{Accept:'text/html'},
    })
    if(response.status!==200)return {status:response.status,final_origin:null}
    const target=new URL(response.url)
    if(target.origin!==origin||!response.headers.get('content-type')?.includes('text/html'))
      return {status:response.status,final_origin:null}
    const reader=response.body?.getReader()
    if(!reader)return {status:response.status,final_origin:null}
    let size=0
    const buffers=[]
    while(true){
      const {done,value}=await reader.read()
      if(done)break
      size+=value.byteLength
      if(size>1_500_000){
        await reader.cancel()
        return {status:response.status,final_origin:null}
      }
      buffers.push(value)
    }
    const bytes=Buffer.concat(buffers.map(x=>Buffer.from(x)))
    const body=bytes.toString('utf8')
    if(body.includes('\uFFFD'))return {status:response.status,final_origin:null}
    return {status:response.status,final_origin:origin,body_sha256:digestBody(body)}
  }catch{return {status:null,final_origin:null}}
}
export async function collectEvidence(args,env=process.env,now=new Date()){
  const a=parseArgs(args)
  const mapping=await loadApprovedMapping(env,a.siteId)
  const target=validateEvidenceTarget(mapping)
  // These independent reads may run together; none can alter a remote system.
  const [github,cloudflare,http]=await Promise.all([
    loadGithub(target,a.expectedSha,env),
    loadCloudflare(target,env),
    probePublicOrigin(target.origin),
  ])
  return assessProductionDiscovery({
    ...mapping,github,cloudflare,http,expectedSha:a.expectedSha,
    observedAt:now.toISOString(),
  })
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  collectEvidence(process.argv.slice(2)).then(result=>{
    process.stdout.write(JSON.stringify(result,null,2)+'\n')
  }).catch(err=>{
    console.error(err instanceof Error?err.message:'SEO_PRODUCTION_EVIDENCE_FAILED')
    process.exitCode=1
  })
}
