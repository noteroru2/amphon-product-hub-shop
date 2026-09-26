import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const [migration, rollbackMigration, rollbackClaimHotfix, safetyMigration, learningMigration, recoveryHotfixV2, gateway, client, center] = await Promise.all([
  read('supabase/migrations/20260926060000_seo_action_executor.sql'),
  read('supabase/migrations/20260926161000_seo_auto_rollback_executor.sql'),
  read('supabase/migrations/20260926162500_seo_auto_rollback_claim_hotfix.sql'),
  read('supabase/migrations/20260926163000_seo_measurement_page_lock_budget.sql'),
  read('supabase/migrations/20260926171000_seo_learning_recovery_measurement.sql'),
  read('supabase/migrations/20260926172500_seo_recovery_measurement_alias_hotfix_v2.sql'),
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
  ['REGRESSED measurement automatically queues rollback', rollbackMigration.includes("m.verdict <> 'REGRESSED'") && rollbackMigration.includes('commerce_gsc_measurement_auto_rollback')],
  ['automatic rollback requires exact Git evidence', rollbackMigration.includes('original_commit_sha') && rollbackMigration.includes('rollback_point_sha') && rollbackMigration.includes('changed_files')],
  ['rollback completion requires live verification', rollbackMigration.includes('ROLLBACK_LIVE_VERIFICATION_REQUIRED')],
  ['rollback never resumes monitoring after success', rollbackMigration.includes("monitor_status=case when p_outcome='ROLLED_BACK' then 'STOPPED'")],
  ['rollback RPCs are service-role only', rollbackMigration.includes('claim_gsc_rollback_jobs') && rollbackMigration.includes('finish_gsc_rollback_job') && rollbackMigration.includes('to service_role')],
  ['rollback claim uses a cross-statement lease token', rollbackClaimHotfix.includes('v_claim_token') && rollbackClaimHotfix.includes('r.lease_token=v_claim_token')],
  ['gateway exposes rollback claim/finish to GitHub OIDC only', gateway.includes("operation === 'rollback_claim'") && gateway.includes("operation === 'rollback_finish'")],
  ['Hub exposes automatic rollback lifecycle', client.includes('rollbackActualCommitSha') && center.includes('Auto Rollback') && center.includes("execution.rollbackStatus !== 'NONE'")],
  ['measurement integrity uses aligned primary query snapshots', safetyMigration.includes('baseline_query_impressions') && safetyMigration.includes("lower(d.query)=lower(e.primary_query)") && !safetyMigration.includes('commerce_gsc_opportunity_v o')],
  ['measurement integrity blocks rollback on bad evidence', safetyMigration.includes("'INSUFFICIENT_DATA'") && safetyMigration.includes("'STALE_SOURCE'") && safetyMigration.includes("'LOW_CURRENT_SAMPLE'") && safetyMigration.includes('v_integrity=\'BLOCKED\'')],
  ['query mix and traffic anomaly guards are enforced', safetyMigration.includes("'QUERY_MIX_SHIFT'") && safetyMigration.includes("'TRAFFIC_ANOMALY'")],
  ['page experiment lock is enforced with hard unique backstop', safetyMigration.includes("'PAGE_EXPERIMENT_LOCK'") && safetyMigration.includes('commerce_gsc_active_page_experiment_uidx')],
  ['action budget is rolling 24h and configurable', safetyMigration.includes('max_actions_24h') && safetyMigration.includes("now()-interval '24 hours'") && safetyMigration.includes("'ACTION_BUDGET'")],
  ['executor claims are serialized and budget capped', safetyMigration.includes('pg_advisory_xact_lock') && safetyMigration.includes('v_remaining') && safetyMigration.includes('page_rank=1')],
  ['Hub exposes safety guards and integrity status', client.includes('guardCode') && client.includes('integrityStatus') && center.includes('Execution Safety Guard') && center.includes('Integrity {measurement.integrityStatus}')],
  ['rollback starts Recovery Measurement observation', learningMigration.includes("recovery_status='MONITORING'") && learningMigration.includes('Recovery Measurement 7/14/28d started')],
  ['recovery checkpoints are 7/14/28 with final 28d attribution', learningMigration.includes("checkpoint_days in (7,14,28)") && learningMigration.includes("'EARLY','PROVISIONAL','FINAL'") && learningMigration.includes("v_checkpoint := 28")],
  ['recovery evidence has its own integrity guard', learningMigration.includes('NO_VALID_REGRESSION_TRIGGER') && learningMigration.includes('LOW_POST_ROLLBACK_EXPOSURE') && learningMigration.includes('Recovery Integrity BLOCKED')],
  ['recovery keeps page locked until causal observation completes', learningMigration.includes("e.recovery_status='MONITORING'") && learningMigration.includes('post-rollback Recovery Measurement') && learningMigration.includes('recovery_lock_until')],
  ['recovery hard-stop releases permanent locks safely', recoveryHotfixV2.includes("recovery_status='BLOCKED'") && recoveryHotfixV2.includes('hard-stop reached') && recoveryHotfixV2.includes('x.recovery_status')],
  ['Learning Ledger stores per-experiment causal evidence', learningMigration.includes('commerce_gsc_learning_ledger') && learningMigration.includes('BENEFIT_CONFIRMED') && learningMigration.includes('HARM_CONFIRMED')],
  ['Learning Ledger confidence is maturity weighted', learningMigration.includes("when 'HIGH' then 1.0") && learningMigration.includes("when 'MEDIUM' then 0.6") && learningMigration.includes("when 'LOW' then 0.3")],
  ['Learning summary aggregates action priors without auto-applying them', learningMigration.includes('commerce_gsc_learning_summary_v') && learningMigration.includes('learning_score')],
  ['Hub exposes Recovery Measurement and Learning Ledger', client.includes('SeoRollbackRecoveryMeasurement') && client.includes('SeoLearningLedger') && center.includes('Rollback Recovery Measurement') && center.includes('SEO Learning Ledger')],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
if (failed.length) {
  console.error(`SEO ACTION EXECUTOR verification failed: ${failed.map(([label]) => label).join(', ')}`)
  process.exit(1)
}
console.log('SEO ACTION EXECUTOR PASS — safety guards, rollback recovery measurement and learning ledger protected')
