import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source=readFileSync(new URL('../supabase/functions/seo-connector/releaseMeasurement.ts',import.meta.url),'utf8')
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
}}).outputText
const {
  sanitizeRelease,assessReleasePortfolio,
}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))

const SITE={id:'amphon',label:'amphon.co.th',origin:'https://amphon.co.th'}
const PROJECT={site_id:'amphon',mapping_status:'VERIFIED',production_repo:'noteroru2/amphon.co.th'}
const SHA='f'.repeat(40)
const now=new Date('2026-11-23T09:00:00Z')
const row=(patch={})=>({
  id:'11111111-1111-4111-8111-111111111111',
  site_id:SITE.id,repository:PROJECT.production_repo,commit_sha:SHA,
  environment:'PRODUCTION',event_kind:'PRODUCTION_VERIFIED',
  provider:'CLOUDFLARE',external_event_id:'deployment-verified-1',
  event_at:'2026-11-15T03:00:00Z',qa_status:'PASS',
  affected_urls:['https://amphon.co.th/services/notebook'],
  evidence:{
    github_sha_verified:true,domain_worker_mapping_verified:true,
    live_response_verified:true,live_verified_at:'2026-11-15T03:15:00Z',
  },...patch,
})
const assess=(rows,project=PROJECT,time=now)=>
  assessReleasePortfolio([SITE],[project],
    rows.map(r=>sanitizeRelease(r,SITE)),time)[0]

test('commit observed and provider successful are not production verification',()=>{
  const onlyCommit=assess([row({event_kind:'COMMIT_OBSERVED',environment:'UNKNOWN',
    qa_status:'NOT_VERIFIED'})])
  assert.equal(onlyCommit.level,'COMMIT_ONLY')
  assert.equal(onlyCommit.confirmed_production_count,0)
  assert.equal(onlyCommit.measurement_windows[0].status,'PRODUCTION_NOT_VERIFIED')

  const deployed=assess([
    row({event_kind:'DEPLOY_SUCCEEDED',qa_status:'NOT_VERIFIED',
      evidence:{source:'Cloudflare Worker Deployments API',
        domain_worker_mapping_verified:true,github_sha_verified:false},
      commit_sha:''}),
  ])
  assert.equal(deployed.level,'PROVIDER_DEPLOY_ONLY')
  assert.equal(deployed.provider_deploy_count,1)
  assert.equal(deployed.confirmed_production_count,0)
  assert.ok(deployed.missing_evidence.includes('GITHUB_SHA_HOSTING_CORRELATION'))
  assert.ok(deployed.missing_evidence.includes('LIVE_HTTP_RESPONSE_PROOF'))
  assert.equal(deployed.auto_deploy_allowed,false)
})

test('sanitize provider evidence to whitelisted booleans, never leak secrets or foreign URLs',()=>{
  const raw=row({
    affected_urls:['https://amphon.co.th/services/notebook',
      'https://evil.example/','https://amphon.co.th/foo?secret=abc',
      'https://amphon.co.th/services/notebook'],
    evidence:{github_sha_verified:true,domain_worker_mapping_verified:true,
      live_response_verified:true,live_verified_at:'2026-11-15T03:15:00Z',
      access_token:'DO_NOT_LEAK',github_api_token:'PRIVATE'},
  })
  const safe=sanitizeRelease(raw,SITE)
  assert.deepEqual(safe.affected_urls,['https://amphon.co.th/services/notebook'])
  assert.equal(safe.release_proof.route_verified,true)
  assert.equal(safe.release_proof.github_sha_verified,true)
  assert.equal(safe.release_proof.live_response_verified,true)
  assert.ok(!JSON.stringify(safe).includes('DO_NOT_LEAK'))
  assert.ok(!JSON.stringify(safe).includes('PRIVATE'))
  assert.ok(!('evidence' in safe))
})

test('complete provider SHA, route, live HTTP, QA and deploy identity unlock only evidence grade',()=>{
  const gate=assess([row()])
  assert.equal(gate.level,'PRODUCTION_EVIDENCE_COMPLETE')
  assert.equal(gate.confirmed_production_count,1)
  assert.equal(gate.verified_release_at,'2026-11-15T03:00:00Z')
  assert.equal(gate.auto_merge_allowed,false)
  assert.equal(gate.auto_deploy_allowed,false)
  assert.deepEqual(gate.confirmed_affected_urls,['https://amphon.co.th/services/notebook'])
})

test('missing any production proof or mismatched repo blocks verification',()=>{
  for(const changes of [
    {qa_status:'NOT_VERIFIED'},{event_kind:'DEPLOY_SUCCEEDED'},
    {environment:'STAGING'},{commit_sha:'badsha'},
    {external_event_id:''},
    {evidence:{github_sha_verified:false,domain_worker_mapping_verified:true,
      live_response_verified:true,live_verified_at:'2026-11-15T03:15:00Z'}},
    {evidence:{github_sha_verified:true,domain_worker_mapping_verified:false,
      live_response_verified:true,live_verified_at:'2026-11-15T03:15:00Z'}},
    {evidence:{github_sha_verified:true,domain_worker_mapping_verified:true,
      live_response_verified:false,live_verified_at:'2026-11-15T03:15:00Z'}},
    {evidence:{github_sha_verified:true,domain_worker_mapping_verified:true,
      live_response_verified:true,live_verified_at:'2026-11-15T02:59:00Z'}},
    {repository:'attacker/seo'},
  ]){
    const gate=assess([row(changes)])
    assert.notEqual(gate.level,'PRODUCTION_EVIDENCE_COMPLETE',JSON.stringify(changes))
  }
  const project={...PROJECT,mapping_status:'CANDIDATE'}
  assert.notEqual(assess([row()],project).level,'PRODUCTION_EVIDENCE_COMPLETE')
})

test('post-release calendar uses Google Pacific timezone and never manufactures SEO uplift',()=>{
  const gate=assess([row()],PROJECT,now)
  const first=gate.measurement_windows[0]
  assert.equal(first.days,7)
  assert.equal(first.baseline_start,'2026-11-07')
  assert.equal(first.baseline_end,'2026-11-13')
  assert.equal(first.after_start,'2026-11-15')
  assert.equal(first.after_end,'2026-11-21')
  assert.equal(first.eligible_after,'2026-11-24')
  assert.equal(first.status,'WAITING_FINAL_GSC')
  assert.equal(first.uplift_measured,false)
  const next=assess([row()],PROJECT,new Date('2026-11-28T12:00:00Z'))
  assert.equal(next.measurement_windows[0].status,'DATE_SCOPED_GSC_REQUIRED')
  assert.equal(next.measurement_windows[1].status,'WAITING_FINAL_GSC')
  assert.equal(next.measurement_windows[2].status,'WAITING_FINAL_GSC')
})

test('verified release without affected URLs still cannot measure a page uplift',()=>{
  const gate=assess([row({affected_urls:[]})])
  assert.equal(gate.level,'PRODUCTION_EVIDENCE_COMPLETE')
  assert.equal(gate.measurement_windows[0].status,'URL_SCOPE_UNKNOWN')
  assert.ok(gate.missing_evidence.includes('VERIFIED_AFFECTED_URL_SCOPE'))
})

test('rolling GSC property windows alone do not satisfy date-scoped release measurement',()=>{
  const gate=assess([row()],PROJECT,new Date('2026-12-30T12:00:00Z'))
  assert.ok(gate.measurement_windows.every(w=>
    w.status==='DATE_SCOPED_GSC_REQUIRED' && w.uplift_measured===false))
  // The evaluator deliberately takes NO GSC rolling-window data as input;
  // exact before/after URL+query observations remain a separate task.
})

test('source code cannot write database or auto-verify external hosting evidence',()=>{
  const edge=readFileSync(new URL('../supabase/functions/seo-gsc/index.ts',import.meta.url),'utf8')
  assert.match(edge,/sanitizeRelease\(/)
  assert.match(edge,/release_gates:releaseGates/)
  assert.ok(!edge.includes('release_proof:evidence'))
  const mcp=readFileSync(new URL('../supabase/functions/seo-connector/index.ts',import.meta.url),'utf8')
  assert.match(mcp,/releases:safeReleases,release_gates:releaseGates/)
  assert.match(mcp,/sanitizeRelease\(/)
  const view=readFileSync(new URL('../src/components/SeoReleaseVerificationPanel.tsx',import.meta.url),'utf8')
  assert.match(view,/uplift|Rolling GSC Snapshot/)
  assert.ok(!view.includes('PRODUCTION_VERIFIED_LEDGER_INSERT'))
})
