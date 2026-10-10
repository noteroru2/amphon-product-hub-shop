export const READ_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
export interface Site { id: string; origin: string; label: string; gsc_property: string }
export interface GscRow { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }
export class GscError extends Error {
  constructor(public status: number, public reauth = false) { super(`Google Search Console HTTP ${status}${reauth ? ' • กรุณาเชื่อมบัญชีใหม่' : ' • ตรวจสิทธิ์ property / เปิด API และลองอีกครั้ง'}`) }
}
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function hostFilter(site: Site) {
  const host = new URL(site.origin).hostname
  const unicode = site.label.includes('.') && !site.label.includes('/') ? site.label : host
  return `^https?://(www\\.)?(${[...new Set([host, unicode])].map(escapeRegex).join('|')})/`
}
export function mapProperties(sites: Site[], properties: { siteUrl: string; permissionLevel: string }[]) {
  const allowed = properties.filter(p => ['siteOwner','siteFullUser','siteRestrictedUser'].includes(p.permissionLevel)).map(p => p.siteUrl)
  const result: Record<string,string> = {}
  for (const site of sites) {
    if (allowed.includes(site.gsc_property)) { result[site.id] = site.gsc_property; continue }
    const host = new URL(site.origin).hostname
    const match = allowed.find(p => {
      try {
        if (p.startsWith('sc-domain:')) return new URL(`https://${p.slice(10)}`).hostname === host
        const u = new URL(p)
        return u.pathname === '/' && !u.search && !u.hash && [host, `www.${host}`].includes(u.hostname)
      } catch { return false }
    })
    if (match) result[site.id] = match
  }
  return result
}
export function dateWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(now)
  const value = (type: string) => parts.find(p => p.type === type)!.value
  const end = new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate()-3)
  const start = new Date(end); start.setUTCDate(start.getUTCDate()-27)
  return { startDate: start.toISOString().slice(0,10), endDate: end.toISOString().slice(0,10) }
}
export async function fetchJson(url: string, init: RequestInit, fetcher: typeof fetch = fetch) {
  for (let attempt=0; attempt<3; attempt++) {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(12_000) })
    if ((response.status===429 || response.status>=500) && attempt<2) {
      await new Promise(resolve => setTimeout(resolve, 250*2**attempt)); continue
    }
    if (!response.ok) {
      let reauth = response.status===401
      // Read only the error code. Never echo OAuth tokens or Google response bodies.
      try { const body=await response.json(); reauth ||= body.error==='invalid_grant' } catch { /* non-JSON errors */ }
      throw new GscError(response.status,reauth)
    }
    return response.json()
  }
  throw new GscError(503)
}
export async function fetchSnapshot(site: Site, property: string, token: string, fetcher: typeof fetch = fetch, now = new Date()) {
  const dates=dateWindow(now)
  const base={...dates, type:'web',dataState:'final',aggregationType:'auto',
    dimensionFilterGroups:[{filters:[{dimension:'page',operator:'includingRegex',expression:hostFilter(site)}]}]}
  const endpoint=`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`
  const query=async (extra: Record<string,unknown>) => {
    const data=await fetchJson(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...base,...extra})},fetcher)
    const rows=data.rows || []
    if(!Array.isArray(rows) || rows.some((r:GscRow)=>![r.clicks,r.impressions,r.ctr,r.position].every(v=>typeof v==='number' && Number.isFinite(v) && v>=0) || r.ctr>1)) throw new Error('Invalid GSC metrics')
    return rows as GscRow[]
  }
  // Aggregate endpoint, not a sum of disclosed query rows.
  const totals=await query({dimensions:[],rowLimit:1})
  const daily=await query({dimensions:['date'],rowLimit:1000})
  const rows: GscRow[]=[]; let truncated=false
  for (let page=0;page<2;page++) {
    const batch=await query({dimensions:['query','page'],rowLimit:1000,startRow:page*1000})
    rows.push(...batch)
    if (batch.length<1000) break
    if (page===1) truncated=true
  }
  const total=totals[0]
  const numeric = (value: unknown) => Number.isFinite(Number(value)) && Number(value)>=0 ? Number(value) : 0
  return {start_date:dates.startDate,end_date:dates.endDate,last_data_date:daily.map(r=>r.keys?.[0]).filter(Boolean).sort().at(-1)||null,
    clicks:numeric(total?.clicks),impressions:numeric(total?.impressions),ctr:total ? numeric(total.ctr) : null,
    position:total && total.impressions>0 ? numeric(total.position) : null,
    daily:daily.map(r=>({date:r.keys?.[0],clicks:r.clicks,impressions:r.impressions,ctr:r.ctr,position:r.position})),
    queries:rows.map(r=>({query:r.keys?.[0]||'',page:r.keys?.[1]||'',clicks:r.clicks,impressions:r.impressions,position:r.impressions>0?r.position:null})),
    query_truncated:truncated}
}
