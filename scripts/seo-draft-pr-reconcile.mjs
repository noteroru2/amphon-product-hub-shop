/**
 * Operator-only recovery for GitHub Draft PR succeeded / Supabase receipt failed.
 * No GitHub writes, no PR creation, no merge/deploy. The only optional write is
 * an immutable receipt for an already existing, fully verified Draft PR.
 */
import { createHash } from 'node:crypto'
import {
  deterministicBranch, literalReplace, verifyApprovedSourceSnapshot,
} from './seo-draft-pr-executor-core.mjs'

const SHA=/^[a-f0-9]{40}$/i
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const stop=code=>{throw Error('SEO_DRAFT_PR_RECONCILE_'+code)}
const digestFiles=files=>createHash('sha256').update(JSON.stringify(
  files.map(({path,content})=>({
    path,digest:createHash('sha256').update(content).digest('hex'),
  })),
)).digest('hex')
const equalNames=(a,b)=>a.length===b.length&&
  [...a].sort().every((name,i)=>name===[...b].sort()[i])

export async function reconcileApprovedDraftPr(
  requestId,{store,github,dryRun=true,now=new Date()}={},
) {
  if(!UUID.test(requestId??''))stop('INVALID_REQUEST_ID')
  const snapshot=await store.loadSnapshot(requestId)
  const request=snapshot.request
  // Do not let an existing receipt bypass current Owner, site, GSC and
  // keyword checks. This is a recovery operation, not privilege elevation.
  const reviewed=verifyApprovedSourceSnapshot(
    {...snapshot,existingRun:null},now,
  )
  if(reviewed.existing||!reviewed.edits)stop('UNVERIFIED_APPROVAL')
  const repo=request.target_repository
  const branch=deterministicBranch(requestId)
  const baseSha=request.expected_base_sha.toLowerCase()
  const targetHead=await github.getBranchHead(repo,request.target_branch)
  if(targetHead?.toLowerCase()!==baseSha)stop('BASE_BRANCH_MOVED_MANUAL_REVIEW')
  const branchHead=await github.getBranchRef(repo,branch)
  if(!SHA.test(branchHead??'')||branchHead.toLowerCase()===baseSha)
    stop('DRAFT_BRANCH_MISSING_OR_UNCHANGED')
  const summary=await github.getCommitReview(repo,branchHead)
  if(summary.sha?.toLowerCase()!==branchHead.toLowerCase()||
     !Array.isArray(summary.parents)||summary.parents.length!==1||
     summary.parents[0]?.sha?.toLowerCase()!==baseSha)
    stop('COMMIT_PARENT_MISMATCH')
  const changed=summary.changedFiles
  if(!Array.isArray(changed)||changed.length!==reviewed.edits.length||
     changed.some(f=>f.status!=='modified'||typeof f.filename!=='string')||
     !equalNames(changed.map(f=>f.filename),reviewed.edits.map(e=>e.path)))
    stop('COMMIT_PATHS_MISMATCH')

  const expectedFiles=[]
  for (const edit of reviewed.edits) {
    const original=await github.getFile(repo,edit.path,baseSha)
    if(!original||original.type!=='file'||
       original.blob_sha?.toLowerCase()!==edit.expected_blob_sha||
       original.size>250_000)stop('ORIGINAL_BLOB_MISMATCH')
    const content=literalReplace(original.content,edit)
    const actual=await github.getFile(repo,edit.path,branchHead)
    if(!actual||actual.type!=='file'||actual.content!==content)
      stop('DRAFT_FILE_CONTENT_MISMATCH')
    expectedFiles.push({path:edit.path,content})
  }

  const pulls=await github.getPullsForHead(repo,branch,request.target_branch)
  if(!Array.isArray(pulls)||pulls.length!==1)stop('DRAFT_PR_NOT_UNIQUE')
  const pr=pulls[0]
  const exactUrl='https://github.com/'+repo+'/pull/'+pr.number
  if(!Number.isInteger(pr.number)||pr.number<1||pr.html_url!==exactUrl||
     pr.state!=='open'||pr.draft!==true||pr.merged_at!==null||
     pr.head?.sha?.toLowerCase()!==branchHead.toLowerCase()||
     pr.head?.ref!==branch||pr.head?.repo?.full_name!==repo||
     pr.base?.ref!==request.target_branch||pr.base?.repo?.full_name!==repo||
     typeof pr.body!=='string'||
     !pr.body.includes('Source Change Request: '+requestId)||
     !pr.body.includes('Base Commit: '+request.expected_base_sha))
    stop('DRAFT_PR_IDENTITY_MISMATCH')

  const meta={
    request_id:requestId,site_id:request.site_id,repository:repo,
    target_branch:request.target_branch,base_commit_sha:baseSha,
    draft_branch:branch,pr_number:pr.number,pr_url:exactUrl,
    pr_head_sha:branchHead.toLowerCase(),change_sha256:digestFiles(expectedFiles),
    changed_paths:reviewed.edits.map(e=>e.path),
  }
  const saved=snapshot.existingRun
  if(saved) {
    const fixedFields=[
      'request_id','site_id','repository','target_branch','base_commit_sha',
      'draft_branch','pr_number','pr_url','pr_head_sha','change_sha256',
    ]
    if(fixedFields.some(key=>saved[key]!==meta[key])||
       !Array.isArray(saved.changed_paths)||
       !equalNames(saved.changed_paths,meta.changed_paths))
      stop('RECORDED_RECEIPT_MISMATCH')
    return {outcome:'EXISTING_RECEIPT_VERIFIED',performed_write:false,
      request_id:requestId,pr_url:exactUrl,pr_number:pr.number,
      production_deployed:false}
  }
  if (dryRun) return {outcome:'RECONCILIATION_VALIDATED',performed_write:false,
    request_id:requestId,pr_number:pr.number,pr_url:exactUrl,
    pr_head_sha:meta.pr_head_sha,changed_paths:meta.changed_paths,
    production_deployed:false}
  await store.recordRun(meta)
  return {outcome:'AUDIT_RECEIPT_RECOVERED',performed_write:true,
    request_id:requestId,pr_number:pr.number,pr_url:exactUrl,
    pr_head_sha:meta.pr_head_sha,production_deployed:false}
}
