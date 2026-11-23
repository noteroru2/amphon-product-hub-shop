/**
 * Pure validation for proposed SEO source changes. Data is treated as untrusted.
 * Nothing here can edit GitHub or deploy. Final owner approval is SQL-gated.
 */
export const SEO_SOURCE_KINDS=['META','CONTENT','INTERNAL_LINK','SCHEMA','TECHNICAL_SEO'] as const
export type SeoSourceKind=typeof SEO_SOURCE_KINDS[number]
const sha=/^[a-f0-9]{40}$/i
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const safeRepo=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const allowedFile=/^(?:src\/(?:pages|content|components|layouts)\/|(?:content|pages)\/)[A-Za-z0-9_./-]+\.(?:astro|md|mdx|tsx|jsx|html|css)$/
function requiredText(x:unknown,min:number,max:number,label:string) {
 if(typeof x!=='string'||x.trim().length<min||x.length>max)throw Error('SEO_SOURCE_INVALID_'+label)
 return x.trim()
}
export function safeSourcePath(path:unknown):path is string {
 if(typeof path!=='string'||path.length>220||!allowedFile.test(path))return false
 if(path.startsWith('/')||path.includes('\\')||path.includes('//'))return false
 const parts=path.split('/')
 return !parts.some(p=>p==='.'||p==='..'||p.startsWith('.')||p.startsWith('-'))
}
export function validateSourceProposalInput(data:Record<string,unknown>) {
 const allowed=['job_id','evidence_id','gsc_receipt_id','expected_base_sha',
   'target_paths','change_kind','summary','rationale','proposed_change']
 if(Object.keys(data).some(k=>!allowed.includes(k)))throw Error('SEO_SOURCE_UNDECLARED_ARGUMENT')
 const jobId=data.job_id,evidenceId=data.evidence_id
 if(!Number.isSafeInteger(jobId)||Number(jobId)<=0 || !Number.isSafeInteger(evidenceId)||Number(evidenceId)<=0)
  throw Error('SEO_SOURCE_INVALID_JOB_OR_EVIDENCE')
 const receipt=requiredText(data.gsc_receipt_id,36,36,'RECEIPT')
 if(!uuid.test(receipt))throw Error('SEO_SOURCE_INVALID_RECEIPT')
 const base=requiredText(data.expected_base_sha,40,40,'BASE_SHA').toLowerCase()
 if(!sha.test(base))throw Error('SEO_SOURCE_INVALID_BASE_SHA')
 if(!Array.isArray(data.target_paths)||data.target_paths.length<1||data.target_paths.length>8||
    !data.target_paths.every(safeSourcePath)||new Set(data.target_paths).size!==data.target_paths.length)
   throw Error('SEO_SOURCE_UNSAFE_TARGET_PATH')
 const kind=requiredText(data.change_kind,4,20,'CHANGE_KIND') as SeoSourceKind
 if(!SEO_SOURCE_KINDS.includes(kind))throw Error('SEO_SOURCE_INVALID_CHANGE_KIND')
 return {
  jobId:Number(jobId),evidenceId:Number(evidenceId),receiptId:receipt.toLowerCase(),
  expectedBaseSha:base,targetPaths:[...data.target_paths] as string[],
  changeKind:kind,
  summary:requiredText(data.summary,30,1200,'SUMMARY'),
  rationale:requiredText(data.rationale,30,3000,'RATIONALE'),
  proposedChange:requiredText(data.proposed_change,30,12000,'PROPOSED_CHANGE'),
 }
}
const normalizeUrl=(input:string)=>{try {
 const u=new URL(input)
 return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash?u.href.replace(/\/$/,''):null
} catch{return null}}
const ms=(date:string)=>Date.parse(date)
const withinDays=(date:string,now:Date,days:number)=>{
 const v=ms(date),age=now.getTime()-v
 return Number.isFinite(v)&&age>=-86_400_000&&age<=days*86_400_000
}
export function assertSourceProposalEvidence(input:{
 site:{id:string,origin:string,enabled:boolean},
 project:{site_id:string,mapping_status:string,production_repo:string|null,production_branch:string|null},
 job:{id:number,site_id:string,page:string,focus_query:string,status:string,evidence_id:number|null},
 evidence:{id:number,job_id:number,source_url:string,source_at:string},
 receipt:{id:string,actor:string,site_id:string,query_request:Record<string,unknown>,created_at:string},
 keyword:{site_id:string,keyword:string,approval_status:string,target_page:string|null},
 actor:string,jobId:number,evidenceId:number
},now=new Date()) {
 const {site,project,job,evidence,receipt,keyword,actor,jobId,evidenceId}=input
 if(!site.enabled||job.site_id!==site.id||project.site_id!==site.id)throw Error('SEO_SOURCE_SITE_DISABLED')
 if(project.mapping_status!=='VERIFIED'||!project.production_repo||!safeRepo.test(project.production_repo)||
   !project.production_branch||!/^[A-Za-z0-9._/-]{1,120}$/.test(project.production_branch))
  throw Error('SEO_SOURCE_REPO_NOT_VERIFIED')
 if(job.id!==jobId||job.status==='DISMISSED')throw Error('SEO_SOURCE_JOB_NOT_ELIGIBLE')
 const page=normalizeUrl(job.page),origin=normalizeUrl(site.origin),evidenceUrl=normalizeUrl(evidence.source_url)
 if(!page||!origin||new URL(page).origin!==new URL(origin).origin||evidenceUrl!==page)
  throw Error('SEO_SOURCE_PAGE_MISMATCH')
 if(job.evidence_id!==evidence.id||evidence.id!==evidenceId||evidence.job_id!==job.id||
    !withinDays(evidence.source_at,now,30))throw Error('SEO_SOURCE_PAGE_EVIDENCE_STALE')
 if(keyword.site_id!==site.id||keyword.keyword!==job.focus_query||
    keyword.approval_status!=='APPROVED'||
    (keyword.target_page!==null&&normalizeUrl(keyword.target_page)!==page))
   throw Error('SEO_SOURCE_KEYWORD_NOT_APPROVED')
 if(receipt.site_id!==site.id||receipt.actor!==actor||!withinDays(receipt.created_at,now,7)||
    receipt.query_request.page!==job.page||receipt.query_request.query!==job.focus_query)
   throw Error('SEO_SOURCE_GSC_RECEIPT_MISMATCH')
 return {
  siteId:site.id,page:job.page,focusQuery:job.focus_query,
  repository:project.production_repo,branch:project.production_branch,
  safety:{
    can_prepare_source_request:true,
    can_create_or_edit_github:false,
    base_commit_verified_with_github:false,
    can_merge_or_deploy:false,
  }
 }
}
