/**
 * P6 read-only, Google-Pacific-dated before/after GSC comparison.
 *
 * The Google Search Analytics API returns sampled/anonymized top rows.
 * These metrics are descriptive observations, NOT causal proof of SEO uplift,
 * a complete list of search queries, or a live SERP rank.
 */
export interface CompareGate {
  site_id: string
  level: string
  verified_release_at: string | null
  confirmed_affected_urls: string[]
  latest_sha: string | null
}
export interface CompareOptions {
  site_id: string
  days: 7 | 14 | 28
  page: string
  query?: string
  country?: string
  device?: 'DESKTOP' | 'MOBILE' | 'TABLET'
}
export interface GscAggregate {
  clicks: number
  impressions: number
  ctr: number
  position: number | null
}
export interface GscRequest {
  startDate: string
  endDate: string
  type: 'web'
  dataState: 'final'
  aggregationType: 'auto'
  dimensions: []
  rowLimit: 1
  startRow: 0
  dimensionFilterGroups: Array<{
    groupType: 'and'
    filters: Array<{dimension: string; operator: 'equals'; expression: string}>
  }>
}
export interface ComparisonPlan {
  schema: 'amphon.seo.release-gsc-comparison.v1'
  site_id: string
  release_at: string
  release_gsc_day: string
  days: 7 | 14 | 28
  page: string
  query: string | null
  country: string | null
  device: string | null
  before: GscRequest
  after: GscRequest
  first_final_date: string
}
const fail=(msg: string):never=>{throw new Error('SEO_RELEASE_COMPARE_'+msg)}
const dateParts=(at:Date,zone:string):string=>{
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
  }).formatToParts(at)
  const fields=Object.fromEntries(parts.map(row=>[row.type,row.value]))
  return fields.year+'-'+fields.month+'-'+fields.day
}
const shiftDay=(day:string,add:number):string=>
  new Date(Date.parse(day+'T00:00:00Z')+add*86_400_000)
    .toISOString().slice(0,10)
const strictDate=(raw:unknown):Date|null=>{
  if(typeof raw!=='string'||!raw.trim())return null
  const date=new Date(raw)
  return Number.isNaN(date.getTime())?null:date
}
const pageMatches=(page:string,origin:string):boolean=>{
  try {
    const u=new URL(page),host=new URL(origin)
    return u.protocol==='https:'&&u.origin===host.origin &&
      !u.username&&!u.password&&!u.search&&!u.hash
  } catch {return false}
}
// Google's page dimension is an exact URL string and usually percent-encodes
// Unicode paths. Equivalence is URL serialization, NOT loose path matching.
export function sameCanonicalGscPage(a:unknown,b:unknown):boolean {
  if(typeof a!=='string'||typeof b!=='string')return false
  try {
    const x=new URL(a),y=new URL(b)
    return x.protocol==='https:'&&y.protocol==='https:' &&
      !x.username&&!x.password&&!x.search&&!x.hash &&
      !y.username&&!y.password&&!y.search&&!y.hash &&
      x.href===y.href
  } catch {return false}
}
export function buildGscReleaseComparison(
  gate:CompareGate,
  origin:string,
  options:CompareOptions,
  now=new Date(),
):ComparisonPlan {
  if(options.site_id!==gate.site_id || gate.level!=='PRODUCTION_EVIDENCE_COMPLETE')
    fail('PRODUCTION_NOT_VERIFIED')
  if(![7,14,28].includes(options.days))fail('INVALID_WINDOW')
  if(!strictDate(gate.verified_release_at))fail('INVALID_VERIFIED_RELEASE')
  if(typeof options.page!=='string'||options.page.length>2048||
    !pageMatches(options.page,origin) ||
    !Array.isArray(gate.confirmed_affected_urls) ||
    !gate.confirmed_affected_urls.some(page=>sameCanonicalGscPage(page,options.page)))
    fail('PAGE_NOT_IN_VERIFIED_RELEASE_SCOPE')
  const canonicalPage=new URL(options.page).href
  if(options.query!==undefined && (typeof options.query!=='string'||
    options.query.length<2||options.query.length>200||
    !options.query.trim()||options.query!==options.query.trim()))
    fail('INVALID_QUERY')
  if(options.country!==undefined && !/^[a-z]{3}$/.test(options.country))
    fail('INVALID_COUNTRY')
  if(options.device!==undefined &&
    !['DESKTOP','MOBILE','TABLET'].includes(options.device))
    fail('INVALID_DEVICE')
  // Search Console daily data use the Pacific reporting calendar, NOT UTC
  // and not the Bangkok operational calendar used in previous P5 UI drafts.
  const releaseDay=dateParts(strictDate(gate.verified_release_at)!, 'America/Los_Angeles')
  const today=dateParts(now,'America/Los_Angeles')
  const earliestFinal=shiftDay(today,-3)
  const baselineStart=shiftDay(releaseDay,-options.days)
  const baselineEnd=shiftDay(releaseDay,-1)
  const afterStart=shiftDay(releaseDay,1)
  const afterEnd=shiftDay(releaseDay,options.days)
  if(afterEnd>earliestFinal)fail('AFTER_WINDOW_NOT_GOOGLE_FINAL')
  if(Date.parse(baselineStart+'T00:00:00Z') <
    now.getTime()-480*86_400_000)fail('GSC_HISTORY_EXPIRED')
  const filters=[
    {dimension:'page',operator:'equals' as const,expression:canonicalPage},
    ...(options.query?[{dimension:'query',operator:'equals' as const,expression:options.query}]:[]),
    ...(options.country?[{dimension:'country',operator:'equals' as const,expression:options.country}]:[]),
    ...(options.device?[{dimension:'device',operator:'equals' as const,expression:options.device}]:[]),
  ]
  const request=(startDate:string,endDate:string):GscRequest=>({
    startDate,endDate,type:'web',dataState:'final',
    aggregationType:'auto',dimensions:[],rowLimit:1,startRow:0,
    dimensionFilterGroups:[{groupType:'and',filters}],
  })
  return {
    schema:'amphon.seo.release-gsc-comparison.v1',site_id:gate.site_id,
    release_at:gate.verified_release_at!,release_gsc_day:releaseDay,
    days:options.days,page:canonicalPage,query:options.query??null,
    country:options.country??null,device:options.device??null,
    before:request(baselineStart,baselineEnd),
    after:request(afterStart,afterEnd),
    first_final_date:shiftDay(afterEnd,3),
  }
}
export function parseGscAggregate(input:unknown):GscAggregate|null {
  if(!input||typeof input!=='object'||Array.isArray(input))
    fail('INVALID_GSC_RESPONSE')
  const response=input as {rows?:unknown;metadata?:unknown}
  if(response.rows===undefined)return null
  if(!Array.isArray(response.rows))fail('INVALID_GSC_ROWS')
  if(response.rows.length===0)return null
  if(response.rows.length!==1)fail('AMBIGUOUS_GSC_AGGREGATION')
  const row=response.rows[0]
  if(!row||typeof row!=='object'||Array.isArray(row))
    fail('INVALID_GSC_METRIC')
  const m=row as Record<string,unknown>
  if(!['clicks','impressions','ctr','position'].every(key=>
    typeof m[key]==='number'&&Number.isFinite(m[key])&&Number(m[key])>=0)
    || Number(m.ctr)>1 || Number(m.clicks)>Number(m.impressions))
    fail('INVALID_GSC_METRIC')
  return {
    clicks:Number(m.clicks),impressions:Number(m.impressions),
    ctr:Number(m.ctr),position:m.impressions===0?null:Number(m.position),
  }
}
const rounded=(v:number)=>Math.round(v*10000)/10000
export function compareVisibleGsc(
  plan:ComparisonPlan,
  before:GscAggregate|null,
  after:GscAggregate|null,
) {
  const complete=Boolean(before&&after&&before.impressions>0&&after.impressions>0)
  const delta=(a:number|null|undefined,b:number|null|undefined)=>
    a===null||b===null||a===undefined||b===undefined?null:rounded(b-a)
  const pct=(a:number|null|undefined,b:number|null|undefined)=>
    a===null||b===null||a===undefined||b===undefined||a===0?
      null:rounded((b-a)/a*100)
  return {
    schema:plan.schema,
    release_at:plan.release_at,
    release_gsc_day:plan.release_gsc_day,
    site_id:plan.site_id,
    page:plan.page,query:plan.query,country:plan.country,device:plan.device,
    search_type:'web' as const,
    days:plan.days,
    before_range:{start:plan.before.startDate,end:plan.before.endDate},
    after_range:{start:plan.after.startDate,end:plan.after.endDate},
    before_metrics:before,after_metrics:after,
    status:complete?'VISIBLE_GSC_COMPARISON':'INSUFFICIENT_VISIBLE_DATA',
    changes:complete?{
      clicks:delta(before?.clicks,after?.clicks),
      impressions:delta(before?.impressions,after?.impressions),
      clicks_pct:pct(before?.clicks,after?.clicks),
      impressions_pct:pct(before?.impressions,after?.impressions),
      ctr_percentage_points:delta((before?.ctr??0)*100,(after?.ctr??0)*100),
      average_position_improvement:before?.position!=null&&after?.position!=null?
        rounded(before.position-after.position):null,
    }:null,
    gsc_data_state:'final' as const,
    google_query_anonymization_possible:true,
    full_data_coverage_confirmed:false,
    live_serp_position:false,
    causal_impact_proven:false,
    automatic_release_approval:false,
    notice:'Descriptive Google Search Console observations for an exact page and optional query/segment. Google can suppress data. Average position is NOT a live Google rank. Before/after change is NOT proof the release caused it.',
  }
}
