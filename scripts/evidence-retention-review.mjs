/** Offline, read-only classification of a supplied private-media inventory.
 * No CLI, network transport, credentials or delete action. Even a complete
 * snapshot cannot authorize deletion: a same-key enqueue may race the snapshot.
 */
import {createHash} from 'node:crypto'
const keyPattern=/^evidence\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.webp$/i
export function reviewPrivateRetention({object,requests,inventoryComplete=false,now,
 retentionMs}={}) {
 if(!keyPattern.test(object?.key||''))throw Error('EVIDENCE_RETENTION_KEY_INVALID')
 const output={object_key_sha256:createHash('sha256').update(object.key).digest('hex'),
  deletion_authorized:false,cleanup:'DEFERRED_LOCKED_REVIEW'}
 const result=reason=>({...output,reason})
 const current=Date.parse(now),modified=Date.parse(object.last_modified)
 if(!Number.isFinite(current)||!Number.isFinite(modified)||modified>current||
   !Number.isSafeInteger(retentionMs)||retentionMs<=0)return result('HOLD_INVALID_RETENTION_PROOF')
 if(inventoryComplete!==true||!Array.isArray(requests))return result('HOLD_INCOMPLETE_INVENTORY')
 // Reject malformed inventory instead of overlooking a possible shared key.
 if(requests.some(r=>!keyPattern.test(r?.private_media_key||'')))return result('HOLD_INCOMPLETE_INVENTORY')
 const references=requests.filter(r=>r.private_media_key===object.key)
 if(references.some(r=>['PENDING_SOURCE_PR','DRAFT_PR_OPEN','RELEASED'].includes(r.status)))
  return result('HOLD_ACTIVE_REFERENCE')
 if(references.some(r=>r.status!=='CANCELLED'))return result('HOLD_UNKNOWN_STATE')
 // The current queue schema has no cancelled_at. Never substitute requested_at
 // for a consent/cancellation journal entry just to make an object expire.
 const cancellations=references.map(r=>Date.parse(r.cancelled_at))
 if(cancellations.some(t=>!Number.isFinite(t)||t>current))return result('HOLD_CANCELLATION_TIME_UNKNOWN')
 const retainedSince=Math.max(modified,...cancellations)
 if(current-retainedSince<retentionMs)return result('HOLD_RETENTION_PERIOD')
 return result(references.length?'REVIEW_CANCELLED_OBJECT':'REVIEW_ORPHAN_OBJECT')
}
