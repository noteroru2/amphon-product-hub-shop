/**
 * Production release evidence policy for AMPHON SEO.
 *
 * Read-only, fail-closed. A Git commit is not a Deploy; a provider READY event
 * is not proof that the public domain serves the approved SHA. Rolling GSC
 * totals are NOT date-scoped before/after measurements.
 */
export interface ReleaseSite { id: string; label: string; origin: string }
export interface ReleaseProject {
  site_id: string
  mapping_status: string
  production_repo: string | null
}
export interface ReleaseProof {
  github_sha_verified: boolean
  route_verified: boolean
  live_response_verified: boolean
  live_verified_at: string | null
  deployment_id_present: boolean
}
export interface ReleaseEntry {
  id: string
  site_id: string
  repository: string
  commit_sha: string
  environment: string
  event_kind: string
  provider: string
  event_at: string
  qa_status: string
  external_event_id?: string | null
  release_proof?: ReleaseProof
  affected_urls?: string[]
}
export interface RawReleaseEntry extends Omit<ReleaseEntry, 'release_proof' | 'affected_urls'> {
  evidence?: unknown
  affected_urls?: unknown
}
export type ReleaseLevel =
  | 'NO_LEDGER_EVENT'
  | 'COMMIT_ONLY'
  | 'PROVIDER_DEPLOY_ONLY'
  | 'LEDGER_CLAIM_INCOMPLETE'
  | 'PRODUCTION_EVIDENCE_COMPLETE'
export type MeasurementStatus =
  | 'PRODUCTION_NOT_VERIFIED'
  | 'URL_SCOPE_UNKNOWN'
  | 'WAITING_FINAL_GSC'
  | 'DATE_SCOPED_GSC_REQUIRED'
export interface MeasurementWindow {
  days: 7 | 14 | 28
  baseline_start: string | null
  baseline_end: string | null
  after_start: string | null
  after_end: string | null
  eligible_after: string | null
  status: MeasurementStatus
  uplift_measured: false
}
export interface SiteReleaseGate {
  site_id: string
  label: string
  level: ReleaseLevel
  latest_event_kind: string | null
  latest_event_at: string | null
  latest_provider: string | null
  latest_sha: string | null
  provider_deploy_count: number
  commit_event_count: number
  confirmed_production_count: number
  missing_evidence: string[]
  verified_release_at: string | null
  confirmed_affected_urls: string[]
  measurement_windows: MeasurementWindow[]
  auto_merge_allowed: false
  auto_deploy_allowed: false
}
const SHA=/^[a-f0-9]{40}$/i
const validDate=(input:unknown):Date|null=>{
  if(typeof input!=='string')return null
  const ms=Date.parse(input)
  return Number.isFinite(ms)?new Date(ms):null
}
const gscPacificDate=(date:Date):string=>{
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',
  }).formatToParts(date)
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
const shiftDay=(day:string,delta:number):string=>{
  const time=Date.parse(day+'T00:00:00Z')
  return new Date(time+delta*86_400_000).toISOString().slice(0,10)
}
const exactUrl=(url:string,origin:string):boolean=>{
  try{
    const u=new URL(url),p=new URL(origin)
    return u.protocol==='https:'&&u.origin===p.origin&&!u.username&&!u.password&&
      !u.search&&!u.hash
  }catch{return false}
}
/** Never return a raw provider evidence JSON object to ChatGPT or the frontend. */
export function sanitizeRelease(
  row:RawReleaseEntry,site?:ReleaseSite,
):ReleaseEntry {
  const evidence=(row.evidence && typeof row.evidence==='object' &&
    !Array.isArray(row.evidence))?row.evidence as Record<string,unknown>:{}
  const liveAt=validDate(evidence.live_verified_at)
  const urls=(Array.isArray(row.affected_urls)?row.affected_urls:[])
    .filter((url):url is string=>typeof url==='string'&&
      url.length<=2048&&Boolean(site)&&exactUrl(url,site!.origin))
  return {
    id:row.id,site_id:row.site_id,repository:row.repository,
    commit_sha:row.commit_sha,environment:row.environment,
    event_kind:row.event_kind,provider:row.provider,
    event_at:row.event_at,qa_status:row.qa_status,
    external_event_id:row.external_event_id ?? null,
    release_proof:{
      github_sha_verified:evidence.github_sha_verified===true,
      route_verified:evidence.apex_route_verified===true ||
        evidence.domain_worker_mapping_verified===true,
      live_response_verified:evidence.live_response_verified===true,
      live_verified_at:liveAt?liveAt.toISOString():null,
      deployment_id_present:typeof row.external_event_id==='string'&&
        row.external_event_id.trim().length>0,
    },
    affected_urls:Array.from(new Set(urls)).slice(0,25),
  }
}
function hasVerifiedEvidence(
  event:ReleaseEntry,project:ReleaseProject|undefined,now:Date,
):boolean {
  if(!project||project.mapping_status!=='VERIFIED'||
    !project.production_repo||project.production_repo!==event.repository)return false
  if(event.event_kind!=='PRODUCTION_VERIFIED'||
     event.environment!=='PRODUCTION'||event.qa_status!=='PASS'||
     !SHA.test(event.commit_sha||'')||!validDate(event.event_at))return false
  const p=event.release_proof
  if(!p||!p.github_sha_verified||!p.route_verified||
    !p.live_response_verified||!p.deployment_id_present)return false
  const liveAt=validDate(p.live_verified_at)
  const released=validDate(event.event_at)
  if(!liveAt||!released)return false
  // The live response proof cannot predate the deploy event, or be in future.
  return liveAt.getTime()>=released.getTime() &&
    liveAt.getTime()<=now.getTime()
}
function timeline(
  verified:ReleaseEntry|undefined,scope:string[],now:Date,
):MeasurementWindow[] {
  return ([7,14,28] as const).map(days=>{
    if(!verified){
      return {days,baseline_start:null,baseline_end:null,after_start:null,
        after_end:null,eligible_after:null,
        status:'PRODUCTION_NOT_VERIFIED' as const,uplift_measured:false as const}
    }
    const day=gscPacificDate(new Date(verified.event_at))
    const baselineStart=shiftDay(day,-days)
    const baselineEnd=shiftDay(day,-1)
    const afterStart=shiftDay(day,1)
    const afterEnd=shiftDay(day,days)
    // Use Google's Pacific calendar. Wait three calendar days for finalized reporting.
    const eligible=shiftDay(day,days+3)
    const current=gscPacificDate(now)
    const status:MeasurementStatus=scope.length===0?'URL_SCOPE_UNKNOWN':
      current<eligible?'WAITING_FINAL_GSC':'DATE_SCOPED_GSC_REQUIRED'
    return {
      days,baseline_start:baselineStart,baseline_end:baselineEnd,
      after_start:afterStart,after_end:afterEnd,eligible_after:eligible,
      status,uplift_measured:false as const,
    }
  })
}
export function assessReleasePortfolio(
  sites:ReleaseSite[],projects:ReleaseProject[],events:ReleaseEntry[],
  now=new Date(),
):SiteReleaseGate[] {
  return sites.map(site=>{
    const relevant=events
      .filter(row=>row.site_id===site.id)
      .sort((a,b)=>(validDate(b.event_at)?.getTime()||0)-
                     (validDate(a.event_at)?.getTime()||0))
    const project=projects.find(row=>row.site_id===site.id)
    const deploys=relevant.filter(row=>row.event_kind==='DEPLOY_SUCCEEDED'&&
      row.environment==='PRODUCTION')
    const commits=relevant.filter(row=>row.event_kind==='COMMIT_OBSERVED')
    const claims=relevant.filter(row=>row.event_kind==='PRODUCTION_VERIFIED')
    const verified=claims.filter(row=>hasVerifiedEvidence(row,project,now))[0]
    const latest=relevant[0]
    let level:ReleaseLevel='NO_LEDGER_EVENT'
    if(commits.length)level='COMMIT_ONLY'
    if(deploys.length)level='PROVIDER_DEPLOY_ONLY'
    if(claims.length)level='LEDGER_CLAIM_INCOMPLETE'
    if(verified)level='PRODUCTION_EVIDENCE_COMPLETE'
    const missing:string[]=[]
    if(!project||project.mapping_status!=='VERIFIED')missing.push('VERIFY_REPO_AND_HOSTING_MAPPING')
    if(deploys.length===0 && !verified)missing.push('PROVIDER_PRODUCTION_DEPLOY_RECEIPT')
    if(!verified){
      const candidate=claims[0]??deploys[0]??latest
      if(!candidate||!SHA.test(candidate.commit_sha||''))
        missing.push('PRODUCTION_COMMIT_SHA_40_HEX')
      if(candidate?.qa_status!=='PASS')missing.push('POST_DEPLOY_QA_PASS')
      if(!candidate?.release_proof?.github_sha_verified)
        missing.push('GITHUB_SHA_HOSTING_CORRELATION')
      if(!candidate?.release_proof?.route_verified)
        missing.push('APEX_DOMAIN_HOSTING_ROUTE_PROOF')
      if(!candidate?.release_proof?.live_response_verified||
         !candidate?.release_proof?.live_verified_at)
        missing.push('LIVE_HTTP_RESPONSE_PROOF')
      if(!candidate?.release_proof?.deployment_id_present)
        missing.push('HOSTING_DEPLOYMENT_ID')
      missing.push('PRODUCTION_VERIFIED_LEDGER_EVENT')
    }
    const affected=verified?.affected_urls||[]
    if(verified && affected.length===0)missing.push('VERIFIED_AFFECTED_URL_SCOPE')
    return {
      site_id:site.id,label:site.label,level,
      latest_event_kind:latest?.event_kind??null,
      latest_event_at:latest?.event_at??null,
      latest_provider:latest?.provider??null,
      latest_sha:latest&&SHA.test(latest.commit_sha||'')?latest.commit_sha:null,
      provider_deploy_count:deploys.length,
      commit_event_count:commits.length,
      confirmed_production_count:relevant.filter(row=>hasVerifiedEvidence(row,project,now)).length,
      missing_evidence:missing,
      verified_release_at:verified?.event_at??null,
      confirmed_affected_urls:affected,
      measurement_windows:timeline(verified,affected,now),
      auto_merge_allowed:false,
      auto_deploy_allowed:false,
    }
  })
}
