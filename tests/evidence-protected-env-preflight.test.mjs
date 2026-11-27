import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {assertProtectedEvidenceEnvironment,checkEvidenceEnvironment} from '../scripts/evidence-protected-env-preflight.mjs'
const good={name:'evidence-draft-pr-protected',can_admins_bypass:false,
 protection_rules:[{type:'required_reviewers',prevent_self_review:true,reviewers:[{type:'User',reviewer:{login:'synthetic-reviewer'}}]}]}
test('protected Environment needs actual required-reviewers rule',()=>{
 assert.equal(assertProtectedEvidenceEnvironment(good).protected,true)
 for(const broken of [
  {...good,protection_rules:[]},
  {...good,protection_rules:[{type:'wait_timer',wait_timer:0}]},
  {...good,protection_rules:[{type:'required_reviewers',reviewers:[]}]},
  {...good,name:'production'},
  {...good,can_admins_bypass:true},
  {...good,protection_rules:[{...good.protection_rules[0],prevent_self_review:false}]},
  {name:'evidence-draft-pr-protected',protection_rules:[]},
  {},
 ])assert.throws(()=>assertProtectedEvidenceEnvironment(broken),'should fail unreviewed environment')
})
test('read-only preflight checks exact repo/environment and fails if GitHub denies request',async()=>{
 const seen=[]
 const mock=async(url,args)=>{seen.push([url,args]);return Response.json(good)}
 const r=await checkEvidenceEnvironment({repo:'noteroru2/amphon-product-hub-shop',
   token:'synthetic-read-only-token',fetchImpl:mock})
 assert.equal(r.reviewer_count,1)
 assert.equal(seen.length,1)
 assert.match(seen[0][0],/\/environments\/evidence-draft-pr-protected$/)
 assert.equal(seen[0][1].method,undefined)
 assert.throws(()=>assertProtectedEvidenceEnvironment({...good,
   protection_rules:[{type:'required_reviewers',reviewers:[{type:'Everyone'}]}]}))
 await assert.rejects(checkEvidenceEnvironment({repo:'other/repo',
   token:'synthetic-read-only-token',fetchImpl:mock}))
 await assert.rejects(checkEvidenceEnvironment({repo:'noteroru2/amphon-product-hub-shop',
   token:'synthetic-read-only-token',fetchImpl:()=>new Response(null,{status:403})}))
 await assert.rejects(checkEvidenceEnvironment({repo:'noteroru2/amphon-product-hub-shop',
   token:'synthetic-read-only-token',fetchImpl:()=>new Response(null,{status:404})}))
})

test('protected workflow can GET required-reviewers metadata with Actions read but cannot deploy',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/evidence-draft-pr-execute.yml',import.meta.url),'utf8')
 assert.match(yaml,/permissions:\s*\n\s*contents: read\s*\n\s*actions: read\b/)
 assert.match(yaml,/environment: evidence-draft-pr-protected/)
 assert.doesNotMatch(yaml,/^\s*deployments: (?:read|write)\s*$/m)
 assert.doesNotMatch(yaml,/^\s*actions: write\s*$/m)
})
