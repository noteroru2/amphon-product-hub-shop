/** Owner-quiescent READ-ONLY remote reconciliation. Never uploads, creates a PR,
 * deletes an object/branch, or turns revoked consent into a queue success.
 */
import {fingerprint,holdUncertain} from './evidence-operation-journal.mjs'
export async function reconcileEvidenceOperation({opKey,approval,store,remote,github}) {
 const journal=store.operations,original=await journal.lookup(opKey)
 if(!original)throw Error('EVIDENCE_OPERATION_MISSING')
 if(original.state==='DONE'||original.state==='BLOCKED')return {outcome:'ALREADY_TERMINAL',state:original.state}
 const op=await journal.begin({op_key:original.op_key,kind:original.kind,key:original.key,request_id:original.request_id,
  fingerprint:original.fingerprint,digest:original.digest,approval})
 try {
  if(op.kind==='STAGE') {
   const head=await remote.headPrivate(op.key)
   if(!head)throw Error('REMOTE_ABSENCE_STILL_UNCERTAIN')
   if(head.sha256!==op.digest||!head.etag)throw Error('OBJECT_CHANGED')
   await journal.checkpoint(op,'object',head)
  }else if(op.kind==='PR') {
   const t=op.checkpoints.target,commit=op.checkpoints.commit
   if(!t||!commit)throw Error('TARGET_PROOF_MISSING')
   const branch=await github.getBranchRef(t.repo,t.branch)
   const pulls=await github.getPullsForHead(t.repo,t.branch,t.base)
   if(!Array.isArray(pulls)||pulls.length>1||branch!==commit)throw Error('PR_PROOF_CHANGED')
   if(!pulls.length){await journal.checkpoint(op,'absent',true);await journal.abandon(op);return {outcome:'NO_PR_BRANCH_REQUIRES_OWNER_REVIEW'}}
   const p=pulls[0],file=await github.getFile(t.repo,t.sourcePath,commit),review=await github.getCommitReview(t.repo,commit)
   if(p.state!=='open'||!p.draft||p.merged_at||p.head?.sha!==commit||p.head?.ref!==t.branch||p.base?.ref!==t.base||
    p.head?.repo?.full_name!==t.repo||p.base?.repo?.full_name!==t.repo||!Number.isInteger(p.number)||
    p.html_url!=='https://github.com/'+t.repo+'/pull/'+p.number||fingerprint(file?.content)!==t.content_sha256||
    review?.parents?.length!==1||review.parents[0].sha!==t.baseSha||review.changedFiles?.length!==1||review.changedFiles[0].filename!==t.sourcePath)
    throw Error('PR_PROOF_CHANGED')
   await journal.checkpoint(op,'pr',{draft:true,number:p.number,url:p.html_url})
  }else throw Error('USE_GATED_CLEANUP_RECOVERY')
  const result=await journal.finalize(op)
  return {outcome:result.authorization_valid===false?'REMOTE_EFFECT_RECONCILED_AUTHORIZATION_BLOCKED':'REMOTE_EFFECT_RECONCILED',state:result.state}
 }catch(error){return holdUncertain(journal,op,error)}
}
