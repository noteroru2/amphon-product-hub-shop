import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../supabase/functions/seo-connector/developmentStatus.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const policy = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const asOf = new Date('2026-11-23T09:00:00Z')
const sha = 'f'.repeat(40)
const sourceData = () => ({
  sites: [{ id: 'amphon', label: 'amphon.co.th', origin: 'https://amphon.co.th' }],
  projects: [{ site_id: 'amphon', mapping_status: 'VERIFIED', production_repo: 'noteroru2/amphon.co.th', production_branch: 'main', central_deploy_allowed: false }],
  roles: [{ site_id: 'amphon', keyword: 'รับซื้อโน๊ตบุ๊ค', role: 'PRIMARY', approval_status: 'APPROVED' }],
  windows: [{ site_id: 'amphon', window_days: 28, end_date: '2026-11-19', dates_present: 28, provenance: 'GSC_FINAL' }],
  ingests: [{ site_id: 'amphon', window_days: 14, end_date: '2026-11-19', data_complete: true, status: 'SUCCESS', rows_written: 123 }],
  releases: [],
})
const assess = (p, days = 28) => policy.assessDevelopmentReadiness(p, days, asOf)[0]

test('ready for page evidence does not grant source editing or deploy', () => {
  const result = assess(sourceData())
  assert.equal(result.status, 'READY_FOR_PAGE_EVIDENCE')
  assert.equal(result.readyForPageEvidence, true)
  assert.equal(result.sourcePatchAuthorized, false)
  assert.equal(result.automaticDeployAuthorized, false)
  assert.equal(result.gscReceiptConfirmed, true)
})

test('candidate or ambiguous repo mapping cannot start source review', () => {
  for (const state of ['CANDIDATE', 'MULTIPLE_CANDIDATES', 'UNVERIFIED']) {
    const data = sourceData()
    data.projects[0].mapping_status = state
    assert.equal(assess(data).status, 'NEEDS_REPO_MAPPING')
  }
  const data = sourceData()
  data.projects[0].production_repo = 'attacker/../../different'
  assert.equal(assess(data).repository, null)
})

test('Keyword Ownership must be explicitly approved', () => {
  const data = sourceData()
  data.roles[0].approval_status = 'PROPOSED'
  const result = assess(data)
  assert.equal(result.status, 'NEEDS_KEYWORD_APPROVAL')
  assert.equal(result.approvedKeywordCount, 0)
})

test('GSC final window cannot stand in for missing query/page receipt', () => {
  const data = sourceData()
  data.ingests = []
  const result = assess(data)
  assert.equal(result.status, 'NEEDS_FINAL_GSC')
  assert.equal(result.gscReceiptConfirmed, false)
  assert.equal(result.readyForPageEvidence, false)
})

test('GSC failures, incomplete pagination, stale timestamps and mismatched date block readiness', () => {
  for (const bad of [
    { status: 'FAILED' },
    { data_complete: false },
    { end_date: '2026-11-16' },
    { window_days: 28 },
  ]) {
    const data = sourceData()
    data.ingests[0] = { ...data.ingests[0], ...bad }
    assert.equal(assess(data).status, 'NEEDS_FINAL_GSC')
  }
  const stale = sourceData()
  stale.windows[0].end_date = '2026-10-01'
  stale.ingests[0].end_date = '2026-10-01'
  assert.equal(assess(stale).gscFresh, false)
})

test('production verified requires explicit event, environment, passed QA and 40-char SHA', () => {
  const data = sourceData()
  data.releases = [{ site_id: 'amphon', event_kind: 'COMMIT_OBSERVED', environment: 'PRODUCTION', qa_status: 'PASS', commit_sha: sha, event_at: '2026-11-20T00:00:00Z' }]
  assert.equal(assess(data).productionVerified, false)
  data.releases[0].event_kind = 'PRODUCTION_VERIFIED'
  data.releases[0].qa_status = 'UNKNOWN'
  assert.equal(assess(data).productionVerified, false)
  data.releases[0].qa_status = 'PASS'
  // A bare PRODUCTION_VERIFIED label with PASS + SHA is still uncorroborated.
  assert.equal(assess(data).productionVerified, false)
  data.releases[0].repository = 'noteroru2/amphon.co.th'
  data.releases[0].release_proof = {
    github_sha_verified: true, github_ref_verified:true, github_ref:'main',
    hosting_source_verified:true, route_verified: true,
    live_response_verified: true, deployment_id_present: true,
    live_verified_at: '2026-11-20T00:15:00Z',
  }
  assert.equal(assess(data).productionVerified, true)
  data.projects[0].production_branch = 'release/cloudflare-production'
  assert.equal(assess(data).productionVerified, false)
  data.projects[0].production_branch = 'main'
  data.releases[0].release_proof.hosting_source_verified = false
  assert.equal(assess(data).productionVerified, false)
  data.releases[0].release_proof.hosting_source_verified = true
  data.releases[0].release_proof.live_response_verified = false
  assert.equal(assess(data).productionVerified, false)
  assert.equal(assess(data).automaticDeployAuthorized, false)
})

test('milestone completion counts are evidence-derived and do not imply full project completion', () => {
  const data = sourceData()
  const readiness = policy.assessDevelopmentReadiness(data, 28, asOf)
  const milestones = policy.buildDevelopmentMilestones(data, readiness, false)
  assert.equal(milestones.length, 12)
  assert.equal(milestones.find((m) => m.id === 'portfolio').state, 'COMPLETE')
  assert.equal(milestones.find((m) => m.id === 'ownership').state, 'COMPLETE')
  assert.equal(milestones.find((m) => m.id === 'repo').state, 'COMPLETE')
  assert.equal(milestones.find((m) => m.id === 'mcp').state, 'PENDING_RELEASE')
  assert.equal(milestones.find((m) => m.id === 'patch').state, 'PLANNED')
  assert.equal(milestones.find((m) => m.id === 'release').state, 'PLANNED')
  assert.equal(milestones.find((m) => m.id === 'live_serp').state, 'PLANNED')
  assert.equal(milestones.filter((m) => m.state === 'COMPLETE').length < milestones.length, true)
})

test('false or missing data fail closed, not ranked zero or success', () => {
  const data = sourceData()
  data.windows = []
  data.ingests = []
  const result = assess(data)
  assert.equal(result.gscWindowEnd, null)
  assert.equal(result.gscFresh, false)
  assert.equal(result.status, 'NEEDS_FINAL_GSC')
})
