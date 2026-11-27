import {randomUUID,createHash} from 'node:crypto'
import {evidenceServiceHeaders} from '../src/lib/evidenceSupabaseServerAuth.mjs'
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function operationJournal(url,key) {
 const call=async(action,p)=>{
  const r=await fetch(new URL('/rest/v1/rpc/evidence_operation',url),{method:'POST',
   headers:{...evidenceServiceHeaders(key),'content-type':'application/json'},body:JSON.stringify({p_action:action,p}),
   redirect:'error',signal:AbortSignal.timeout(16000)})
  if(!r.ok)throw Error('EVIDENCE_JOURNAL_REFUSED_'+r.status)
  return r.json()
 }
 return {async begin(input){return call('begin',{...input,token:input.token||randomUUID()})},
  async lookup(op_key){return call('lookup',{op_key})},
  async forRequest(request_id){return call('lookup_request',{request_id})},
  async audit(id){return call('audit',{id})},
  async checkpoint(op,phase,value){return call('checkpoint',{id:op.id,token:op.token,phase,value})},
  async assert(op){return call('assert',{id:op.id,token:op.token})},
  async finalize(op){return call('finish',{id:op.id,token:op.token})},
  async abandon(op){return call('abandon',{id:op.id,token:op.token})},
  async finish(op){const result=await call('finish',{id:op.id,token:op.token});
   if(result.state!=='DONE'||result.authorization_valid===false)throw Error('EVIDENCE_OPERATION_BLOCKED');return result},
  async uncertain(op){return call('uncertain',{id:op.id,token:op.token})}}
}
export async function holdUncertain(journal,op,cause) {
 // A failed DB write cannot release the persistent reservation. Even if this
 // update also fails, RUNNING remains held, with no automatic TTL takeover.
 try {await journal.uncertain(op)}catch{}
 const error=new Error('EVIDENCE_DURABLE_RECONCILIATION_REQUIRED',{cause})
 error.operation_id=op.id
 throw error
}

export async function durableImageStage({id,snapshot,bytes,store,remote,gate,recoveryApproval}) {
 const journal=store.operations,digest=fingerprintBytes(bytes)
 const approvedSnapshot=fingerprint(snapshot)
 const op=await journal.begin({kind:'STAGE',op_key:'STAGE:'+gate.key,key:gate.key,request_id:id,
  fingerprint:fingerprint({key:gate.key,digest,consent:snapshot.evidence.approved_at}),digest,approval:recoveryApproval})
 try {
  if(op.state!=='DONE')await journal.assert(op)
  const found=await remote.headPrivate(gate.key)
  if(found && (found.sha256!==digest||found.bytes!==bytes.length))throw Error('OBJECT_MISMATCH')
  if(!found) {
   // A previously completed write disappearing is never permission to recreate
   // it. A tombstone, manual erasure or unknown external actor requires review.
   if(op.state==='DONE')throw Error('OBJECT_DISAPPEARED')
   // A negative HEAD does not prove that an earlier request cannot still commit.
   // Never issue a second PUT for an uncertain operation, even after takeover.
   if(op.recovered)throw Error('REMOTE_ABSENCE_STILL_UNCERTAIN')
   await journal.assert(op)
   await remote.putPrivate(gate.key,bytes)
  }
  const verified=await remote.headPrivate(gate.key)
  if(!verified||verified.sha256!==digest||verified.bytes!==bytes.length||!verified.etag)throw Error('OBJECT_UNVERIFIED')
  if(op.state!=='DONE')await journal.checkpoint(op,'object',verified)
  const current=await store.loadSnapshot(id)
  // Request/mapping checks already run in the caller, but must also hold after
  // a remote write and before the atomic DB receipt.
  if(fingerprint(current)!==approvedSnapshot)throw Error('APPROVAL_CHANGED')
  if(op.state!=='DONE')await journal.finish(op)
  return {output_bytes:bytes.length,output_sha256:digest,reconciled:Boolean(found)}
 }catch(error) {return holdUncertain(journal,op,error)}
}
export const fingerprintBytes=bytes=>createHash('sha256').update(bytes).digest('hex')
