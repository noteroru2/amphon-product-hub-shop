import test from 'node:test'
import assert from 'node:assert/strict'
import {reviewPrivateRetention} from '../scripts/evidence-retention-review.mjs'
const key='evidence/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp'
const base={object:{key,last_modified:'2026-11-01T00:00:00Z'},requests:[],
 inventoryComplete:true,now:'2026-11-26T00:00:00Z',retentionMs:7*86400000}
const cancelled={private_media_key:key,status:'CANCELLED',cancelled_at:'2026-11-02T00:00:00Z'}
test('read-only review identifies old orphans/cancelled objects without authorizing deletion or leaking keys',()=>{
 for(const [requests,reason] of [[[],'REVIEW_ORPHAN_OBJECT'],[[cancelled],'REVIEW_CANCELLED_OBJECT']]) {
  const result=reviewPrivateRetention({...base,requests})
  assert.equal(result.reason,reason)
  assert.equal(result.deletion_authorized,false)
  assert.match(result.object_key_sha256,/^[a-f0-9]{64}$/)
  assert.ok(!JSON.stringify(result).includes(key))
 }
})
test('shared active site, unknown state, incomplete inventory and missing cancellation timestamp all hold media',()=>{
 for(const status of ['PENDING_SOURCE_PR','DRAFT_PR_OPEN','RELEASED','UNKNOWN']) {
  const result=reviewPrivateRetention({...base,requests:[cancelled,{private_media_key:key,status}]})
  assert.equal(result.reason,status==='UNKNOWN'?'HOLD_UNKNOWN_STATE':'HOLD_ACTIVE_REFERENCE')
  assert.equal(result.deletion_authorized,false)
 }
 assert.equal(reviewPrivateRetention({...base,inventoryComplete:false}).reason,'HOLD_INCOMPLETE_INVENTORY')
 assert.equal(reviewPrivateRetention({...base,requests:[{}]}).reason,'HOLD_INCOMPLETE_INVENTORY')
 assert.equal(reviewPrivateRetention({...base,requests:[{...cancelled,cancelled_at:undefined}]}).reason,'HOLD_CANCELLATION_TIME_UNKNOWN')
})
test('retention starts at latest object write or cancellation; expiry or snapshot races never authorize a delete',()=>{
 assert.equal(reviewPrivateRetention({...base,requests:[{...cancelled,cancelled_at:'2026-11-25T00:00:00Z'}]}).reason,'HOLD_RETENTION_PERIOD')
 assert.equal(reviewPrivateRetention({...base,object:{key,last_modified:'2026-11-25T00:00:00Z'}}).reason,'HOLD_RETENTION_PERIOD')
 assert.equal(reviewPrivateRetention({...base,retentionMs:0}).reason,'HOLD_INVALID_RETENTION_PROOF')
 assert.equal(reviewPrivateRetention({...base,now:'invalid'}).reason,'HOLD_INVALID_RETENTION_PROOF')
 const stale=reviewPrivateRetention(base)
 const concurrent=reviewPrivateRetention({...base,requests:[{private_media_key:key,status:'PENDING_SOURCE_PR'}]})
 assert.equal(stale.deletion_authorized,false)
 assert.equal(concurrent.reason,'HOLD_ACTIVE_REFERENCE')
})
