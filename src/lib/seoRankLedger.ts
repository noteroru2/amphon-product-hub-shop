export interface SeoRankSnapshot {
  site_id: string
  keyword: string
  location_id: number
  language_code: string
  device: 'DESKTOP' | 'MOBILE'
  checked_on: string
  checked_at: string
  serp_date: string | null
  status: 'PENDING' | 'RANKED' | 'NOT_RANKING_TOP_100'
  position: number | null
  ranking_url: string | null
  source: 'UBERSUGGEST_PROJECT_POSITION_INFO'
}
const day = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
export function validRankSnapshot(raw: SeoRankSnapshot): boolean {
  if (!raw || !raw.keyword || !day(raw.checked_on) || !['DESKTOP','MOBILE'].includes(raw.device)) return false
  if (raw.source !== 'UBERSUGGEST_PROJECT_POSITION_INFO' || raw.language_code !== 'th' || raw.location_id !== 2764) return false
  if (raw.status === 'PENDING') return raw.position === null && raw.serp_date === null && raw.ranking_url === null
  if (!raw.serp_date || !day(raw.serp_date)) return false
  if (raw.status === 'NOT_RANKING_TOP_100') return raw.position === null && raw.ranking_url === null
  if (raw.status === 'RANKED') return Number.isInteger(raw.position) && Number(raw.position) >= 1 && Number(raw.position) <= 100
  return false
}
/** One latest observation per exact keyword; never turn PENDING into rank zero. */
export function latestRankSnapshots(rows: SeoRankSnapshot[], expectedSite: string) {
  const latest = new Map<string, SeoRankSnapshot>()
  for (const row of [...rows].filter(v => v.site_id === expectedSite && v.device === 'DESKTOP' && validRankSnapshot(v))
    .sort((a,b) => b.checked_on.localeCompare(a.checked_on) || b.checked_at.localeCompare(a.checked_at))) {
    if (!latest.has(row.keyword)) latest.set(row.keyword,row)
  }
  return [...latest.values()].sort((a,b) => a.keyword.localeCompare(b.keyword,'th'))
}
export function rankStatusText(row: SeoRankSnapshot): string {
  if (row.status === 'PENDING') return 'รอผล SERP'
  if (row.status === 'NOT_RANKING_TOP_100') return 'ไม่พบใน Top 100'
  return 'อันดับ ' + row.position
}
