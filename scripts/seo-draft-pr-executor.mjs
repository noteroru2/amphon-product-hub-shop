#!/usr/bin/env node
/**
 * Explicitly invoked, on-demand AMPHON SEO Draft PR executor.
 * Default: dry-run. This is NOT a cron job, GitHub Action execution step,
 * automatic deployment hook, or privilege in ChatGPT's OAuth MCP.
 *
 * Required env:
 *   AMPHON_SEO_SUPABASE_URL
 *   AMPHON_SEO_SERVICE_ROLE_KEY (server only; never expose in Vite)
 *   AMPHON_SEO_GITHUB_TOKEN (fine-grained Contents write + PR write to ONE target repo)
 *
 * Execute syntax:
 *   node scripts/seo-draft-pr-executor.mjs --request-id <uuid> --dry-run
 *   node scripts/seo-draft-pr-executor.mjs --request-id <uuid> --execute --owner-authorized
 */
import { pathToFileURL } from 'node:url'
import { executeApprovedDraftPr } from './seo-draft-pr-executor-core.mjs'
import { reconcileApprovedDraftPr } from './seo-draft-pr-reconcile.mjs'
import { githubAdapter, supabaseStore } from './seo-draft-pr-executor-adapters.mjs'

export function parseCli(argv) {
  const params={requestId:null,dryRun:true,authorized:false,reconcile:false}
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--request-id'&&argv[i+1])params.requestId=argv[++i]
    else if(argv[i]==='--dry-run')params.dryRun=true
    else if(argv[i]==='--execute')params.dryRun=false
    else if(argv[i]==='--owner-authorized')params.authorized=true
    else if(argv[i]==='--reconcile')params.reconcile=true
    else throw Error('SEO_DRAFT_PR_INVALID_CLI_ARGUMENT')
  }
  if(!params.requestId)throw Error('SEO_DRAFT_PR_REQUEST_ID_REQUIRED')
  if(!params.dryRun && !params.authorized)throw Error('SEO_DRAFT_PR_OWNER_EXECUTION_FLAG_REQUIRED')
  return params
}
export async function runCli(argv=process.argv.slice(2),env=process.env) {
  const params=parseCli(argv)
  const store=supabaseStore({
    url:env.AMPHON_SEO_SUPABASE_URL,
    key:env.AMPHON_SEO_SERVICE_ROLE_KEY,
  })
  const github=githubAdapter(env.AMPHON_SEO_GITHUB_TOKEN)
  const command=params.reconcile?reconcileApprovedDraftPr:executeApprovedDraftPr
  const result=await command(params.requestId,{
    store,github,dryRun:params.dryRun,
  })
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().then(result=>{
    // This output contains only IDs, commit hashes, reviewed paths and PR URL.
    // Never print credentials or raw source files.
    console.log(JSON.stringify(result,null,2))
  }).catch(err=>{
    console.error(err instanceof Error?err.message:'SEO_DRAFT_PR_UNKNOWN_ERROR')
    process.exitCode=1
  })
}
