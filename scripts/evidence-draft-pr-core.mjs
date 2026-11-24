/** Evidence-specific Draft PR policy. Never copies or exposes private images.
 * Each queue ID handles exactly ONE site+page. A protected workflow can run a
 * batch of IDs, creating individual, separately reviewed Draft PRs.
 */
import {createHash} from 'node:crypto'
function allowedInternationalContentPath(path) {
 if(typeof path!=='string'||path.length>220||path.includes('\\')||path.includes('//')||path!==path.normalize('NFC'))return false
 if(!/^(?:src\/(?:pages|content|components|layouts)\/|(?:content|pages)\/)/.test(path))return false
 if(!/\.(?:md|mdx|astro)$/.test(path))return false
 if(!/^[\p{L}\p{M}\p{N}_.\/-]+$/u.test(path))return false
 return path.split('/').every(x=>x.length>0&&x!=='.'&&x!=='..'&&!x.startsWith('.')&&!x.startsWith('-'))
}

import {assertPublicationEligible} from '../src/lib/evidencePublisherPolicy.ts'
const UUID=/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const SHA=/^[a-f0-9]{40}$/i
const fail=x=>{throw Error('EVIDENCE_PR_'+x)}
export const draftBranch=id=>{
 if(!UUID.test(id||''))fail('REQUEST_ID_INVALID')
 return 'seo/evidence-owner-reviewed-'+id.toLowerCase()
}
export function safeCaseText(evidence,claim) {
 const fields=['title','brand','model','specs_text','condition_text','city']
 const values=Object.fromEntries(fields.map(key=>{
   const value=evidence[key]
   if(value===null||value===undefined)return [key,'']
   if(typeof value!=='string')fail('COPY_FIELD_INVALID')
   const cleaned=value.trim()
   if(cleaned.length>600 || /[<>\0]|https?:\/\/|\b\S+@\S+\.\S+\b|(?:\+66|0[689])[\d -]{8,13}|\b\d{13}\b/i.test(cleaned))
     fail('COPY_REQUIRES_PRIVACY_REVIEW')
   if(/[\r\n]/.test(cleaned)||/^[-#>*]/.test(cleaned))fail('COPY_MARKDOWN_UNSAFE')
   return [key,cleaned]
 }))
 if(values.title.length<3)fail('TITLE_REQUIRED')
 const heading=claim==='ASSESSMENT_ONLY'?'ตัวอย่างข้อมูลการประเมินเบื้องต้น':'ตัวอย่างรายการตรวจเครื่องที่ยืนยันธุรกรรมแล้ว'
 const intro=claim==='ASSESSMENT_ONLY'
   ?'ข้อมูลนี้เป็นกรณีขอประเมินเบื้องต้น ไม่ใช่การยืนยันว่ารับซื้อหรือชำระเงินสำเร็จ ราคาสุดท้ายต้องตรวจสภาพจริงก่อนตกลง'
   :'เป็นรายการที่เจ้าของร้านยืนยันการทำธุรกรรมแล้ว ข้อมูลส่วนบุคคลและต้นทุนถูกซ่อน'
 return [
  '### '+heading+': '+values.title,
  '',
  values.brand||values.model?'รุ่น: '+[values.brand,values.model].filter(Boolean).join(' ') :'',
  values.specs_text?'สเปกที่ได้รับแจ้ง: '+values.specs_text:'',
  values.condition_text?'สภาพที่ได้รับแจ้ง: '+values.condition_text:'',
  values.city?'พื้นที่ที่ลูกค้าแจ้ง: '+values.city:'',
  intro,
  '',
  'สอบถามการประเมินทาง LINE [@webuy](https://line.me/ti/p/~@webuy)',
  '',
 ].filter((v,i,arr)=>v!==''||i===1||i===arr.length-1).join('\n')+'\n'
}
export function inspectSnapshot(s) {
 const {request:r,evidence:e,image,site,project,mapping,requester}=s
 if(!r||!UUID.test(r.id||'')||r.status!=='PENDING_SOURCE_PR')fail('QUEUE_NOT_APPROVED')
 if(!requester||requester.id!==r.requested_by||requester.role!=='owner'||requester.active!==true)fail('OWNER_NOT_ACTIVE')
 if(!e||e.id!==r.evidence_id||!image||image.id!==r.image_id)fail('EVIDENCE_CHANGED')
 const {claim_kind}=assertPublicationEligible(e,image,r.evidence_id)
 if(claim_kind!==r.claim_kind)fail('TRANSACTION_STATE_CHANGED')
 if(!site?.enabled||site.id!==r.site_id||project?.site_id!==r.site_id||
   project.mapping_status!=='VERIFIED'||project.central_deploy_allowed!==false||
   !/^[\w.-]+\/[\w.-]+$/.test(project.production_repo||'')||
   !/^[\w./-]{1,120}$/.test(project.production_branch||'')||
   !project.production_branch||project.production_branch.includes('..'))fail('REPO_NOT_VERIFIED')
 if(!mapping?.enabled||mapping.site_id!==site.id||mapping.page_path!==r.page_path||
   !UUID.test(mapping.reviewed_by||'')||!mapping.reviewed_at)fail('PAGE_MAPPING_NOT_REVIEWED')
 const date=Date.parse(mapping.reviewed_at)
 if(!Number.isFinite(date))fail('PAGE_MAPPING_REVIEW_INVALID')
 if(!allowedInternationalContentPath(mapping.source_path)||!/\.(md|mdx|astro)$/.test(mapping.source_path))
   fail('SOURCE_FILE_NOT_ALLOWED')
 if(typeof mapping.insert_before!=='string'||mapping.insert_before.length<10||
    mapping.insert_before.length>300||/\0/.test(mapping.insert_before))fail('INSERT_ANCHOR_INVALID')
 if(typeof r.page_path!=='string'||!r.page_path.startsWith('/')||r.page_path.startsWith('//')||
    /[?#\\\s<>]/.test(r.page_path)||r.page_path.split('/').some(x=>x==='.'||x==='..'))fail('PAGE_PATH_INVALID')
 if(!/^evidence\/[\da-f-]{36}\/[\da-f-]{36}\.webp$/i.test(r.private_media_key||''))
   fail('STAGED_IMAGE_INVALID')
 if(typeof site.origin!=='string'||!site.origin.startsWith('https://'))fail('SITE_ORIGIN_INVALID')
 if(!SHA.test(s.expected_base_sha||''))fail('EXPECTED_BASE_SHA_REQUIRED')
 return {repo:project.production_repo,base:project.production_branch,
   sourcePath:mapping.source_path,anchor:mapping.insert_before,claim:claim_kind,
   draftText:safeCaseText(e,claim_kind)}
}
export function applyCase(source,anchor,id,text) {
 if(typeof source!=='string'||source.length>250000||source.includes('\0'))fail('SOURCE_INVALID')
 if(source.indexOf(anchor)<0||source.indexOf(anchor,source.indexOf(anchor)+anchor.length)!==-1)
   fail('ANCHOR_NOT_UNIQUE')
 // Reject duplicates even if another branch or request attempts to reuse evidence.
 const marker='<!-- AMPHON_EVIDENCE_CASE:'+id+' -->'
 if(source.includes(marker))fail('CASE_ALREADY_PRESENT')
 const at=source.indexOf(anchor)
 const firstFront=source.startsWith('---\n')?source.indexOf('\n---\n',4):-1
 if(firstFront!==-1&&at<=firstFront+5)fail('FRONTMATTER_ANCHOR_INVALID')
 return source.slice(0,at)+'\n'+marker+'\n'+text+'\n'+source.slice(at)
}
export async function executeEvidenceDraftPr(id,{store,github,dryRun=true}) {
 if(!UUID.test(id||''))fail('REQUEST_ID_INVALID')
 const snap=await store.loadSnapshot(id)
 if(snap.request?.status==='DRAFT_PR_OPEN'&&snap.request?.draft_pr_url)
   return {outcome:'ALREADY_RECORDED',pr_url:snap.request.draft_pr_url,performed_write:false}
 const cfg=inspectSnapshot(snap)
 const head=await github.getBranchHead(cfg.repo,cfg.base)
 if(!SHA.test(head||'')||head.toLowerCase()!==snap.expected_base_sha.toLowerCase())
   fail('BASE_MOVED_REVIEW_REQUIRED')
 const name=draftBranch(id)
 if(await github.getBranchRef(cfg.repo,name))fail('EXISTING_BRANCH_RECONCILE_REQUIRED')
 const overlapping=await github.getOverlappingOpenPrs(cfg.repo,cfg.sourcePath)
 if(!Array.isArray(overlapping)||overlapping.length)fail('OVERLAPPING_OPEN_PR_REQUIRES_REVIEW')
 const file=await github.getFile(cfg.repo,cfg.sourcePath,head)
 if(!file||file.type!=='file'||file.size>250000||!SHA.test(file.blob_sha||''))
   fail('SOURCE_MISSING')
 const next=applyCase(file.content,cfg.anchor,id,cfg.draftText)
 const digest=createHash('sha256').update(next).digest('hex')
 const summary={outcome:'DRY_RUN_VALIDATED',request_id:id,site_id:snap.request.site_id,
   repository:cfg.repo,base_branch:cfg.base,base_sha:head,
   source_path:cfg.sourcePath,content_sha256:digest,media_public:false,
   production_deploy_authorized:false,performed_write:false}
 if(dryRun)return summary
 const tree=await github.getCommitTree(cfg.repo,head)
 if(!SHA.test(tree||''))fail('BASE_TREE_INVALID')
 const newTree=await github.createTree(cfg.repo,tree,[{path:cfg.sourcePath,content:next}])
 const commit=await github.createCommit(cfg.repo,newTree,head,'seo(evidence): reviewed text-only case '+id)
 if(await github.getBranchHead(cfg.repo,cfg.base)!==head)fail('BASE_MOVED_DURING_CREATE')
 await github.createBranch(cfg.repo,name,commit)
 const pull=await github.createDraftPr(cfg.repo,{
   head:name,base:cfg.base,draft:true,
   title:'[DRAFT][NO DEPLOY] Reviewed evidence case '+id.slice(0,8),
   body:'## AMPHON Evidence Publisher — text-only Draft PR\n\n'+
     'Evidence request: '+id+'\nTarget: '+snap.site.origin+snap.request.page_path+
     '\nClaim: '+cfg.claim+'\n\nNo private/public image URL is included. '+
     'Image publication, site Merge and Deploy each require separate owner approval.\n'+
     'Review content accuracy, page H1/title/canonical, schema, links and CI before release.'
 })
 if(!pull?.draft||!Number.isInteger(pull.number)||!pull.url?.startsWith('https://github.com/'+cfg.repo+'/pull/'))
   fail('PR_RECEIPT_INVALID')
 // If receipt recording fails, the branch remains; retry cannot duplicate it.
 await store.recordDraft(id,pull,commit,head,cfg)
 return {...summary,outcome:'DRAFT_PR_CREATED',performed_write:true,pr_url:pull.url,pr_number:pull.number,draft_sha:commit}
}
