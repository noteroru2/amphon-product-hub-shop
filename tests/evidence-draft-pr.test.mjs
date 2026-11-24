import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {executeEvidenceDraftPr,inspectSnapshot,applyCase,safeCaseText,draftBranch} from '../scripts/evidence-draft-pr-core.mjs'
import {parseArgs} from '../scripts/evidence-draft-pr.mjs'
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const EVIDENCE='dd8cbc49-1caf-477c-b579-955007517b61'
const IMAGE='8ebfb3f2-1d13-404f-9cfa-93ef40672f16'
const OWNER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SHA='a'.repeat(40),TREE='b'.repeat(40),NEW='c'.repeat(40)
const ANCHOR='## ส่งรูปเช็กราคาโน๊ตบุ๊คก่อนตัดสินใจ'
const SOURCE='---\ntitle: "รับซื้อโน๊ตบุ๊ค"\nh1: "รับซื้อโน๊ตบุ๊ค"\nslug: "รับซื้อโน๊ตบุ๊ค"\n---\n\n# รับซื้อโน๊ตบุ๊ค\n\n'+ANCHOR+'\n\nLINE @webuy\n'
function snapshot(site='amphon') {
 return {request:{id:ID,evidence_id:EVIDENCE,image_id:IMAGE,site_id:site,page_path:'/บริการ/รับซื้อโน๊ตบุ๊ค',
  claim_kind:'ASSESSMENT_ONLY',status:'PENDING_SOURCE_PR',requested_by:OWNER,
  private_media_key:'evidence/'+EVIDENCE+'/'+IMAGE+'.webp'},
  evidence:{id:EVIDENCE,kind:'purchase',status:'APPROVED',approved_at:'2026-11-24T12:59:11Z',
    permission_confirmed:true,privacy_reviewed:true,transaction_verified:false,
    title:'Lenovo IdeaPad Gaming',brand:'Lenovo',model:'IdeaPad Gaming',
    specs_text:'i5 Gen 10 / GTX 1650 / RAM 8GB / SSD 512GB',
    condition_text:'มีตำหนิจากการใช้งาน',city:'ชลบุรี'},
  image:{id:IMAGE,evidence_id:EVIDENCE,approved_for_public:true,storage_path:EVIDENCE+'/'+IMAGE+'.jpg'},
  site:{id:site,origin:site==='amphon'?'https://amphon.co.th':'https://winnerit.in.th',enabled:true},
  project:{site_id:site,production_repo:site==='amphon'?'noteroru2/amphon.co.th':'noteroru2/new-winnerit',
    production_branch:site==='amphon'?'release/cloudflare-production':'main',
    mapping_status:'VERIFIED',central_deploy_allowed:false},
  mapping:{site_id:site,page_path:'/บริการ/รับซื้อโน๊ตบุ๊ค',
    source_path:'src/content/services/รับซื้อโน๊ตบุ๊ค.md',
    insert_before:ANCHOR,reviewed_by:OWNER,reviewed_at:'2026-11-24T13:00:00Z',
    enabled:true,expected_base_sha:SHA},
  requester:{id:OWNER,role:'owner',active:true},
  expected_base_sha:SHA}
}
function harness(s=snapshot(),opts={}) {
 const calls=[]
 const store={async loadSnapshot(id){calls.push('load');assert.equal(id,ID);return s},
   async recordDraft(){calls.push('record')}}
 const github={
   async getBranchHead(){calls.push('head');return opts.moved?'f'.repeat(40):SHA},
   async getBranchRef(){calls.push('ref');return opts.existingBranch?NEW:null},
   async getFile(){calls.push('file');return {type:'file',size:SOURCE.length,
     blob_sha:'d'.repeat(40),content:opts.duplicate?SOURCE.replace(ANCHOR,'<!-- AMPHON_EVIDENCE_CASE:'+ID+' -->\n'+ANCHOR):SOURCE}},
   async getCommitTree(){calls.push('tree');return TREE},
   async createTree(repo,base,items){calls.push('create-tree');assert.equal(items.length,1);
      assert.match(items[0].content,/ASSESSMENT_ONLY|การประเมินเบื้องต้น/);
      assert.doesNotMatch(items[0].content,/private_media_key|\.webp|Signed URL/);return TREE},
   async createCommit(){calls.push('create-commit');return NEW},
   async createBranch(){calls.push('create-branch')},
   async createDraftPr(repo,body){calls.push('create-pr');assert.equal(body.draft,true);
      assert.equal(body.base,s.project.production_branch);return {draft:true,number:83,url:'https://github.com/'+repo+'/pull/83'}}
 }
 return {store,github,calls}
}
test('Lenovo Job #22: only approved private evidence, no false purchase claim',()=>{
 const s=snapshot()
 const result=inspectSnapshot(s)
 assert.equal(result.base,'release/cloudflare-production')
 assert.equal(result.claim,'ASSESSMENT_ONLY')
 assert.match(result.draftText,/ประเมินเบื้องต้น/)
 assert.doesNotMatch(result.draftText,/รับซื้อเข้าเรียบร้อย|\\.webp|trade-evidence-private/)
 const next=applyCase(SOURCE,ANCHOR,ID,result.draftText)
 assert.ok(next.startsWith(SOURCE.slice(0,SOURCE.indexOf(ANCHOR))))
 assert.match(next,/AMPHON_EVIDENCE_CASE/)
 assert.ok(next.includes('LINE @webuy'))
 assert.equal(next.split(ANCHOR).length,2)
})
test('two verified sites yield independent site-specific drafts without leaking private images',async()=>{
 for(const site of ['amphon','winner']){
  const s=snapshot(site),h=harness(s)
  const r=await executeEvidenceDraftPr(ID,{...h,dryRun:false})
  assert.equal(r.outcome,'DRAFT_PR_CREATED')
  assert.equal(r.repository,s.project.production_repo)
  assert.equal(r.production_deploy_authorized,false)
  assert.equal(r.media_public,false)
  assert.deepEqual(h.calls,['load','head','ref','file','tree','create-tree','create-commit','head','create-branch','create-pr','record'])
 }
})
test('dry-run touches no GitHub mutation or DB mutation',async()=>{
 const h=harness()
 const r=await executeEvidenceDraftPr(ID,{...h,dryRun:true})
 assert.equal(r.outcome,'DRY_RUN_VALIDATED')
 assert.deepEqual(h.calls,['load','head','ref','file'])
})
test('fail closed on missing image, owner approval, mapping, site, and unauthorized transaction changes',async()=>{
 for(const fn of [
  s=>{s.evidence.status='DRAFT'},
  s=>{s.evidence.privacy_reviewed=false},
  s=>{s.image.approved_for_public=false},
  s=>{s.requester.role='admin'},
  s=>{s.project.mapping_status='CANDIDATE'},
  s=>{s.project.central_deploy_allowed=true},
  s=>{s.mapping.enabled=false},
  s=>{s.mapping.reviewed_by=null},
  s=>{s.mapping.source_path='.github/workflows/deploy.yml'},
  s=>{s.mapping.insert_before='short'},
  s=>{s.request.claim_kind='VERIFIED_TRANSACTION'},
  s=>{s.request.private_media_key='https://public.example/secret'},
  s=>{s.mapping.page_path='/other'},
 ]) {
   const s=snapshot();fn(s);const h=harness(s)
   await assert.rejects(()=>executeEvidenceDraftPr(ID,{...h,dryRun:false}))
   assert.equal(h.calls.includes('create-pr'),false)
 }
})
test('moving base SHA or existing branch or duplicated evidence marker aborts before PR',async()=>{
 for(const config of [{moved:true},{existingBranch:true},{duplicate:true}]){
  const h=harness(snapshot(),config)
  await assert.rejects(()=>executeEvidenceDraftPr(ID,{...h,dryRun:false}))
  assert.equal(h.calls.includes('create-pr'),false)
 }
})
test('PII/markup not allowed even in owner-approved text; no arbitrary instructions into public PR',()=>{
 for(const text of ['โทร 0891234567','abc@example.com','เลขบัตร 1234567890123',
   '<img src=x>','https://example.com/','\n## Injected content'])
   assert.throws(()=>safeCaseText({...snapshot().evidence,condition_text:text},'ASSESSMENT_ONLY'))
 assert.throws(()=>applyCase(SOURCE.replace(ANCHOR,'<!-- AMPHON_EVIDENCE_CASE:'+ID+' -->\\n'+ANCHOR),ANCHOR,ID,'safe text'))
})
test('existing PR receipt is idempotent',async()=>{
 const s=snapshot();s.request.status='DRAFT_PR_OPEN';s.request.draft_pr_url='https://github.com/noteroru2/amphon.co.th/pull/82'
 const h=harness(s);const r=await executeEvidenceDraftPr(ID,{...h,dryRun:false})
 assert.equal(r.outcome,'ALREADY_RECORDED')
 assert.deepEqual(h.calls,['load'])
})
test('separate owner authorization flag mandatory; deployment flags forbidden',()=>{
 assert.equal(parseArgs(['--request-id',ID]).dryRun,true)
 assert.throws(()=>parseArgs(['--request-id',ID,'--execute']))
 assert.throws(()=>parseArgs(['--request-id',ID,'--deploy']))
 assert.equal(parseArgs(['--request-id',ID,'--execute','--owner-authorized']).dryRun,false)
})
test('private-only image stage has no public GET or media URLs; SQL RLS never exposes queue',()=>{
 const worker=readFileSync(new URL('../workers/evidence-publisher/index.mjs',import.meta.url),'utf8')
 const sql=readFileSync(new URL('../supabase/migrations/20261124_evidence_publisher.sql',import.meta.url),'utf8')
 const workflow=readFileSync(new URL('../.github/workflows/evidence-draft-pr-execute.yml',import.meta.url),'utf8')
 assert.match(worker,/STAGED_IMAGES/)
 assert.match(worker,/\/api\/stage/)
 assert.doesNotMatch(worker,/\/media\/evidence|public_media_url|response.*\.webp|env\.ASSETS\.get\(/)
 assert.match(sql,/enable row level security/i)
 assert.match(sql,/revoke all on public.commerce_evidence_publication_requests from PUBLIC, anon, authenticated/i)
 assert.doesNotMatch(sql,/public_media_url/)
 assert.match(workflow,/environment: evidence-draft-pr-protected/)
 assert.match(workflow,/actions\/create-github-app-token@v2/)
 assert.match(workflow,/permission-pull-requests: write/)
 assert.ok(!/wrangler deploy|gh pr merge|schedule:|push:|pull_request_target:/.test(workflow))
})
