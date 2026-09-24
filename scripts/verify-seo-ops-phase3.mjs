import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const [migration, worker, shopApi, reviewPage, productPage, seoCenter, merchantCenter, trustCenter, app] = await Promise.all([
  read('../supabase/migrations/20260925003800_seo_ops_phase3_execute_measure_merchant_recovery_reviews.sql'),
  read('../workers/r2-upload/src/index.ts'),
  read('../shop/src/lib/store-api.ts'),
  read('../shop/src/pages/review/[token]/index.astro'),
  read('../shop/src/pages/p/[product].astro'),
  read('../src/components/SeoOpportunityCenter.tsx'),
  read('../src/components/MerchantDiagnosticsCenter.tsx'),
  read('../src/components/TrustReviewCenter.tsx'),
  read('../src/App.tsx'),
])

const checks = [
  ['execute/measure uses immutable baseline + 7/14/28 checkpoints', migration.includes('commerce_gsc_action_executions') && migration.includes('commerce_gsc_action_measurements') && migration.includes("checkpoint_days in (7,14,28)")],
  ['regression opens rollback review instead of auto rollback', migration.includes("'ROLLBACK_REVIEW'") && migration.includes('review the exact deployed patch before any rollback')],
  ['recovery engine checks Query×Page competition before auto link', migration.includes('commerce_gsc_recovery_diagnostics') && migration.includes('auto_safe_internal_link') && migration.includes('competing_page_count <= 1')],
  ['merchant diagnostics separates local feed from account connector', migration.includes('commerce_merchant_feed_diagnostics') && migration.includes('commerce_merchant_sync_state') && migration.includes('connected boolean not null default false')],
  ['merchant policy URLs are aligned to live Shop pages', migration.includes('https://shop.amphon.co.th/shipping/') && migration.includes('https://shop.amphon.co.th/returns/') && migration.includes('https://shop.amphon.co.th/warranty/')],
  ['review invite requires paid and completed order', migration.includes('o.completed_at is not null') && migration.includes('o.paid_at is not null') && migration.includes('ensure_commerce_review_invites')],
  ['reviews are single-use and pending before publication', migration.includes('REVIEW_INVITE_USED') && migration.includes("'PENDING','APPROVED','REJECTED'") && migration.includes("where r.status='APPROVED'")],
  ['public review Store API exposes only approved review view', worker.includes('commerce_public_reviews_v') && worker.includes('/store/reviews/submit') && worker.includes('/store/review-invites/')],
  ['review page is explicitly noindex and contains no customer/order PII', reviewPage.includes('robots="noindex,nofollow"') && !reviewPage.includes('customer_email') && !reviewPage.includes('customer_phone')],
  ['product page labels reviews as verified purchase only', productPage.includes('รีวิวจากผู้ซื้อจริง') && productPage.includes('ยืนยันจากคำสั่งซื้อ')],
  ['product page does not fabricate review schema', !productPage.includes('aggregateRating') && !productPage.includes("'@type': 'Review'")],
  ['Hub exposes measurement/recovery evidence', seoCenter.includes('Execute → Measure') && seoCenter.includes('Recovery Diagnosis')],
  ['Hub Merchant center exposes connector state and local feed preflight', merchantCenter.includes('Merchant Diagnostics') && merchantCenter.includes('Local Feed Preflight')],
  ['Hub Trust center states verified-only contract', trustCenter.includes('Verified-only เปิดอยู่') && trustCenter.includes('Paid + Completed')],
  ['owner Hub wires all phase-3 centers', app.includes('merchant-diagnostics') && app.includes('trust-reviews') && app.includes('seo-opportunities')],
  ['Shop API client supports review resolution and submission', shopApi.includes('resolveStoreReviewInvite') && shopApi.includes('submitStoreVerifiedReview') && shopApi.includes('listVerifiedProductReviews')],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
if (failed.length) {
  console.error(`SEO OPS PHASE 3 verification failed: ${failed.map(([label]) => label).join(', ')}`)
  process.exit(1)
}
console.log('SEO OPS PHASE 3 PASS — measure loop, Merchant diagnostics, Recovery and verified reviews are guarded')
