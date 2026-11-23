import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const transpile=src=>ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const raw=readFileSync(new URL('../supabase/functions/seo-connector/sourceChangeGuard.ts',import.meta.url),'utf8')
const guard=await import('data:text/javascript;base64,'+Buffer.from(transpile(raw)).toString('base64'))
const now=new Date('2026-11-23T10:00:00Z')
const receipt='711d5aba-710a-4db7-a1d9-d1df4558ec40'
const actor='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const goodArgs=()=>({
 job_id:16,evidence_id:20,gsc_receipt_id:receipt,expected_base_sha:'a'.repeat(40),
 target_paths:['src/pages/services/notebook.astro'],change_kind:'CONTENT',
 summary:'Add verifiable customer inspection examples to page',
 rationale:'Improve product expertise with real condition-checking steps',
 proposed_change:'Expand the service guide with a verified inspection checklist and sources.'
})
const evidence=()=>({
 site:{id:'amphon',origin:'https://amphon.co.th',enabled:true},
 project:{site_id:'amphon',mapping_status:'VERIFIED',production_repo:'noteroru2/amphon.co.th',production_branch:'release/cloudflare-production'},
 job:{id:16,site_id:'amphon',page:'https://amphon.co.th/services/notebook',focus_query:'รับซื้อโน๊ตบุ๊ค',status:'EVIDENCE_READY',evidence_id:20},
 evidence:{id:20,job_id:16,source_url:'https://amphon.co.th/services/notebook',source_at:'2026-11-22T12:00:00Z'},
 receipt:{id:receipt,actor,site_id:'amphon',query_request:{page:'https://amphon.co.th/services/notebook',query:'รับซื้อโน๊ตบุ๊ค'},created_at:'2026-11-23T07:00:00Z'},
 keyword:{site_id:'amphon',keyword:'รับซื้อโน๊ตบุ๊ค',approval_status:'APPROVED',target_page:null},
 actor,jobId:16,evidenceId:20,
})

test('valid source proposal remains review-only and forbids GitHub mutation',()=>{
 const validated=guard.validateSourceProposalInput(goodArgs())
 assert.deepEqual(validated.targetPaths,['src/pages/services/notebook.astro'])
 const state=guard.assertSourceProposalEvidence(evidence(),now)
 assert.equal(state.safety.can_prepare_source_request,true)
 assert.equal(state.safety.can_create_or_edit_github,false)
 assert.equal(state.safety.can_merge_or_deploy,false)
 assert.equal(state.safety.base_commit_verified_with_github,false)
})

test('unsafe file paths, duplicate targets, config and secrets are rejected',()=>{
 for(const path of ['.github/workflows/deploy.yml','../../.env','src/pages/../../.env','src/pages/a\\b.astro','src/pages/.hidden.astro','src/pages/.env','wrangler.jsonc','src/data/prices.ts','public/admin.html','src/pages/test.js']){
  assert.equal(guard.safeSourcePath(path),false,path)
  assert.throws(()=>guard.validateSourceProposalInput({...goodArgs(),target_paths:[path]}))
 }
 assert.throws(()=>guard.validateSourceProposalInput({...goodArgs(),target_paths:['src/pages/a.astro','src/pages/a.astro']}))
})

test('invalid SHA, receipt, lengths and undeclared arguments are rejected',()=>{
 assert.throws(()=>guard.validateSourceProposalInput({...goodArgs(),expected_base_sha:'abc'}))
 assert.throws(()=>guard.validateSourceProposalInput({...goodArgs(),gsc_receipt_id:'not-a-uuid'}))
 assert.throws(()=>guard.validateSourceProposalInput({...goodArgs(),summary:'short'}))
 assert.throws(()=>guard.validateSourceProposalInput({...goodArgs(),not_supported:true}))
})

test('unverified repo, wrong page, wrong keyword and disabled site fail closed',()=>{
 const tests=[
  x=>{x.project.mapping_status='CANDIDATE'},
  x=>{x.site.enabled=false},
  x=>{x.project.production_branch=null},
  x=>{x.evidence.source_url='https://evil.test/services/notebook'},
  x=>{x.keyword.approval_status='PROPOSED'},
  x=>{x.keyword.target_page='https://amphon.co.th/other'},
  x=>{x.receipt.query_request.query='another keyword'},
  x=>{x.receipt.query_request.page='https://amphon.co.th/other'},
  x=>{x.receipt.actor='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'},
 ]
 for(const change of tests){const e=evidence();change(e);assert.throws(()=>guard.assertSourceProposalEvidence(e,now))}
})
test('stale page capture and stale exact GSC receipt fail closed',()=>{
 const e=evidence();e.evidence.source_at='2026-10-01T10:00:00Z'
 assert.throws(()=>guard.assertSourceProposalEvidence(e,now))
 const f=evidence();f.receipt.created_at='2026-11-01T10:00:00Z'
 assert.throws(()=>guard.assertSourceProposalEvidence(f,now))
})

test('SQL migration is owner-only, no direct auth writes, and approval not deploy',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261123094500_seo_source_change_requests.sql',import.meta.url),'utf8')
 assert.match(sql,/enable row level security/)
 assert.match(sql,/revoke all on public\.commerce_seo_source_change_requests from public, anon, authenticated/)
 assert.match(sql,/grant select on public\.commerce_seo_source_change_requests to authenticated/)
 assert.match(sql,/current_user_role\(\) is distinct from 'owner'/)
 assert.match(sql,/v\.status <> 'REVIEW_REQUIRED'/)
 assert.match(sql,/v\.gsc_receipt_id/)
 assert.match(sql,/e\.source_at >= now\(\) - interval '30 days'/)
 assert.match(sql,/r\.created_at >= now\(\) - interval '7 days'/)
 assert.match(sql,/p\.mapping_status = 'VERIFIED'/)
 assert.match(sql,/APPROVED_FOR_DRAFT_PR/)
 assert.ok(!/github_token|deployment_token|api_secret/i.test(sql))
})
