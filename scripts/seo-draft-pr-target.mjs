#!/usr/bin/env node
/**
 * Read-only resolver for the operator-approved GitHub Actions workflow.
 * It resolves a target repository from the OWNER-approved DB request; never
 * trusts the workflow-dispatch caller to select arbitrary repositories.
 */
import { pathToFileURL } from 'node:url'
import { supabaseStore } from './seo-draft-pr-executor-adapters.mjs'
import { verifyApprovedSourceSnapshot } from './seo-draft-pr-executor-core.mjs'

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export async function resolveApprovedTarget(id, store, now = new Date(), {reconcile=false}={}) {
  if (!UUID.test(id??'')) throw Error('SEO_DRAFT_PR_BAD_REQUEST_ID')
  const data=await store.loadSnapshot(id)
  const review=verifyApprovedSourceSnapshot({...data,existingRun:reconcile?null:data.existingRun},now)
  if(review.existing)throw Error('SEO_DRAFT_PR_ALREADY_RECORDED')
  const repo=data.request.target_repository
  const parts=repo.split('/')
  if(parts.length!==2||
     !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(parts[0])||
     !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1])||
     parts[1]==='.'||parts[1]==='..'||parts[1].startsWith('-'))
    throw Error('SEO_DRAFT_PR_INVALID_TARGET_REPOSITORY')
  return {owner:parts[0],repository:parts[1]}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  ;(async()=>{
    const reconcile=process.argv.length===5&&process.argv[4]==='--reconcile'
    if((process.argv.length!==4&&!reconcile)||process.argv[2]!=='--request-id')
      throw Error('SEO_DRAFT_PR_USAGE_REQUEST_ID_REQUIRED')
    const store=supabaseStore({
      url:process.env.AMPHON_SEO_SUPABASE_URL,
      key:process.env.AMPHON_SEO_SERVICE_ROLE_KEY,
    })
    const value=await resolveApprovedTarget(process.argv[3],store,new Date(),{reconcile})
    // Only validated GitHub owner/repository strings are emitted; never secrets.
    process.stdout.write('owner='+value.owner+'\nrepository='+value.repository+'\n')
  })().catch(err=>{
    console.error(err instanceof Error?err.message:'SEO_DRAFT_PR_TARGET_ERROR')
    process.exitCode=1
  })
}
