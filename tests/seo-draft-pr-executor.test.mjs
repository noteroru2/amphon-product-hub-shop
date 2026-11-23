import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  executeApprovedDraftPr,validateApprovedPatch,verifyApprovedSourceSnapshot,
  literalReplace,deterministicBranch,isAllowedContentPath,
} from '../scripts/seo-draft-pr-executor-core.mjs'
import {parseCli} from '../scripts/seo-draft-pr-executor.mjs'
import {resolveApprovedTarget} from '../scripts/seo-draft-pr-target.mjs'

const NOW=new Date('2026-11-23T12:00:00Z')
const UUID='11111111-1111-4111-8111-111111111111'
const RECEIPT='711d5aba-710a-4db7-a1d9-d1df4558ec40'
const SHA='a'.repeat(40),BLOB='b'.repeat(40),TREE='c'.repeat(40),COMMIT='d'.repeat(40)
const PATH='src/pages/notebook.astro',FIND='<h1>รับซื้อโน๊ตบุ๊ค</h1>',REPLACE='<h1>รับซื้อโน๊ตบุ๊คมือสอง</h1>'
const EDITS=()=>({schema:'amphon.seo.literal-edits.v1',edits:[{
  path:PATH,expected_blob_sha:BLOB,find:FIND,replace:REPLACE
}]})
const fixture=()=>({
  request:{
    id:UUID,site_id:'amphon',job_id:16,evidence_id:20,gsc_receipt_id:RECEIPT,
    requested_by:'33333333-3333-4333-8333-333333333333',
    status:'APPROVED_FOR_DRAFT_PR',reviewed_by:'22222222-2222-4222-8222-222222222222',
    reviewed_at:'2026-11-23T10:00:00Z',target_page:'https://amphon.co.th/services/notebook',
    focus_query:'รับซื้อโน๊ตบุ๊ค',target_repository:'noteroru2/amphon.co.th',
    target_branch:'release/cloudflare-production',expected_base_sha:SHA,requested_paths:[PATH],
    proposed_change:JSON.stringify(EDITS()),change_kind:'CONTENT',
    summary:'Explain actual notebook condition-checking and improve user value',
    rationale:'The old heading lacks relevant device-condition service detail',
    request_fingerprint:'f'.repeat(64),
  },
  site:{id:'amphon',enabled:true,origin:'https://amphon.co.th'},
  project:{
    site_id:'amphon',mapping_status:'VERIFIED',production_repo:'noteroru2/amphon.co.th',
    production_branch:'release/cloudflare-production',
  },
  job:{id:16,site_id:'amphon',page:'https://amphon.co.th/services/notebook',
       focus_query:'รับซื้อโน๊ตบุ๊ค',evidence_id:20,status:'EVIDENCE_READY'},
  evidence:{id:20,job_id:16,source_url:'https://amphon.co.th/services/notebook',
            source_at:'2026-11-22T00:00:00Z'},
  receipt:{id:RECEIPT,actor:'33333333-3333-4333-8333-333333333333',
           site_id:'amphon',query_request:{page:'https://amphon.co.th/services/notebook',query:'รับซื้อโน๊ตบุ๊ค'},
           created_at:'2026-11-22T01:00:00Z'},
  keyword:{site_id:'amphon',keyword:'รับซื้อโน๊ตบุ๊ค',approval_status:'APPROVED',target_page:null},
  existingRun:null,
})
const harness=(data=fixture(),config={})=>{
  const calls=[]
  let headChecks=0
  const github={
    async getBranchHead(){calls.push('head');return ++headChecks===2&&config.moveHead?COMMIT:SHA},
    async getBranchRef(){calls.push('ref');return config.branchExists?SHA:null},
    async getFile(){calls.push('file');return {
      type:'file',size:72,blob_sha:config.badBlob?COMMIT:BLOB,
      content:config.ambiguous?FIND+'\n'+FIND:'<main>'+FIND+'</main>',
    }},
    async getCommitTree(){calls.push('get-tree');return TREE},
    async createTree(){calls.push('create-tree');return TREE},
    async createCommit(){calls.push('create-commit');return COMMIT},
    async createBranch(){calls.push('create-branch')},
    async createDraftPr(_repo,pr){calls.push('draft-pr');assert.equal(pr.draft,true);
      assert.equal(pr.base,'release/cloudflare-production');
      assert.ok(pr.body.includes('Source Change Request: '+UUID))
      return {draft:true,number:18,url:'https://github.com/noteroru2/amphon.co.th/pull/18'}},
  }
  const store={
    async loadSnapshot(){calls.push('snapshot');return data},
    async recordRun(record){calls.push('record');assert.equal(record.changed_paths[0],PATH);
      assert.equal(record.pr_head_sha,COMMIT)},
  }
  return {store,github,calls}
}
async function run(data=fixture(),options={},dryRun=true) {
  const h=harness(data,options)
  const result=await executeApprovedDraftPr(UUID,{store:h.store,github:h.github,dryRun,now:NOW})
  return {result,calls:h.calls}
}

test('valid owner-approved structured literal patch only, strict safe paths',()=>{
  assert.equal(validateApprovedPatch(fixture().request).length,1)
  assert.equal(deterministicBranch(UUID),'seo/owner-reviewed-'+UUID)
  assert.equal(literalReplace(FIND+'!',EDITS().edits[0]),REPLACE+'!')
  for(const name of [
    '.github/workflows/deploy.yml','src/pages/../../.env',
    'src/pages/.secrets.md','src/pages/notebook.tsx','src/components/widget.jsx',
    'src/pages/../foo.md','scripts/seo.js','public/index.html','src/pages/foo.js',
    'src/pages/x//y.astro','../package.json','wrangler.jsonc',
  ])assert.equal(isAllowedContentPath(name),false,name)
  assert.throws(()=>literalReplace(FIND+FIND,EDITS().edits[0]),/NOT_EXACTLY_ONE_MATCH/)
})
test('unstructured instructions, unexpected fields and unapproved files never run',()=>{
  const data=fixture()
  data.request.proposed_change='Please improve this page'
  assert.throws(()=>validateApprovedPatch(data.request),/STRUCTURED_PATCH_REQUIRED/)
  data.request.proposed_change=JSON.stringify({...EDITS(),command:'deploy'})
  assert.throws(()=>validateApprovedPatch(data.request),/STRUCTURED_PATCH_REQUIRED/)
  data.request.proposed_change=JSON.stringify({...EDITS(),edits:[{...EDITS().edits[0],path:'src/pages/other.astro'}]})
  assert.throws(()=>validateApprovedPatch(data.request),/PATH_SET_MISMATCH/)
  data.request.proposed_change=JSON.stringify({...EDITS(),edits:[{...EDITS().edits[0],expected_blob_sha:SHA}]})
  assert.equal(validateApprovedPatch(data.request).length,1)
})
test('dry-run validates owner and all GitHub evidence but performs no writes',async()=>{
  const {result,calls}=await run()
  assert.equal(result.outcome,'DRY_RUN_VALIDATED')
  assert.equal(result.production_deploy_authorized,false)
  assert.equal(result.performed_write,false)
  assert.ok(calls.includes('file'))
  assert.ok(!calls.some(x=>x==='record'||x==='create-tree'||x==='create-branch'||x==='draft-pr'))
})
test('actual permitted action is an atomic changed-file commit plus DRAFT PR only',async()=>{
  const {result,calls}=await run(fixture(),{},false)
  assert.equal(result.outcome,'DRAFT_PR_CREATED')
  assert.equal(result.pr_number,18)
  assert.equal(result.production_deploy_authorized,false)
  assert.deepEqual(calls,[
    'snapshot','head','ref','file','get-tree','create-tree','create-commit',
    'head','create-branch','draft-pr','record',
  ])
})
test('owner approval and reviewed timestamp required; cannot bypass with candidate repo',async()=>{
  for(const change of [
    f=>{f.request.status='REVIEW_REQUIRED'},
    f=>{f.request.reviewed_by=null},
    f=>{f.request.reviewed_at='2026-09-01T00:00:00Z'},
    f=>{f.project.mapping_status='CANDIDATE'},
    f=>{f.project.production_branch='main'},
    f=>{f.keyword.approval_status='PROPOSED'},
    f=>{f.receipt.actor='44444444-4444-4444-8444-444444444444'},
    f=>{f.receipt.created_at='2026-10-01T00:00:00Z'},
    f=>{f.evidence.source_at='2026-10-01T00:00:00Z'},
    f=>{f.job.page='https://evil.test/notebook'},
  ]) {
    const f=fixture();change(f);const h=harness(f)
    await assert.rejects(()=>executeApprovedDraftPr(UUID,{...h,dryRun:false,now:NOW}))
    assert.equal(h.calls.includes('create-branch'),false)
    assert.equal(h.calls.includes('draft-pr'),false)
  }
})
test('changed HEAD, existing branch, changed file and ambiguous literal stop before mutations',async()=>{
  for(const config of [{moveHead:true},{branchExists:true},{badBlob:true},{ambiguous:true}]) {
    const h=harness(fixture(),config)
    await assert.rejects(()=>executeApprovedDraftPr(UUID,{...h,dryRun:false,now:NOW}))
    assert.equal(h.calls.includes('create-branch'),false)
    assert.equal(h.calls.includes('draft-pr'),false)
  }
})
test('duplicate receipt is idempotent: zero GitHub calls',async()=>{
  const f=fixture()
  f.existingRun={request_id:UUID,pr_url:'https://github.com/noteroru2/amphon.co.th/pull/18'}
  const h=harness(f)
  const result=await executeApprovedDraftPr(UUID,{...h,dryRun:false,now:NOW})
  assert.equal(result.outcome,'ALREADY_RECORDED')
  assert.deepEqual(h.calls,['snapshot'])
})
test('CLI explicitly requires owner-execute flag; defaults to dry-run',()=>{
  assert.deepEqual(parseCli(['--request-id',UUID]),{requestId:UUID,dryRun:true,authorized:false})
  assert.throws(()=>parseCli(['--request-id',UUID,'--execute']),/OWNER_EXECUTION_FLAG_REQUIRED/)
  assert.throws(()=>parseCli(['--request-id',UUID,'--deploy']),/INVALID_CLI_ARGUMENT/)
  const allow=parseCli(['--request-id',UUID,'--execute','--owner-authorized'])
  assert.equal(allow.dryRun,false)
})
test('staged DB receipt ledger enforces verified owner approval and PR/branch identity',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261123103000_seo_source_change_pr_runs.sql',import.meta.url),'utf8')
  assert.match(sql,/enable row level security/i)
  assert.match(sql,/revoke all on public.commerce_seo_source_change_pr_runs from public, anon, authenticated/)
  assert.match(sql,/v.status <> 'APPROVED_FOR_DRAFT_PR'/)
  assert.match(sql,/new.base_commit_sha <> v.expected_base_sha/)
  assert.match(sql,/new.pr_url <> 'https:\/\/github.com\/'/)
  assert.match(sql,/request_id uuid primary key/)
  assert.ok(!/merge_pull_request|deploy.production/i.test(sql))
})

test('protected GitHub Actions target is derived from DB approval, not caller-supplied repo',async()=>{
 const current=fixture()
 const resolved=await resolveApprovedTarget(UUID,{
   async loadSnapshot(id){assert.equal(id,UUID);return current}
 },NOW)
 assert.deepEqual(resolved,{owner:'noteroru2',repository:'amphon.co.th'})
 const bad=fixture();bad.request.status='REVIEW_REQUIRED'
 await assert.rejects(()=>resolveApprovedTarget(UUID,{async loadSnapshot(){return bad}},NOW),
   /OWNER_APPROVAL_REQUIRED/)
})
test('manual operator workflow requires explicit protected environment + one-repo app token',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/seo-draft-pr-execute.yml',import.meta.url),'utf8')
 assert.match(workflow,/workflow_dispatch:/)
 assert.match(workflow,/environment: seo-draft-pr-protected/)
 assert.match(workflow,/YES_OWNER_ENABLED/)
 assert.match(workflow,/actions\/create-github-app-token@v2/)
 assert.match(workflow,/owner: \$\{\{ steps.target.outputs.owner \}\}/)
 assert.match(workflow,/repositories: \$\{\{ steps.target.outputs.repository \}\}/)
 assert.match(workflow,/permission-contents: write/)
 assert.match(workflow,/permission-pull-requests: write/)
 assert.match(workflow,/--dry-run/)
 assert.match(workflow,/--execute --owner-authorized/)
 assert.ok(!/^\s*(schedule|push|pull_request_target):/m.test(workflow))
 assert.ok(!/wrangler deploy|vercel deploy|gh pr merge|gh workflow run|gh release create/.test(workflow))
})
