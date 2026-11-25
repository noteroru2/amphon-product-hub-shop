import test from 'node:test'
import assert from 'node:assert/strict'
import {assertProtectedEvidenceEnvironment,checkEvidenceEnvironment} from '../scripts/evidence-protected-env-preflight.mjs'
const good={name:'evidence-draft-pr-protected',
 protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{login:'synthetic-reviewer'}}]}]}
test('protected Environment needs actual required-reviewers rule',()=>{
 assert.equal(assertProtectedEvidenceEnvironment(good).protected,true)
 for(const broken of [
  {...good,protection_rules:[]},
  {...good,protection_rules:[{type:'wait_timer',wait_timer:0}]},
  {...good,protection_rules:[{type:'required_reviewers',reviewers:[]}]},
  {...good,name:'production'},
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
})
