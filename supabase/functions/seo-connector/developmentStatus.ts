/**
 * Shared, deterministic SEO development readiness policy.
 * This is advisory only: never grants GitHub, content approval, or deploy rights.
 * The input is the already authenticated HUB portfolio response.
 */
export interface DevelopmentSite {
  id: string
  label: string
  origin: string
}
export interface DevelopmentProject {
  site_id: string
  mapping_status: string
  production_repo: string | null
  repo_candidates?: string[]
  central_deploy_allowed: boolean
}
export interface DevelopmentKeyword {
  site_id: string
  keyword: string
  approval_status: string
  role: string
  target_page?: string | null
}
export interface DevelopmentGscWindow {
  site_id: string
  window_days: number
  end_date: string
  dates_present: number
  provenance?: string | null
}
export interface DevelopmentIngest {
  site_id: string
  window_days: number
  end_date: string
  status: string
  data_complete: boolean
  rows_written: number
}
export interface DevelopmentRelease {
  site_id: string
  event_kind: string
  environment: string
  qa_status: string
  event_at: string
  commit_sha: string
  repository?: string
  release_proof?: {
    github_sha_verified: boolean
    route_verified: boolean
    live_response_verified: boolean
    live_verified_at: string | null
    deployment_id_present: boolean
  }
}
export interface DevelopmentPortfolio {
  sites: DevelopmentSite[]
  projects: DevelopmentProject[]
  roles: DevelopmentKeyword[]
  windows: DevelopmentGscWindow[]
  ingests: DevelopmentIngest[]
  releases: DevelopmentRelease[]
}
export type DevelopmentSiteStatus =
  | 'NEEDS_REPO_MAPPING'
  | 'NEEDS_KEYWORD_APPROVAL'
  | 'NEEDS_FINAL_GSC'
  | 'READY_FOR_PAGE_EVIDENCE'

export interface DevelopmentSiteReadiness {
  siteId: string
  label: string
  origin: string
  repository: string | null
  repositoryVerified: boolean
  approvedKeywordCount: number
  mappedKeywordCount: number
  selectedGscWindowDays: number
  gscWindowEnd: string | null
  gscReceiptConfirmed: boolean
  gscFresh: boolean
  readyForPageEvidence: boolean
  status: DevelopmentSiteStatus
  nextAction: string
  sourcePatchAuthorized: false
  automaticDeployAuthorized: false
  productionVerified: boolean
}
export type DevelopmentMilestoneState = 'COMPLETE' | 'PARTIAL' | 'PENDING_RELEASE' | 'PLANNED'
export interface DevelopmentMilestone {
  id: string
  name: string
  state: DevelopmentMilestoneState
  detail: string
}
const parseDay = (value: unknown): number => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
  const ms = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : NaN
}
const freshEnough = (value: string | undefined | null, asOf: Date, maxDays: number): boolean => {
  const timestamp = parseDay(value)
  const age = (asOf.getTime() - timestamp) / 86_400_000
  return Number.isFinite(age) && age >= -1 && age <= maxDays
}
// Same fail-closed live-origin/hosting SHA conditions as releaseMeasurement.
// An uncorroborated PRODUCTION_VERIFIED ledger label must never make this
// project milestone appear "COMPLETE" on its own.
const productionVerified = (
  records: DevelopmentRelease[], siteId: string,
  project: DevelopmentProject | undefined, now: Date,
): boolean => Boolean(project?.mapping_status === 'VERIFIED' &&
  project.production_repo && records.some(row => {
    const p = row.release_proof
    const deployedAt=Date.parse(row.event_at),checkedAt=Date.parse(p?.live_verified_at||'')
    return row.site_id===siteId &&
      row.repository===project.production_repo &&
      row.event_kind==='PRODUCTION_VERIFIED' &&
      row.environment==='PRODUCTION' && row.qa_status==='PASS' &&
      /^[a-f0-9]{40}$/i.test(row.commit_sha) &&
      p?.github_sha_verified===true && p?.route_verified===true &&
      p?.live_response_verified===true && p?.deployment_id_present===true &&
      Number.isFinite(deployedAt) && Number.isFinite(checkedAt) &&
      checkedAt>=deployedAt && checkedAt<=now.getTime()
  }))

/**
 * A repo and final GSC observation allow starting an evidence review, NOT a patch.
 * Neither this pure function nor the API can grant a deploy credential.
 */
export function assessDevelopmentReadiness(
  data: DevelopmentPortfolio,
  windowDays: 7 | 14 | 28 = 28,
  asOf: Date = new Date(),
): DevelopmentSiteReadiness[] {
  return data.sites.map((site) => {
    const project = data.projects.find((row) => row.site_id === site.id)
    const repo = project?.production_repo?.trim() ?? ''
    const repositoryVerified = project?.mapping_status === 'VERIFIED' &&
      /^[-\w.]+\/[-\w.]+$/.test(repo)
    const keywords = data.roles.filter((row) => row.site_id === site.id)
    const approved = keywords.filter((row) => row.approval_status === 'APPROVED')
    const window = data.windows
      .filter((row) => row.site_id === site.id && row.window_days === windowDays)
      .sort((a, b) => b.end_date.localeCompare(a.end_date))[0]
    // Query/page receipts only exist for 7/14 day ingestion. A 28D aggregated
    // window is not itself proof of complete URL+query retrieval.
    const hasReceipt = Boolean(window && data.ingests.some((row) =>
      row.site_id === site.id &&
      (row.window_days === 7 || row.window_days === 14) &&
      row.end_date === window.end_date &&
      row.status === 'SUCCESS' &&
      row.data_complete === true))
    const windowIsCurrent = Boolean(window &&
      window.dates_present >= Math.min(windowDays, 7) &&
      freshEnough(window.end_date, asOf, 10))
    const gscReady = hasReceipt && windowIsCurrent
    let status: DevelopmentSiteStatus = 'READY_FOR_PAGE_EVIDENCE'
    let nextAction = 'ตรวจ URL และคีย์เวิร์ดจริง ยืนยันหลักฐานหน้าและ SHA ก่อนเสนอ PR'
    if (!repositoryVerified) {
      status = 'NEEDS_REPO_MAPPING'
      nextAction = 'ยืนยัน Repository/Branch ที่ใช้บน Production จาก Hosting Provider'
    } else if (approved.length === 0) {
      status = 'NEEDS_KEYWORD_APPROVAL'
      nextAction = 'อนุมัติ Keyword Ownership ของหน้าเป้าหมายใน HUB'
    } else if (!gscReady) {
      status = 'NEEDS_FINAL_GSC'
      nextAction = 'ตรวจ GSC Final และใบรับรองนำเข้าข้อมูล Query/Page 7 หรือ 14 วัน'
    }
    return {
      siteId: site.id,
      label: site.label,
      origin: site.origin,
      repository: repositoryVerified ? repo : null,
      repositoryVerified,
      approvedKeywordCount: approved.length,
      mappedKeywordCount: keywords.length,
      selectedGscWindowDays: windowDays,
      gscWindowEnd: window?.end_date ?? null,
      gscReceiptConfirmed: hasReceipt,
      gscFresh: windowIsCurrent,
      readyForPageEvidence: status === 'READY_FOR_PAGE_EVIDENCE',
      status,
      nextAction,
      sourcePatchAuthorized: false,
      automaticDeployAuthorized: false,
      productionVerified: productionVerified(data.releases, site.id, project, asOf),
    }
  })
}

export function buildDevelopmentMilestones(
  data: DevelopmentPortfolio,
  readiness: DevelopmentSiteReadiness[],
  connectorVerifiedLive = false,
): DevelopmentMilestone[] {
  const totalSites = data.sites.length
  const verifiedRepos = readiness.filter((r) => r.repositoryVerified).length
  const ownershipSites = readiness.filter((r) => r.approvedKeywordCount > 0).length
  const evidenceSites = readiness.filter((r) => r.gscReceiptConfirmed && r.gscFresh).length
  const prodSites = readiness.filter((r) => r.productionVerified).length
  const full = (n: number) => totalSites > 0 && n === totalSites
  return [
    { id: 'portfolio', name: 'ทะเบียนเว็บไซต์กลาง', state: totalSites ? 'COMPLETE' : 'PLANNED',
      detail: `อ่านทะเบียนจาก HUB ได้ ${totalSites} เว็บไซต์` },
    { id: 'gsc', name: 'ข้อมูล GSC Final แยกเว็บไซต์', state: full(evidenceSites) ? 'COMPLETE' : evidenceSites ? 'PARTIAL' : 'PLANNED',
      detail: `มีข้อมูล Final + Receipt ล่าสุด ${evidenceSites}/${totalSites} เว็บ (ไม่ใช่อันดับสด)` },
    { id: 'repo', name: 'ยืนยัน Source Repo กับ Production', state: full(verifiedRepos) ? 'COMPLETE' : verifiedRepos ? 'PARTIAL' : 'PLANNED',
      detail: `ยืนยัน Mapping แล้ว ${verifiedRepos}/${totalSites} เว็บ` },
    { id: 'ownership', name: 'อนุมัติ Keyword Ownership', state: full(ownershipSites) ? 'COMPLETE' : ownershipSites ? 'PARTIAL' : 'PLANNED',
      detail: `มีคีย์เวิร์ดอนุมัติอย่างน้อยหนึ่งคำ ${ownershipSites}/${totalSites} เว็บ` },
    { id: 'mcp', name: 'ChatGPT อ่าน Portfolio ผ่าน OAuth MCP', state: connectorVerifiedLive ? 'COMPLETE' : 'PENDING_RELEASE',
      detail: connectorVerifiedLive ? 'ตอบจาก Connector ที่กำลังทำงานจริง' : 'โค้ดอยู่ใน PR ต้อง Deploy และทดสอบ OAuth จริง' },
    { id: 'evidence', name: 'AI สร้างแผนจากหลักฐาน URL/Query', state: 'PARTIAL',
      detail: 'มี SEO Jobs และ Evidence เดิม แต่ต้องเพิ่มการยืนยันหลักฐานก่อนแก้แต่ละเว็บ' },
    { id: 'patch', name: 'AI แก้ Source Code และเปิด PR อัตโนมัติ', state: 'PLANNED',
      detail: 'ยังไม่มี Work Order → Patch → PR ที่ทำงานครบวงจรใน HUB' },
    { id: 'qa', name: 'CI, Security และ SEO Regression', state: 'PARTIAL',
      detail: 'มี GitHub Actions และ Guard บางส่วน ต้องผูก QA กับทุก PR ของทุก Repo' },
    { id: 'release', name: 'ยืนยัน Production SHA และ Rollback', state: full(prodSites) ? 'COMPLETE' : prodSites ? 'PARTIAL' : 'PLANNED',
      detail: `มีหลักฐาน Production ที่ผ่าน QA ${prodSites}/${totalSites} เว็บ` },
    { id: 'measurement', name: 'วัดผล SEO หลัง Release 7/14/28 วัน', state: 'PARTIAL',
      detail: 'มี Experiments และ Measurement เดิม ต้องยืนยันการเชื่อม Release เป็นราย URL' },
    { id: 'conversion', name: 'วัด LINE Lead → ซื้อเข้า → กำไร', state: 'PARTIAL',
      detail: 'มี Attribution Ledger แต่ยังต้องตรวจ Coverage ของดีลที่ระบุแหล่งที่มาจริง' },
    { id: 'live_serp', name: 'Live Google Rank Tracker', state: 'PLANNED',
      detail: 'ยังไม่มีผู้ให้บริการ SERP แบบสดที่เชื่อมและพิสูจน์ผลใน HUB' },
  ]
}
