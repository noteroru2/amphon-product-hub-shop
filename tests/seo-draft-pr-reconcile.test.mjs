import test from 'node:test'
import assert from 'node:assert/strict'
import {reconcileApprovedDraftPr} from '../scripts/seo-draft-pr-reconcile.mjs'
import {parseCli} from '../scripts/seo-draft-pr-executor.mjs'

const UUID='11111111-1111-4111-8111-111111111111'
const RECEIPT='711d5aba-710a-4db7-a1d9-d1df4558ec40'
const ACTOR='33333333-3333-4333-8333-333333333333'
const SHA='a'.repeat(40),BLOB='b'.repeat(40),COMMIT='c'.repeat(40)
const PATH='src/pages/notebook.astro'
const FIND='<h1>รับซื้อโน๊ตบุ๊ค</h1>'
const REPLACE='<h1>รับซื้อโน๊ตบุ๊คมือสอง</h1>'
const BRANCH='seo/owner-reviewed-'+UUID
const PR_URL='https://github.com/noteroru2/amphon.co.th/pull/18'
const REPO='noteroru2/amphon.co.th'
const now=new Date('2026-11-23T12:00:00Z')
const fixture=()=>({
 request:{
   id:UUID,site_id:'amphon',job_id:16,evidence_id:20,gsc_receipt_id:RECEIPT,
   requested_by:ACTOR,status:'APPROVED_FOR_DRAFT_PR',
   reviewed_by:'22222222-2222-4222-8222-222222222222',
   reviewed_at:'2026-11-23T10:00:00Z',
   target_page:'https://amphon.co.th/services/notebook',
   focus_query:'รับซื้อโน๊ตบุ๊ค',target_repository:REPO,
   target_branch:'release/cloudflare-production',expected_base_sha:SHA,
   requested_paths:[PATH],change_kind:'CONTENT',
   proposed_change:JSON.stringify({
     schema:'amphon.seo.literal-edits.v1',
     edits:[{path:PATH,expected_blob_sha:BLOB,find:FIND,replace:REPLACE}],
   }),
   request_fingerprint:'f'.repeat(64),
 },site:{id:'amphon',origin:'https://amphon.co.th',enabled:true},
 project:{site_id:'amphon',mapping_status:'VERIFIED',
   production_repo:REPO,production_branch:'release/cloudflare-production'},
 job:{id:16,site_id:'amphon',page:'https://amphon.co.th/services/notebook',
      focus_query:'รับซื้อโน๊ตบุ๊ค',status:'EVIDENCE_READY',evidence_id:20},
 evidence:{id:20,job_id:16,
   source_url:'https://amphon.co.th/services/notebook',source_at:'2026-11-22T00:00:00Z'},
 receipt:{id:RECEIPT,actor:ACTOR,site_id:'amphon',
   query_request:{page:'https://amphon.co.th/services/notebook',query:'รับซื้อโน๊ตบุ๊ค'},
   created_at:'2026-11-22T01:00:00Z'},
 keyword:{site_id:'amphon',keyword:'รับซื้อโน๊ตบุ๊ค',approval_status:'APPROVED',target_page:null},
 existingRun:null,
})
const make=(opts={},snapshot=fixture())=>{
 const calls=[]
 let recorded
 const store={
   async loadSnapshot(id){calls.push('loadSnapshot');assert.equal(id,UUID);return snapshot},
   async recordRun(data){calls.push('recordRun');recorded=data;if(opts.failRecord)throw Error('DB_UNAVAILABLE')},
 }
 const github={
   async getBranchHead(){calls.push('getBranchHead');return opts.movedBase?BLOB:SHA},
   async getBranchRef(){calls.push('getBranchRef');return opts.noBranch?null:COMMIT},
   async getCommitReview(){calls.push('getCommitReview');return {
     sha:COMMIT,parents:[{sha:opts.wrongParent?BLOB:SHA}],
     changedFiles:[{filename:opts.extraFile?'wrangler.toml':PATH,
       status:opts.renamed?'renamed':'modified'}],
   }},
   async getFile(_repo,path,commit) {
     calls.push('getFile:'+commit)
     if(path!==PATH)throw Error('UNEXPECTED_FILE')
     return commit===SHA
       ?{type:'file',size:80,blob_sha:opts.wrongBlob?COMMIT:BLOB,
          content:'<main>'+FIND+'</main>'}
       :{type:'file',size:90,blob_sha:COMMIT,
          content:opts.wrongContent?'<main>INJECTED</main>':'<main>'+REPLACE+'</main>'}
   },
   async getPullsForHead(){calls.push('getPullsForHead');return opts.noPull?[]:[
     {
       number:18,html_url:PR_URL,
       state:opts.closed?'closed':'open',
       draft:!opts.ready,
       merged_at:opts.merged?'2026-11-23T00:00:00Z':null,
       body:'Source Change Request: '+UUID+'\nBase Commit: '+SHA,
       head:{sha:opts.wrongHead?BLOB:COMMIT,ref:BRANCH,repo:{full_name:opts.otherRepo?'attacker/site':REPO}},
       base:{ref:'release/cloudflare-production',repo:{full_name:REPO}},
     }],
   },
   async createTree(){throw Error('GITHUB_MUTATION_FORBIDDEN')},
   async createCommit(){throw Error('GITHUB_MUTATION_FORBIDDEN')},
   async createBranch(){throw Error('GITHUB_MUTATION_FORBIDDEN')},
   async createDraftPr(){throw Error('GITHUB_MUTATION_FORBIDDEN')},
 }
 return {store,github,calls,getRecorded:()=>recorded}
}
test('dry-run can validate an existing Draft PR with no GitHub or Supabase write',async()=>{
 const mock=make()
 const r=await reconcileApprovedDraftPr(UUID,{...mock,dryRun:true,now})
 assert.equal(r.outcome,'RECONCILIATION_VALIDATED')
 assert.equal(r.performed_write,false)
 assert.equal(r.production_deployed,false)
 assert.equal(r.pr_url,PR_URL)
 assert.equal(mock.getRecorded(),undefined)
 assert.ok(mock.calls.includes('getFile:'+COMMIT))
})
test('explicit owner-controlled reconcile writes only the existing PR audit receipt',async()=>{
 const mock=make()
 const r=await reconcileApprovedDraftPr(UUID,{...mock,dryRun:false,now})
 assert.equal(r.outcome,'AUDIT_RECEIPT_RECOVERED')
 assert.equal(r.performed_write,true)
 const saved=mock.getRecorded()
 assert.equal(saved.pr_head_sha,COMMIT)
 assert.equal(saved.base_commit_sha,SHA)
 assert.deepEqual(saved.changed_paths,[PATH])
 assert.equal(saved.draft_branch,BRANCH)
 assert.equal(saved.pr_url,PR_URL)
 assert.match(saved.change_sha256,/^[a-f0-9]{64}$/)
 assert.deepEqual(mock.calls.filter(k=>k==='recordRun'),['recordRun'])
})
test('reconciliation verifies existing ledger record rather than blindly accepting it',async()=>{
 const base=make()
 await reconcileApprovedDraftPr(UUID,{...base,dryRun:false,now})
 const saved=base.getRecorded()
 const existing=fixture();existing.existingRun={...saved}
 const verify=make({},existing)
 const result=await reconcileApprovedDraftPr(UUID,{...verify,dryRun:false,now})
 assert.equal(result.outcome,'EXISTING_RECEIPT_VERIFIED')
 assert.equal(result.performed_write,false)
 assert.ok(!verify.calls.includes('recordRun'))
 const forged=fixture();forged.existingRun={...saved,pr_url:'https://github.com/attacker/site/pull/18'}
 const reject=make({},forged)
 await assert.rejects(()=>reconcileApprovedDraftPr(UUID,{...reject,dryRun:false,now}),
   /RECORDED_RECEIPT_MISMATCH/)
})
test('missing PR, moved base, altered parent or unapproved file content are rejected',async()=>{
 for(const option of [
   {noBranch:true},{noPull:true},{movedBase:true},
   {wrongParent:true},{extraFile:true},{renamed:true},
   {wrongBlob:true},{wrongContent:true},{closed:true},{ready:true},
   {merged:true},{wrongHead:true},{otherRepo:true},
 ]) {
   const mock=make(option)
   await assert.rejects(()=>reconcileApprovedDraftPr(UUID,{...mock,dryRun:false,now}),
     /SEO_DRAFT_PR_RECONCILE_|SEO_DRAFT_PR_/,
     JSON.stringify(option))
   assert.equal(mock.calls.includes('recordRun'),false,JSON.stringify(option))
 }
})
test('no Owner review, wrong URL, stale receipt, or candidate Repo can be reconciled',async()=>{
 for(const mutate of [
   data=>{data.request.status='REVIEW_REQUIRED'},
   data=>{data.request.reviewed_by=null},
   data=>{data.project.mapping_status='CANDIDATE'},
   data=>{data.receipt.created_at='2026-09-01T00:00:00Z'},
   data=>{data.evidence.source_url='https://evil.test/x'},
   data=>{data.keyword.approval_status='PROPOSED'},
 ]) {
   const data=fixture();mutate(data)
   const mock=make({},data)
   await assert.rejects(()=>reconcileApprovedDraftPr(UUID,{...mock,dryRun:false,now}))
   assert.equal(mock.calls.includes('recordRun'),false)
 }
})
test('if audit receipt insert fails, reconciliation remains non-destructive and rerunnable',async()=>{
 const failed=make({failRecord:true})
 await assert.rejects(()=>reconcileApprovedDraftPr(UUID,{...failed,dryRun:false,now}),/DB_UNAVAILABLE/)
 assert.equal(failed.calls.includes('recordRun'),true)
 const retry=make()
 const result=await reconcileApprovedDraftPr(UUID,{...retry,dryRun:false,now})
 assert.equal(result.outcome,'AUDIT_RECEIPT_RECOVERED')
})
test('CLI new reconcile mode defaults to read-only preview and keeps owner flag',()=>{
 const read=parseCli(['--request-id',UUID,'--reconcile'])
 assert.equal(read.reconcile,true)
 assert.equal(read.dryRun,true)
 assert.equal(read.authorized,false)
 assert.throws(()=>parseCli(['--request-id',UUID,'--reconcile','--execute']),
   /OWNER_EXECUTION_FLAG_REQUIRED/)
 const write=parseCli(['--request-id',UUID,'--reconcile','--execute','--owner-authorized'])
 assert.equal(write.reconcile,true)
 assert.equal(write.dryRun,false)
})
