/**
 * P8 — deterministic read-only GitHub/Cloudflare production evidence report.
 *
 * Even a 100% Cloudflare Worker deployment plus a GitHub SHA can NOT prove
 * that the Worker serves that SHA. This module does not produce an attestation
 * or write a PRODUCTION_VERIFIED row.
 */
import {createHash} from 'node:crypto'

const SHA40=/^[a-f0-9]{40}$/i
const UUID=/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i
const REPO=/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/
const REF=/^[A-Za-z0-9._/-]{1,120}$/
const ID=/^[a-z0-9_-]{2,32}$/
const fail=x=>{throw Error('SEO_PRODUCTION_EVIDENCE_'+x)}
export const sha40=v=>typeof v==='string'&&SHA40.test(v)
const saneString=(x,max=200)=>typeof x==='string'?x.slice(0,max):null
const safeUrl=raw=>{
  if(typeof raw!=='string'||raw.length>2048)fail('UNSAFE_ORIGIN')
  let u
  try{u=new URL(raw)}catch{fail('UNSAFE_ORIGIN')}
  if(u.protocol!=='https:'||u.username||u.password||u.port||
    u.pathname!=='/'||u.search||u.hash||
    /^\[|^(?:\d+\.){3}\d+$/.test(u.hostname)||
    /(?:\.local|\.internal|\.test|\.invalid|localhost)$/i.test(u.hostname))
    fail('UNSAFE_ORIGIN')
  return u.origin
}
export function validateEvidenceTarget({site,project}) {
  if(!site||!project||!ID.test(site.id||'')||!site.enabled||
     project.site_id!==site.id||project.mapping_status!=='VERIFIED'||
     project.central_deploy_allowed!==false||
     !REPO.test(project.production_repo||'')||
     !REF.test(project.production_branch||'')||
     project.production_branch.split('/').some(p=>!p||p==='.'||p==='..')||
     project.hosting_provider!=='CLOUDFLARE_WORKERS'||
     !/^[A-Za-z0-9][A-Za-z0-9_-]{1,95}$/.test(project.hosting_project_id||''))
    fail('VERIFIED_CLOUDFLARE_MAPPING_REQUIRED')
  return {site_id:site.id,site_label:saneString(site.label,120),
    origin:safeUrl(site.origin),
    repo:project.production_repo,branch:project.production_branch,
    worker:project.hosting_project_id}
}
/** GitHub compare status is indicative ancestry, never a Hosting attestation. */
export function githubAncestryPresent(expectedSha,refSha,compare) {
  if(!sha40(expectedSha)||!sha40(refSha))return false
  if(expectedSha.toLowerCase()===refSha.toLowerCase())return true
  return Boolean(compare&&typeof compare==='object'&&
    ['ahead','identical'].includes(compare.status)&&
    compare.base_commit?.sha?.toLowerCase()===expectedSha.toLowerCase()&&
    compare.merge_base_commit?.sha?.toLowerCase()===expectedSha.toLowerCase()&&
    compare.commits?.every(x=>sha40(x?.sha))&&
    compare.ahead_by>=1)
}
export function selectLiveDeployment(payload) {
  const deployments=payload?.result?.deployments
  if(!Array.isArray(deployments)||deployments.length===0)
    return {deployment_id:null,version_id:null,created_at:null,
      traffic_percent:null,blockers:['NO_WORKER_DEPLOYMENT']}
  const rows=deployments.filter(x=>x&&typeof x==='object'&&
    typeof x.created_on==='string'&&!Number.isNaN(Date.parse(x.created_on)))
    .sort((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on))
  const head=rows[0]
  if(!head)return {deployment_id:null,version_id:null,created_at:null,
    traffic_percent:null,blockers:['NO_VALID_WORKER_DEPLOYMENT']}
  const versions=Array.isArray(head.versions)?head.versions:[]
  const exact=versions.length===1&&versions[0]?.percentage===100&&
    UUID.test(versions[0]?.version_id??'')
  const id=UUID.test(head.id??'')?head.id:null
  return {deployment_id:id,version_id:exact?versions[0].version_id:null,
    created_at:new Date(head.created_on).toISOString(),
    traffic_percent:exact?100:null,
    blockers:[...(id?[]:['NO_HOSTING_DEPLOYMENT_ID']),
      ...(exact?[]:['CLOUDFLARE_SPLIT_OR_INVALID_TRAFFIC'])]}
}
/**
 * The GitHub branch and the deployment are independent facts.
 * It is forbidden to upgrade the report to PRODUCTION_VERIFIED just because
 * a Cloudflare annotation mentions a short or full SHA string.
 */
export function assessProductionDiscovery({
  site,project,github,cloudflare,http,expectedSha,observedAt,
}) {
  const target=validateEvidenceTarget({site,project})
  const clock=typeof observedAt==='string'&&!Number.isNaN(Date.parse(observedAt))?
    new Date(observedAt).toISOString():new Date().toISOString()
  const refSha=sha40(github?.ref_sha)?github.ref_sha.toLowerCase():null
  const expected=sha40(expectedSha)?expectedSha.toLowerCase():null
  const checked=Boolean(expected&&refSha&&githubAncestryPresent(expected,refSha,github?.compare))
  const live=selectLiveDeployment(cloudflare)
  const validHttp=Boolean(http?.status===200&&http.final_origin===target.origin&&
    /^[a-f0-9]{64}$/i.test(http.body_sha256||''))
  const blockers=[
    ...(refSha?[]:['GITHUB_PRODUCTION_BRANCH_SHA_UNAVAILABLE']),
    ...(!expected?['APPROVED_FULL_RELEASE_SHA_REQUIRED']:checked?[]:
      ['SOURCE_SHA_NOT_ON_REGISTERED_PRODUCTION_BRANCH']),
    ...live.blockers,
    ...(!validHttp?['LIVE_ORIGIN_HTTP_PROBE_MISSING']:[]),
    // No immutable provider Git provenance or reproducible build binary
    // evidence has been collected by this read-only discovery process.
    'EXACT_HOSTING_GITHUB_SHA_OR_ASSET_CHECKSUM_UNPROVEN',
    'RELEASE_AFFECTED_URL_QA_NOT_ATTESTED',
  ]
  return {
    schema:'amphon.seo.production-evidence-discovery.v1',
    observed_at:clock,
    site_id:target.site_id,site_label:target.site_label,
    origin:target.origin,repository:target.repo,production_branch:target.branch,
    worker_script:target.worker,
    github_branch_sha:refSha,expected_release_sha:expected,
    expected_sha_is_on_approved_branch:checked,
    deployment_id:live.deployment_id,worker_version_id:live.version_id,
    deployment_time:live.created_at,live_traffic_percent:live.traffic_percent,
    live_http_ok:validHttp,live_origin_body_sha256:validHttp?http.body_sha256.toLowerCase():null,
    missing_evidence:[...new Set(blockers)],
    production_verified:false,
    seo_uplift_measured:false,
    can_write_ledger:false,can_merge:false,can_deploy:false,
    next_action:'Correlate full GitHub SHA with immutable Hosting build/version evidence and compare the exact built artifact to live bytes; verify real affected URLs and QA separately before owner-approved ledger attestation.',
  }
}
export function digestBody(text) {
  if(typeof text!=='string'||text.length>2_000_000)fail('UNSAFE_HTTP_BODY')
  return createHash('sha256').update(text,'utf8').digest('hex')
}
