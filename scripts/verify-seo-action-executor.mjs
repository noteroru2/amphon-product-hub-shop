import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const [migration, gateway, client, center] = await Promise.all([
  read('supabase/migrations/20260926060000_seo_action_executor.sql'),
  read('supabase/functions/seo-action-executor/index.ts'),
  read('src/lib/seoOpportunities.ts'),
  read('src/components/SeoOpportunityCenter.tsx'),
])

const checks = [
  ['executor queue has explicit risk modes', migration.includes("'AUTO_DEPLOY','PR_ONLY','HUMAN_REVIEW','PROTECT','OBSERVE'")],
  ['safe link auto-deploy requires diagnostic guard', migration.includes("auto_safe_internal_link") && migration.includes("requires_human_review") && migration.includes("'AUTO_DEPLOY'")],
  ['recovery is human-reviewed', migration.includes("when e.action_type='RECOVERY_PLAN' then 'HUMAN_REVIEW'")],
  ['protect is non-mutating', migration.includes("when e.action_type='PROTECT_PAGE' then 'PROTECT'") && migration.includes("mutation forbidden")],
  ['Git evidence is mandatory before apply', migration.includes('EXECUTOR_GIT_EVIDENCE_REQUIRED') && migration.includes('base_commit_sha') && migration.includes('rollback_commit_sha') && migration.includes('diff_sha256')],
  ['live verification is mandatory before applied', migration.includes('EXECUTOR_LIVE_VERIFICATION_REQUIRED')],
  ['meta requires PR evidence', migration.includes('EXECUTOR_PR_EVIDENCE_REQUIRED')],
  ['gateway validates GitHub OIDC identity', gateway.includes('token.actions.githubusercontent.com') && gateway.includes('workflow_ref') && gateway.includes("repository !== allowedRepository")],
  ['gateway keeps admin key server-side', gateway.includes('SUPABASE_SECRET_KEYS') && !client.includes('SUPABASE_SECRET_KEYS')],
  ['Hub keeps applied evidence visible', client.includes("'APPLIED']") && client.includes("commerce_gsc_executor_jobs")],
  ['Hub renders risk and rollback evidence', center.includes('SEO Action Executor') && center.includes('Rollback') && center.includes('Diff SHA') && center.includes('ตรวจ PR')],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
if (failed.length) {
  console.error(`SEO ACTION EXECUTOR verification failed: ${failed.map(([label]) => label).join(', ')}`)
  process.exit(1)
}
console.log('SEO ACTION EXECUTOR PASS — risk gates, OIDC, Git evidence and live verification protected')
