import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
  validateEvidenceTarget,selectLiveDeployment,
  assessProductionDiscovery,githubAncestryPresent,digestBody,
} from '../scripts/seo-production-evidence-core.mjs'
import {parseArgs,collectEvidence} from '../scripts/seo-production-evidence.mjs'

const SHA='a'.repeat(40)
const BRANCH_SHA='b'.repeat(40)
const SITE={id:'amphon',label:'amphon.co.th',origin:'https://amphon.co.th',enabled:true}
const PROJECT={
  site_id:'amphon',mapping_status:'VERIFIED',production_repo:'noteroru2/amphon.co.th',
  production_branch:'release/cloudflare-production',hosting_provider:'CLOUDFLARE_WORKERS',
  hosting_project_id:'amphon-co-th-production',central_deploy_allowed:false,
}
const DEPLOY='cc175707-9e96-427f-9569-591254f4524b'
const VERSION='0f1bcef1-a1b7-44d4-bc50-8196cae41e02'
const cloudflare=(percentage=100)=>({success:true,result:{deployments:[{
  id:DEPLOY,created_on:'2026-11-22T16:19:10.805768Z',
  annotations:{'workers/message':'AMPHON PR74 approved SHA cb55117d'},
  versions:[{version_id:VERSION,percentage}],
}]}})
const compare={
  status:'ahead',base_commit:{sha:SHA},merge_base_commit:{sha:SHA},
  commits:[{sha:BRANCH_SHA}],ahead_by:1,
}
const snapshot=(override={})=>({
  site:SITE,project:PROJECT,
  github:{ref_sha:BRANCH_SHA,compare},cloudflare:cloudflare(),
  http:{status:200,final_origin:SITE.origin,body_sha256:'f'.repeat(64)},
  expectedSha:SHA,observedAt:'2026-11-23T12:30:00Z',
  ...override,
})
test('approved target must belong to enabled registry with verified non-deployable mapping',()=>{
  assert.equal(validateEvidenceTarget({site:SITE,project:PROJECT}).worker,'amphon-co-th-production')
  for(const invalid of [
    {site:{...SITE,enabled:false},project:PROJECT},
    {site:SITE,project:{...PROJECT,mapping_status:'CANDIDATE'}},
    {site:SITE,project:{...PROJECT,central_deploy_allowed:true}},
    {site:SITE,project:{...PROJECT,production_repo:'attacker/../repo'}},
    {site:{...SITE,origin:'http://localhost/'},project:PROJECT},
    {site:{...SITE,origin:'https://127.0.0.1/'},project:PROJECT},
    {site:{...SITE,origin:'https://amphon.co.th.evil.test/'},project:PROJECT},
    {site:SITE,project:{...PROJECT,production_branch:'../main'}},
    {site:SITE,project:{...PROJECT,hosting_provider:'VERCEL'}},
  ])assert.throws(()=>validateEvidenceTarget(invalid),/SEO_PRODUCTION_EVIDENCE_/)
})
test('full GitHub SHA ancestry check cannot be inferred from a prefix or another branch',()=>{
  assert.equal(githubAncestryPresent(SHA,SHA,undefined),true)
  assert.equal(githubAncestryPresent(SHA,BRANCH_SHA,compare),true)
  assert.equal(githubAncestryPresent('cb55117d',BRANCH_SHA,compare),false)
  assert.equal(githubAncestryPresent(SHA,BRANCH_SHA,{...compare,status:'diverged'}),false)
  assert.equal(githubAncestryPresent(SHA,BRANCH_SHA,{...compare,merge_base_commit:{sha:BRANCH_SHA}}),false)
  assert.equal(githubAncestryPresent(SHA,BRANCH_SHA,{...compare,base_commit:{sha:BRANCH_SHA}}),false)
})
test('Cloudflare 100% version is recognized but cannot prove actual source SHA',()=>{
  const r=selectLiveDeployment(cloudflare())
  assert.equal(r.deployment_id,DEPLOY)
  assert.equal(r.version_id,VERSION)
  assert.equal(r.traffic_percent,100)
  const split=selectLiveDeployment({result:{deployments:[{
    id:DEPLOY,created_on:'2026-11-22T16:19:10Z',
    versions:[{version_id:VERSION,percentage:75},{version_id:'1'.repeat(8)+'-1111-1111-1111-111111111111',percentage:25}],
  }]}})
  assert.equal(split.version_id,null)
  assert.ok(split.blockers.includes('CLOUDFLARE_SPLIT_OR_INVALID_TRAFFIC'))
  assert.ok(selectLiveDeployment({}).blockers.includes('NO_WORKER_DEPLOYMENT'))
})
test('read-only report never upgrades an annotation or HTTP 200 to verified Production',()=>{
  const report=assessProductionDiscovery(snapshot())
  assert.equal(report.github_branch_sha,BRANCH_SHA)
  assert.equal(report.expected_sha_is_on_approved_branch,true)
  assert.equal(report.worker_version_id,VERSION)
  assert.equal(report.live_http_ok,true)
  assert.equal(report.production_verified,false)
  assert.equal(report.can_write_ledger,false)
  assert.equal(report.can_merge,false)
  assert.equal(report.can_deploy,false)
  assert.equal(report.seo_uplift_measured,false)
  assert.ok(report.missing_evidence.includes('EXACT_HOSTING_GITHUB_SHA_OR_ASSET_CHECKSUM_UNPROVEN'))
  assert.ok(!JSON.stringify(report).includes('cb55117d'))
})
test('missing expected SHA, missing HTTP and wrong branch are visibly blocked',()=>{
  const a=assessProductionDiscovery(snapshot({expectedSha:null,github:{ref_sha:SHA}}))
  assert.ok(a.missing_evidence.includes('APPROVED_FULL_RELEASE_SHA_REQUIRED'))
  const b=assessProductionDiscovery(snapshot({http:{status:503,final_origin:null}}))
  assert.equal(b.live_http_ok,false)
  assert.ok(b.missing_evidence.includes('LIVE_ORIGIN_HTTP_PROBE_MISSING'))
  const c=assessProductionDiscovery(snapshot({github:{ref_sha:BRANCH_SHA,compare:{...compare,status:'diverged'}}}))
  assert.ok(c.missing_evidence.includes('SOURCE_SHA_NOT_ON_REGISTERED_PRODUCTION_BRANCH'))
})
test('CLI fails closed for malformed site, short SHA and unknown arguments',()=>{
  assert.deepEqual(parseArgs(['--site-id','amphon','--expected-sha',SHA]),{siteId:'amphon',expectedSha:SHA})
  for(const args of [
    [],['--site-id','../../secret'],['--site-id','amphon','--expected-sha','cb55117d'],
    ['--site-id','amphon','--execute'],['--site-id','amphon','--site-id','foo','--something'],
  ])assert.throws(()=>parseArgs(args),/SEO_PRODUCTION_EVIDENCE_/)
})
test('collector makes only allowlisted authenticated GETs; secrets and raw provider notes never leave',async()=>{
  const env={
    AMPHON_SEO_SUPABASE_URL:'https://mfpdtlxwdbxitgfzdape.supabase.co',
    AMPHON_SEO_SERVICE_ROLE_KEY:'service_only_SUPER_PRIVATE_SECRET_123456',
    AMPHON_CLOUDFLARE_ACCOUNT_ID:'2382f4589cd2452e9e3b7b83c25d4fc0',
    AMPHON_CLOUDFLARE_API_TOKEN:'cf_ONLY_PRIVATE_SECRET_123456',
    AMPHON_SEO_GITHUB_READ_TOKEN:'github_READ_ONLY_PRIVATE_SECRET',
  }
  const original=globalThis.fetch
  const calls=[]
  try{
    globalThis.fetch=async(input,options)=>{
      const url=String(input);calls.push({url,method:options?.method,auth:options?.headers?.Authorization})
      if(url.includes('commerce_seo_sites?'))return Response.json([SITE])
      if(url.includes('commerce_seo_portfolio_projects?'))return Response.json([PROJECT])
      if(url.includes('/git/ref/heads/'))return Response.json({object:{sha:BRANCH_SHA}})
      if(url.includes('/compare/'))return Response.json(compare)
      if(url.includes('api.cloudflare.com'))return Response.json(cloudflare())
      if(url===SITE.origin+'/')return new Response('<!doctype html><title>AMPHON</title>',{
        status:200,headers:{'Content-Type':'text/html'},
      })
      throw Error('UNKNOWN_NETWORK_ROUTE')
    }
    const result=await collectEvidence(['--site-id','amphon','--expected-sha',SHA],env,new Date('2026-11-23T12:30:00Z'))
    assert.equal(result.production_verified,false)
    assert.equal(result.expected_sha_is_on_approved_branch,true)
    assert.equal(result.live_http_ok,true)
    assert.equal(result.deployment_id,DEPLOY)
    assert.equal(calls.length,6)
    assert.ok(calls.every(x=>x.method==='GET'))
    assert.ok(!JSON.stringify(result).includes('PRIVATE_SECRET'))
    assert.ok(!JSON.stringify(result).includes('cb55117d'))
    assert.equal(result.live_origin_body_sha256,digestBody('<!doctype html><title>AMPHON</title>'))
  }finally{globalThis.fetch=original}
})
test('manual workflow and code have no write actions to GitHub, Cloudflare, DNS or Supabase',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/seo-production-evidence-readonly.yml',import.meta.url),'utf8')
  const cli=readFileSync(new URL('../scripts/seo-production-evidence.mjs',import.meta.url),'utf8')
  assert.match(workflow,/workflow_dispatch:/)
  assert.match(workflow,/environment: seo-production-evidence-protected/)
  assert.match(workflow,/contents: read/)
  assert.doesNotMatch(workflow,/permission-contents: write|permission-pull-requests: write|wrangler deploy|supabase db push/)
  assert.doesNotMatch(cli,/method:'POST'|method:'PATCH'|method:'DELETE'|method:'PUT'/)
  assert.match(cli,/method:'GET'/)
})
