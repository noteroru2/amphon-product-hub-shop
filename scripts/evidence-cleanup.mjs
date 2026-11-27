/** Deliberately no scheduled entry point and no Worker binding. The transport,
 * DB policy, active Owner approval and quiescent recovery must all allow deletion.
 */
import {fingerprint,holdUncertain} from './evidence-operation-journal.mjs'
export async function cleanupEvidenceMedia({key,approval,recoveryApproval,store,remote,enabled=false}) {
 if(enabled!==true)throw Error('EVIDENCE_CLEANUP_DISABLED')
 if(!/^[a-f0-9-]{36}$/i.test(approval||''))throw Error('EVIDENCE_CLEANUP_APPROVAL_REQUIRED')
 const journal=store.operations
 if(!journal)throw Error('EVIDENCE_JOURNAL_REQUIRED')
 const op=await journal.begin({kind:'DELETE',op_key:'DELETE:'+key,key,fingerprint:fingerprint({key}),
  approval:recoveryApproval||approval,delete_approval:approval})
 try {
  if(op.state!=='DONE')await journal.assert(op)
  const head=await remote.headPrivate(key)
  if(head) {
   if(op.state==='DONE'||head.etag!==op.checkpoints.object?.etag||head.sha256!==op.checkpoints.object?.sha256)
    throw Error('EVIDENCE_DELETE_OBJECT_CHANGED')
   await journal.assert(op)
   await remote.deletePrivate(key)
  }
  if(await remote.headPrivate(key))throw Error('EVIDENCE_DELETE_UNVERIFIED')
  if(op.state!=='DONE') {
   await journal.checkpoint(op,'absent',true)
   await journal.finish(op)
  }
  return {outcome:'PRIVATE_OBJECT_DELETION_VERIFIED',object_key_sha256:fingerprint(key),media_public:false}
 }catch(error) {return holdUncertain(journal,op,error)}
}
