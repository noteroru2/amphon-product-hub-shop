#!/usr/bin/env node
/** Fail-closed GitHub Environment read-only preflight before any Actions write.
 * Does not create environments, secrets, branches, PRs, or deployments.
 */
import {pathToFileURL} from 'node:url'
const must=condition=>{if(!condition)throw Error('EVIDENCE_ENV_PROTECTION_REQUIRED')}
export function assertProtectedEvidenceEnvironment(input) {
 must(input?.name==='evidence-draft-pr-protected')
 const reviewers=(input.protection_rules||[]).filter(x=>x?.type==='required_reviewers')
 must(reviewers.length===1)
 must(Array.isArray(reviewers[0]?.reviewers)&&reviewers[0].reviewers.length>0)
 must(reviewers[0].reviewers.every(x=>x?.type==='User'||x?.type==='Team'))
 must(reviewers[0].prevent_self_review===true)
 must(input.can_admins_bypass===false)
 return {protected:true,reviewer_count:reviewers[0].reviewers.length}
}
export async function checkEvidenceEnvironment({
 repo,token,fetchImpl=fetch
}={}){
 must(repo==='noteroru2/amphon-product-hub-shop')
 must(typeof token==='string'&&token.length>10)
 const response=await fetchImpl(
  'https://api.github.com/repos/noteroru2/amphon-product-hub-shop/environments/evidence-draft-pr-protected',
  {headers:{accept:'application/vnd.github+json',
    authorization:'Bearer '+token,
    'x-github-api-version':'2022-11-28',
    'user-agent':'amphon-evidence-environment-preflight'},
   redirect:'error',signal:AbortSignal.timeout(15000)}
 )
 must(response.ok)
 return assertProtectedEvidenceEnvironment(await response.json())
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 checkEvidenceEnvironment({repo:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN})
   .then(x=>console.log('PROTECTED_ENV_READY reviewers='+x.reviewer_count))
   .catch(()=>{console.error('EVIDENCE_ENV_PROTECTION_REQUIRED');process.exitCode=1})
}
