import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
// Review tool supplies its pinned local YAML parser; no dependency/install hook.
const require=createRequire(import.meta.url)
const {parse}=require(process.env.YAML_MODULE_PATH||'yaml')
const w=parse(readFileSync('.github/workflows/one4b-apply-r2-patch.yml','utf8'))
test('writer needs main push, canonical repository AND explicit owner opt-in',()=>{
 assert.deepEqual(w.on.push.branches,['main'])
 assert.equal(w.permissions.contents,'read');assert.equal(w.jobs.apply.permissions.contents,'write')
 const gate=w.jobs.apply.if
 const good={event_name:'push',ref:'refs/heads/main',repository:'noteroru2/amphon-product-hub-shop'}
 for(const [change,flag,expected]of [[{},undefined,false],[{},'',false],[{},'YES_OWNER_ENABLED',true],
  [{ref:'refs/heads/codex/evidence-qa-safe-20261126'},'YES_OWNER_ENABLED',false],
  [{ref:'refs/heads/feature/test'},'YES_OWNER_ENABLED',false],
  [{ref:'refs/tags/main'},'YES_OWNER_ENABLED',false],
  [{event_name:'workflow_dispatch'},'YES_OWNER_ENABLED',false],
  [{event_name:'pull_request'},'YES_OWNER_ENABLED',false],
  [{repository:'synthetic/fork'},'YES_OWNER_ENABLED',false]])
  assert.equal(runInNewContext(gate,{github:{...good,...change},vars:{ONE4B_PATCH_MAIN_WRITE_APPROVED:flag}}),expected)
})
test('exact SHA/no persisted checkout credential; only final step sets token env; write permission is job-scoped',()=>{
 const steps=w.jobs.apply.steps,checkout=steps.find(x=>x.uses?.startsWith('actions/checkout@'))
 assert.equal(checkout.with.ref,'${{ github.sha }}');assert.equal(checkout.with['persist-credentials'],false)
 const tokenSteps=steps.filter(x=>JSON.stringify(x.env||{}).includes('github.token'))
 // This checks explicit env placement, not isolation from Actions token context.
 assert.equal(tokenSteps.length,1)
 const script=tokenSteps[0].run
 for(const guard of ['test "$GITHUB_EVENT_NAME" = "push"','test "$GITHUB_REF" = "refs/heads/main"',
  'test "$GITHUB_REPOSITORY" = "noteroru2/amphon-product-hub-shop"','test "$(git rev-parse HEAD)" = "$GITHUB_SHA"'])assert.ok(script.includes(guard))
 assert.match(script,/push origin HEAD:main/);assert.doesNotMatch(script,/--force|\bgit merge\b/)
 assert.equal(w.concurrency['cancel-in-progress'],false)
})
