/**
 * AMPHON SEO Draft PR executor — pure policy + dependency-injected workflow.
 * This module cannot merge, push to production branches, or deploy.
 * No HTTP/DB work is performed on import.
 */
import { createHash } from 'node:crypto'

const SHA = /^[a-f0-9]{40}$/i
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const REPO = /^[\w.-]+\/[\w.-]+$/
const CONTENT_PATH = /^(?:src\/(?:pages|content|components|layouts)\/|(?:content|pages)\/)[A-Za-z0-9_./-]+\.(?:astro|md|mdx|html)$/
const APPROVED = 'APPROVED_FOR_DRAFT_PR'
const SPEC = 'amphon.seo.literal-edits.v1'
const fail = message => { throw Error('SEO_DRAFT_PR_' + message) }
const nowValid = (date, days, now) => {
  const ms = Date.parse(date)
  if (!Number.isFinite(ms)) return false
  const age = now.getTime() - ms
  return age >= -60_000 && age <= days * 86_400_000
}
export function isAllowedContentPath(path) {
  if (typeof path !== 'string' || path.length > 220 || !CONTENT_PATH.test(path) ||
      path.includes('//') || path.includes('\\')) return false
  return path.split('/').every(part => part !== '.' && part !== '..' && !part.startsWith('.') && !part.startsWith('-'))
}
export function validateApprovedPatch(request) {
  let spec
  try { spec = JSON.parse(request.proposed_change) } catch { fail('STRUCTURED_PATCH_REQUIRED') }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) ||
      Object.keys(spec).sort().join(',') !== 'edits,schema' || spec.schema !== SPEC ||
      !Array.isArray(spec.edits) || spec.edits.length === 0 || spec.edits.length > 8)
    fail('STRUCTURED_PATCH_REQUIRED')
  const paths = request.requested_paths
  if (!Array.isArray(paths) || paths.length !== spec.edits.length ||
      new Set(paths).size !== paths.length ||
      !paths.every((path,index)=>spec.edits[index]?.path===path)) fail('PATH_SET_MISMATCH')
  const edits = spec.edits.map(edit => {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit) ||
        Object.keys(edit).sort().join(',') !== 'expected_blob_sha,find,path,replace')
      fail('UNDECLARED_EDIT_FIELD')
    const { path, find, replace, expected_blob_sha } = edit
    if (!isAllowedContentPath(path) || !paths.includes(path)) fail('UNSAFE_PATH')
    if (!SHA.test(expected_blob_sha ?? '')) fail('INVALID_BLOB_SHA')
    if (typeof find !== 'string' || find.length < 8 || find.length > 4000 ||
        typeof replace !== 'string' || replace.length < 8 || replace.length > 5000 ||
        find === replace) fail('INVALID_LITERAL_REPLACEMENT')
    return { path, find, replace, expected_blob_sha: expected_blob_sha.toLowerCase() }
  })
  if (new Set(edits.map(e => e.path)).size !== edits.length) fail('DUPLICATE_EDIT')
  return edits
}
export function verifyApprovedSourceSnapshot(data, now = new Date()) {
  const { request:r, site, project, job, evidence, receipt, keyword, existingRun } = data
  if (!r || !UUID.test(r.id ?? '')) fail('BAD_REQUEST_ID')
  if (existingRun) return { existing:true, record:existingRun }
  if (r.status !== APPROVED || !UUID.test(r.reviewed_by ?? '') || !nowValid(r.reviewed_at,30,now))
    fail('OWNER_APPROVAL_REQUIRED')
  if (!site?.enabled || r.site_id !== site.id || project?.site_id !== site.id ||
      project.mapping_status !== 'VERIFIED' || project.production_repo !== r.target_repository ||
      project.production_branch !== r.target_branch || !REPO.test(r.target_repository ?? '') ||
      r.target_repository.split('/').some(part=>part==='.'||part==='..') ||
      !/^[a-zA-Z0-9._/-]{1,120}$/.test(r.target_branch ?? ''))
    fail('VERIFIED_REPO_MAPPING_REQUIRED')
  if (!SHA.test(r.expected_base_sha ?? '')) fail('INVALID_BASE_SHA')
  if (!job || job.id !== r.job_id || job.site_id !== r.site_id ||
      job.page !== r.target_page || job.focus_query !== r.focus_query ||
      job.status === 'DISMISSED' || job.evidence_id !== r.evidence_id)
    fail('JOB_CHANGED')
  let target, origin
  try {
    target = new URL(r.target_page)
    origin = new URL(site.origin)
  } catch { fail('PAGE_URL_INVALID') }
  if (target.protocol !== 'https:' || target.origin !== origin.origin ||
      target.search || target.hash || target.username || target.password) fail('PAGE_ORIGIN_MISMATCH')
  if (!evidence || evidence.id !== r.evidence_id || evidence.job_id !== r.job_id ||
      evidence.source_url !== r.target_page || !nowValid(evidence.source_at,30,now))
    fail('PAGE_EVIDENCE_STALE')
  if (!keyword || keyword.approval_status !== 'APPROVED' ||
      keyword.site_id !== r.site_id || keyword.keyword !== r.focus_query ||
      (keyword.target_page && keyword.target_page !== r.target_page))
    fail('KEYWORD_NOT_APPROVED')
  if (!receipt || receipt.id !== r.gsc_receipt_id || receipt.actor !== r.requested_by ||
      receipt.site_id !== r.site_id || !nowValid(receipt.created_at,7,now) ||
      receipt.query_request?.query !== r.focus_query ||
      receipt.query_request?.page !== r.target_page)
    fail('GSC_RECEIPT_MISMATCH')
  if (typeof r.request_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(r.request_fingerprint))
    fail('MISSING_AUDIT_FINGERPRINT')
  return { existing:false, edits:validateApprovedPatch(r) }
}
export function literalReplace(source, edit) {
  if (typeof source !== 'string' || source.length > 250_000 || source.includes('\0')) fail('UNSAFE_FILE_CONTENT')
  const i = source.indexOf(edit.find)
  if (i < 0 || source.indexOf(edit.find, i + edit.find.length) !== -1) fail('NOT_EXACTLY_ONE_MATCH')
  const next = source.slice(0,i) + edit.replace + source.slice(i + edit.find.length)
  if (next === source || next.length > 250_000) fail('NO_CHANGE_OR_FILE_TOO_LARGE')
  return next
}
export function deterministicBranch(id) {
  if (!UUID.test(id ?? '')) fail('BAD_REQUEST_ID')
  return 'seo/owner-reviewed-' + id.toLowerCase()
}
export function draftPrBody(data, edits) {
  const r = data.request
  return [
    '## AMPHON SEO — Owner-approved source proposal',
    'Source Change Request: ' + r.id,
    'Target URL: ' + r.target_page,
    'Focus query: ' + r.focus_query,
    'Base Commit: ' + r.expected_base_sha,
    'Change Kind: ' + r.change_kind,
    'Files: ' + edits.map(e=>e.path).join(', '),
    '',
    '### Rationale',
    r.rationale,
    '',
    '### Acceptance gates (no auto-merge/deploy)',
    '- [ ] Verify content accuracy and actual trade evidence',
    '- [ ] CI + SEO regression passed',
    '- [ ] Check canonical, redirects, sitemap and internal links',
    '- [ ] Owner reviews exact diff and approves release separately',
    '',
    'This PR was created as DRAFT only. Approval of the source proposal is not approval to merge or deploy.',
  ].join('\n')
}
/**
 * transport must expose:
 * store.loadSnapshot(requestId), store.recordRun(record);
 * github.getBranchHead(repo,branch), github.getFile(repo,path,sha),
 * github.getBranchRef(repo,branch), github.getCommitTree(repo,sha),
 * github.createTree(repo,baseTree,entries), github.createCommit(repo,tree,base,body),
 * github.createBranch(repo,branch,commit), github.createDraftPr(repo,payload).
 */
export async function executeApprovedDraftPr(requestId, { store, github, dryRun=true, now=new Date() }) {
  if (!UUID.test(requestId ?? '')) fail('BAD_REQUEST_ID')
  const snapshot = await store.loadSnapshot(requestId)
  const validated = verifyApprovedSourceSnapshot(snapshot, now)
  if (validated.existing) return {
    outcome:'ALREADY_RECORDED',pr_url:validated.record.pr_url,
    request_id:requestId,performed_write:false,
  }
  const r = snapshot.request
  const branch = deterministicBranch(r.id)
  const currentHead = await github.getBranchHead(r.target_repository, r.target_branch)
  if (!SHA.test(currentHead ?? '') || currentHead.toLowerCase() !== r.expected_base_sha.toLowerCase())
    fail('PRODUCTION_BASE_SHA_MOVED')
  if (await github.getBranchRef(r.target_repository, branch)) fail('BRANCH_ALREADY_EXISTS_RECONCILE')
  const editedFiles = []
  for (const edit of validated.edits) {
    const file = await github.getFile(r.target_repository, edit.path, currentHead)
    if (!file || file.type !== 'file' || file.size > 250_000 ||
        file.blob_sha?.toLowerCase() !== edit.expected_blob_sha) fail('SOURCE_BLOB_MISMATCH')
    editedFiles.push({ path:edit.path,content:literalReplace(file.content,edit) })
  }
  const normalizedDigest=createHash('sha256').update(JSON.stringify(
    editedFiles.map(({path,content})=>({path,digest:createHash('sha256').update(content).digest('hex')}))
  )).digest('hex')
  const common={
    request_id:r.id,site_id:r.site_id,repository:r.target_repository,
    target_branch:r.target_branch,base_commit_sha:currentHead,
    draft_branch:branch,change_sha256:normalizedDigest,changed_paths:editedFiles.map(f=>f.path),
  }
  if (dryRun) return {
    outcome:'DRY_RUN_VALIDATED',performed_write:false,
    ...common,changed_file_count:editedFiles.length,
    source_patch_authorized:true,production_deploy_authorized:false,
  }
  // No external write occurs until every URL, role, evidence, SHA and edit has passed.
  const baseTree = await github.getCommitTree(r.target_repository, currentHead)
  if (!SHA.test(baseTree ?? '')) fail('INVALID_BASE_TREE')
  const newTree = await github.createTree(r.target_repository,baseTree,editedFiles)
  const newCommit = await github.createCommit(
    r.target_repository,newTree,currentHead,'seo: approved change request ' + r.id,
  )
  // Compare-and-stop on a changed production branch; never force-push.
  if (await github.getBranchHead(r.target_repository,r.target_branch) !== currentHead)
    fail('PRODUCTION_BASE_SHA_MOVED_DURING_PREPARE')
  await github.createBranch(r.target_repository,branch,newCommit)
  const pr = await github.createDraftPr(r.target_repository,{
    title:'seo: '+r.summary.slice(0,90),
    head:branch,base:r.target_branch,draft:true,
    body:draftPrBody(snapshot,validated.edits),
  })
  if (!pr?.draft || !Number.isInteger(pr.number) ||
      pr.url!==('https://github.com/'+r.target_repository+'/pull/'+pr.number))
    fail('DRAFT_PR_RECEIPT_INVALID_RECONCILE')
  // A database write failure after GitHub succeeds needs reconciliation: branch
  // existence prevents a second auto-create on retry.
  await store.recordRun({
    ...common,pr_number:pr.number,pr_url:pr.url,pr_head_sha:newCommit,
    created_at:new Date().toISOString(),
  })
  return {
    outcome:'DRAFT_PR_CREATED',performed_write:true,
    ...common,pr_number:pr.number,pr_url:pr.url,
    production_deploy_authorized:false,
  }
}
