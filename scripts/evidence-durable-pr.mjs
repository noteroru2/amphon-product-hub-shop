import {fingerprint,holdUncertain} from './evidence-operation-journal.mjs'
export async function durableDraftPr({id,snapshot,cfg,store,github,branch,applyCase}) {
 const journal=store.operations
 let op=await journal.begin({kind:'PR',op_key:'PR:'+id,key:snapshot.request.private_media_key,
  request_id:id,fingerprint:fingerprint(snapshot),approval:store.recoveryApproval})
 const expected=snapshot.expected_base_sha
 const recheck=async()=>{
  if(fingerprint(await store.loadSnapshot(id))!==fingerprint(snapshot))throw Error('AUTHORIZATION_CHANGED')
  await journal.assert(op)
  if(await github.getBranchHead(cfg.repo,cfg.base)!==expected)throw Error('BASE_CHANGED')
 }
 const save=async(phase,value)=>{op=await journal.checkpoint(op,phase,value);return value}
 const step=async(phase,action)=>{
  if(op.checkpoints[phase])return op.checkpoints[phase]
  await recheck()
  return save(phase,await action())
 }
 try {
  await recheck()
  const file=await github.getFile(cfg.repo,cfg.sourcePath,expected)
  if(!file||file.type!=='file'||file.size>250000)throw Error('SOURCE_INVALID')
  const content=applyCase(file.content,cfg.anchor,id,cfg.draftText)
  if(!op.checkpoints.target)await save('target',{repo:cfg.repo,base:cfg.base,branch,
   sourcePath:cfg.sourcePath,baseSha:expected,content_sha256:fingerprint(content)})
  const existing=await github.getBranchRef(cfg.repo,branch)
  if(existing&&!op.checkpoints.commit)throw Error('UNOWNED_BRANCH')
  const pulls=await github.getPullsForHead(cfg.repo,branch,cfg.base)
  if(!Array.isArray(pulls)||pulls.length>1)throw Error('AMBIGUOUS_PULLS')
  const overlaps=await github.getOverlappingOpenPrs(cfg.repo,cfg.sourcePath)
  if(!Array.isArray(overlaps)||overlaps.some(p=>p.number!==pulls[0]?.number))throw Error('OVERLAPPING_PULL')
  const tree=await step('tree',async()=>github.createTree(cfg.repo,
   await github.getCommitTree(cfg.repo,expected),[{path:cfg.sourcePath,content}]))
  const commit=await step('commit',()=>github.createCommit(cfg.repo,tree,expected,
   'seo(evidence): reviewed text-only case '+id,op.created_at))
  if(existing&&existing!==commit)throw Error('BRANCH_CHANGED')
  if(!existing)await step('branch',async()=>{await github.createBranch(cfg.repo,branch,commit);return commit})
  else if(!op.checkpoints.branch)await save('branch',commit)
  if(await github.getBranchRef(cfg.repo,branch)!==commit)throw Error('BRANCH_UNVERIFIED')
  const review=await github.getCommitReview(cfg.repo,commit)
  const next=await github.getFile(cfg.repo,cfg.sourcePath,commit)
  if(review?.parents?.length!==1||review.parents[0].sha!==expected||review.changedFiles?.length!==1||
    review.changedFiles[0].filename!==cfg.sourcePath||next?.content!==content)throw Error('COMMIT_UNVERIFIED')
  const validate=p=>{
   if(!p||p.state!=='open'||p.draft!==true||p.merged_at||p.head?.sha!==commit||p.head?.ref!==branch||
     p.base?.ref!==cfg.base||p.head?.repo?.full_name!==cfg.repo||p.base?.repo?.full_name!==cfg.repo||
     !Number.isInteger(p.number)||p.html_url!=='https://github.com/'+cfg.repo+'/pull/'+p.number)
    throw Error('PR_UNVERIFIED')
   return {draft:true,number:p.number,url:p.html_url}
  }
  if(!pulls.length) {
   if(op.checkpoints.pr)throw Error('PR_DISAPPEARED')
   await recheck()
   await github.createDraftPr(cfg.repo,{head:branch,base:cfg.base,draft:true,
    title:'[DRAFT][NO DEPLOY] Reviewed evidence case '+id.slice(0,8),
    body:'Evidence request: '+id+'\nText only. No public media. Separate owner approval required for merge/deploy.'})
  }
  const observed=await github.getPullsForHead(cfg.repo,branch,cfg.base)
  if(!Array.isArray(observed)||observed.length!==1)throw Error('PR_NOT_UNIQUE')
  const pr=validate(observed[0])
  await save('pr',pr)
  await recheck()
  await journal.finish(op) // Atomically writes queue receipt + DONE + releases reservation.
  return {outcome:pulls.length?'DRAFT_PR_RECOVERED':'DRAFT_PR_CREATED',request_id:id,
   pr_url:pr.url,pr_number:pr.number,draft_sha:commit,media_public:false,
   production_deploy_authorized:false,performed_write:true}
 }catch(error) {return holdUncertain(journal,op,error)}
}
