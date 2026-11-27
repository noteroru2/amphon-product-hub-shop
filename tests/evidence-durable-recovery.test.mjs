import test from 'node:test'
import assert from 'node:assert/strict'
import {durableImageStage,fingerprintBytes} from '../scripts/evidence-operation-journal.mjs'
import {cleanupEvidenceMedia} from '../scripts/evidence-cleanup.mjs'
import {privateImageRemote,cleanupPrivateRemote} from '../scripts/evidence-image-sharp.mjs'
import {githubAdapter} from '../scripts/seo-draft-pr-executor-adapters.mjs'
const key='evidence/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp'
const id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const bytes=Buffer.from('RIFF0000WEBP-synthetic'),digest=fingerprintBytes(bytes)
const snapshot={evidence:{approved_at:'2026-11-26T00:00:00Z'}}
function journal(op={}) {
 const saved={id,token:id,state:'RUNNING',checkpoints:{},...op}
 return {async begin(){return saved},async assert(){},async checkpoint(){},async finish(){},async uncertain(){}}
}
test('completed/recovered negative HEAD and mismatched object proof never authorize a PUT',async()=>{
 for(const [op,head] of [[{state:'DONE'},null],[{recovered:true},null],[{}, {sha256:'wrong',bytes:bytes.length,etag:'"fake"'}]]) {
  let writes=0
  await assert.rejects(durableImageStage({id,snapshot,bytes,gate:{key},
   store:{operations:journal(op),async loadSnapshot(){return snapshot}},
   remote:{async headPrivate(){return head},async putPrivate(){writes++}}}),/RECONCILIATION_REQUIRED/)
  assert.equal(writes,0)
 }
})
test('positive immutable object proof is reused, never uploaded again',async()=>{
 let writes=0
 const result=await durableImageStage({id,snapshot,bytes,gate:{key},
  store:{operations:journal(),async loadSnapshot(){return snapshot}},
  remote:{async headPrivate(){return {sha256:digest,bytes:bytes.length,etag:'"fake"'}},async putPrivate(){writes++}}})
 assert.equal(result.reconciled,true);assert.equal(writes,0)
})
test('cleanup defaults off and fails on changed object proof without any DELETE',async()=>{
 let calls=0
 await assert.rejects(cleanupEvidenceMedia({store:{},remote:{}}),/DISABLED/)
 await assert.rejects(cleanupEvidenceMedia({enabled:true,key,approval:id,
  store:{operations:journal({checkpoints:{object:{sha256:digest,etag:'"old"'}}})},
  remote:{async headPrivate(){return {sha256:digest,etag:'"changed"'}},async deletePrivate(){calls++}}}),/RECONCILIATION_REQUIRED/)
 assert.equal(calls,0)
})
test('R2 HEAD 403 is not absence; ordinary processor has no delete method; cleanup needs a separate disabled gate',async()=>{
 const env={AMPHON_SEO_SUPABASE_URL:'https://synthetic.supabase.co',AMPHON_SEO_SERVICE_ROLE_KEY:'synthetic-server-key'.padEnd(48,'x'),
  AMPHON_CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),AMPHON_R2_ACCESS_KEY_ID:'synthetic-access',AMPHON_R2_SECRET_ACCESS_KEY:'synthetic-secret-value-not-real'}
 const remote=privateImageRemote(env,async()=>new Response(null,{status:403}))
 assert.equal(remote.deletePrivate,undefined)
 await assert.rejects(remote.headPrivate(key),/HEAD_FAILED/)
 assert.throws(()=>cleanupPrivateRemote(env),/DISABLED/)
 const seen=[]
 const cleanup=cleanupPrivateRemote({...env,EVIDENCE_CLEANUP_ENABLED:'YES_OWNER_ENABLED',
  AMPHON_EVIDENCE_CLEANUP_R2_ACCESS_KEY_ID:'synthetic-cleanup-id',AMPHON_EVIDENCE_CLEANUP_R2_SECRET_ACCESS_KEY:'synthetic-cleanup-secret-not-real'},async(url,init)=>{
   assert.match(String(url),/^https:\/\/a{32}\.r2\.cloudflarestorage\.com\/amphon-evidence-staged-private\/evidence\//)
   seen.push(init.method);assert.equal(init.redirect,'error');assert.equal(init.body,undefined)
   return new Response(null,{status:204})})
 await cleanup.deletePrivate(key);assert.deepEqual(seen,['DELETE'])
 await assert.rejects(cleanup.deletePrivate('../other-key'))
})
test('replayed Git commits use a stable normalized operation timestamp and identical author/committer',async()=>{
 const original=globalThis.fetch
 globalThis.fetch=async(url,init)=>{
  assert.equal(String(url),'https://api.github.com/repos/synthetic/repo/git/commits')
  const body=JSON.parse(init.body)
  assert.deepEqual(body.author,body.committer)
  assert.equal(body.author.date,'2026-11-26T00:00:00.123Z')
  assert.equal(init.redirect,'error')
  return Response.json({sha:'d'.repeat(40)})
 }
 try {await githubAdapter('synthetic-github-token-for-tests').createCommit('synthetic/repo','a'.repeat(40),'b'.repeat(40),'synthetic','2026-11-26T00:00:00.123456+00:00')}
 finally{globalThis.fetch=original}
})
