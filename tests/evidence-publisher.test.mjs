import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const raw=readFileSync(new URL('../src/lib/evidencePublisherPolicy.ts',import.meta.url),'utf8')
const code=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const policy=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const id='dd8cbc49-1caf-477c-b579-955007517b61'
const imageId='8ebfb3f2-1d13-404f-9cfa-93ef40672f16'
const evidence={kind:'purchase',status:'APPROVED',permission_confirmed:true,privacy_reviewed:true,
 approved_at:'2026-11-24T12:59:11Z',transaction_verified:false}
const image={evidence_id:id,approved_for_public:true,storage_path:id+'/'+imageId+'.jpg'}
test('approved and privacy-reviewed image can only claim assessment until transaction verified',()=>{
 assert.equal(policy.assertPublicationEligible(evidence,image,id).claim_kind,'ASSESSMENT_ONLY')
 assert.equal(policy.assertPublicationEligible({...evidence,transaction_verified:true},image,id).claim_kind,'VERIFIED_TRANSACTION')
})
test('rejects missing approval, wrong image, and forged path',()=>{
 for(const patch of [{status:'DRAFT'},{approved_at:null},{permission_confirmed:false},{privacy_reviewed:false}])
   assert.throws(()=>policy.assertPublicationEligible({...evidence,...patch},image,id))
 assert.throws(()=>policy.assertPublicationEligible(evidence,{...image,approved_for_public:false},id))
 assert.throws(()=>policy.assertPublicationEligible(evidence,{...image,evidence_id:imageId},id))
 assert.throws(()=>policy.assertPublicationEligible(evidence,{...image,storage_path:'../secret.jpg'},id))
})
test('targets are bounded, normalized, unique, cannot leave site',()=>{
 assert.deepEqual(policy.validatePublicationTargets([{site_id:'amphon',page_path:'/บริการ/รับซื้อโน๊ตบุ๊ค/'}]),[
   {site_id:'amphon',page_path:'/บริการ/รับซื้อโน๊ตบุ๊ค'}])
 for(const path of ['https://evil.example/','//evil.example','/../secrets','/x?token=1','/x#private','/bad\\path','/a b'])
   assert.throws(()=>policy.validatePublicationTargets([{site_id:'amphon',page_path:path}]),path)
 assert.throws(()=>policy.validatePublicationTargets([{site_id:'amphon',page_path:'/a'}, {site_id:'amphon',page_path:'/a/'}]))
 assert.throws(()=>policy.validatePublicationTargets([]))
 assert.throws(()=>policy.validatePublicationTargets(Array.from({length:15},(_,i)=>({site_id:'amphon',page_path:'/p'+i}))))
})
test('public key generated only for verified uuid pairs',()=>{
 assert.equal(policy.publicMediaKey(id,imageId),'evidence/'+id+'/'+imageId+'.webp')
 assert.throws(()=>policy.publicMediaKey('../secret',imageId))
})
test('worker never includes site merge or deployment actions',()=>{
 const worker=readFileSync(new URL('../workers/evidence-publisher/index.mjs',import.meta.url),'utf8')
 assert.match(worker,/PENDING_SOURCE_PR/)
 assert.doesNotMatch(worker,/github\.com\/repos|\/deployments|wrangler deploy|merge_pull_request/)
 assert.match(worker,/IMAGES\.input/)
 assert.match(worker,/profiles\?id=eq/)
})
