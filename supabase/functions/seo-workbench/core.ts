const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function compact(text: string) { return text.replace(/\s+/g, ' ').trim() }
export function publicText(html: string) {
  const clean = html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
  const main = clean.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] || clean
  const decode = (text: string) => text.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, value) => {
    const n = value[0].toLowerCase()==='x' ? parseInt(value.slice(1),16) : Number(value)
    return n>0 && n<=0x10ffff ? String.fromCodePoint(n) : ' '
  }).replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
  return { text: compact(decode(main.replace(/<[^>]+>/g,' '))).slice(0,12000), title: compact(decode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')).slice(0,300) }
}
export function allowPage(origin: string, value: string) {
  const url = new URL(value); const allowed = new URL(origin)
  if(url.protocol!=='https:' || url.username || url.password || url.port || ![allowed.hostname,`www.${allowed.hostname}`].includes(url.hostname)) throw new Error('Same-site HTTPS page required')
  url.search=''; url.hash=''; return url
}
export async function fetchPage(origin: string, value: string, fetcher: typeof fetch = fetch) {
  let url = allowPage(origin,value)
  for(let hop=0;hop<4;hop++) {
    const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(12_000),headers:{'User-Agent':'AmphonContentEvidence/1.0','Accept':'text/html'}})
    if(response.status>=300 && response.status<400) {
      const location=response.headers.get('location'); if(!location) throw new Error('Redirect without location')
      url=allowPage(origin,new URL(location,url).href); continue
    }
    if(!response.ok || !(response.headers.get('content-type') || '').toLowerCase().includes('html')) throw new Error(`Evidence page HTTP ${response.status}`)
    if(Number(response.headers.get('content-length') || 0)>2_000_000) throw new Error('Evidence page too large')
    const reader=response.body?.getReader(); if(!reader) throw new Error('Empty evidence page')
    const chunks:Uint8Array[]=[]; let size=0
    while(true) { const chunk=await reader.read(); if(chunk.done) break; size+=chunk.value.length; if(size>2_000_000) { await reader.cancel(); throw new Error('Evidence page too large') }; chunks.push(chunk.value) }
    const bytes=new Uint8Array(size); let at=0; for(const chunk of chunks) {bytes.set(chunk,at);at+=chunk.length}
    const html=new TextDecoder().decode(bytes); const result=publicText(html)
    if(result.text.length<100) throw new Error('Insufficient readable public content')
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('')
    return {url:url.href,hash,...result}
  }
  throw new Error('Too many redirects')
}
export function experimentWindows(published: string, days: number, now=new Date(), baselineAt=published) {
  if(![7,14,28].includes(days)) throw new Error('Invalid checkpoint')
  const date=new Date(published); if(!Number.isFinite(date.getTime())) throw new Error('Invalid publication date')
  const pacific=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)
  const shift=(value:string,n:number)=>{const d=new Date(`${value}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
  const baseline=new Date(baselineAt); if(!Number.isFinite(baseline.getTime()) || baseline>date) throw new Error('Invalid baseline evidence time')
  const applied=pacific(date); const captured=pacific(baseline); const latestFinal=shift(pacific(now),-3)
  const windows={before:{startDate:shift(captured,-days),endDate:shift(captured,-1)},after:{startDate:shift(applied,1),endDate:shift(applied,days)}}
  if(windows.after.endDate>latestFinal) throw new Error('Finalized post-publication window not ready')
  return windows
}
export async function fetchExperiment(job: {published_at:string;baseline_at?:string;checkpoint_days:number;page:string;query:string;origin:string;label:string;property:string}, token:string, fetcher:typeof fetch=fetch, now=new Date()) {
  const windows=experimentWindows(job.published_at,job.checkpoint_days,now,job.baseline_at || job.published_at)
  const page=allowPage(job.origin,job.page)
  const hosts=[new URL(job.origin).hostname,job.label].filter(h=>h.includes('.') && !h.includes('/'))
  const pageExpression=`^https?://(www\\.)?(${[...new Set(hosts)].map(escapeRegex).join('|')})${escapeRegex(page.pathname)}(\\?.*)?$`
  const queryExpression=`(?i)^${escapeRegex(job.query.trim()).replace(/\s+/g,'\\s+')}\\s*$`
  const query=async(window:{startDate:string;endDate:string})=>{
    const response=await fetcher(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(job.property)}/searchAnalytics/query`,{
      method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(12_000),
      body:JSON.stringify({...window,type:'web',dataState:'final',aggregationType:'auto',rowLimit:1,dimensionFilterGroups:[{groupType:'and',filters:[{dimension:'page',operator:'includingRegex',expression:pageExpression},{dimension:'query',operator:'includingRegex',expression:queryExpression}]}]})})
    if(!response.ok) throw new Error(`GSC experiment HTTP ${response.status}`)
    const data=await response.json(); if(data.rows!==undefined && !Array.isArray(data.rows)) throw new Error('Malformed GSC experiment data')
    const row=data.rows?.[0]
    if(!row) return {clicks:0,impressions:0,ctr:null,position:null}
    for(const key of ['clicks','impressions','ctr','position']) if(typeof row[key]!=='number' || !Number.isFinite(row[key]) || row[key]<0) throw new Error('Malformed GSC experiment metrics')
    return {clicks:row.clicks,impressions:row.impressions,ctr:row.ctr,position:row.impressions>0?row.position:null}
  }
  const [before_data,after_data]=await Promise.all([query(windows.before),query(windows.after)])
  return {before_data,after_data,windows}
}
export function referral(host: string) {
  const value=host.toLowerCase()
  if(['chatgpt.com','chat.openai.com','perplexity.ai','gemini.google.com','copilot.microsoft.com','claude.ai'].some(h=>value===h || value.endsWith(`.${h}`))) return 'AI_REFERRAL'
  if(/(^|\.)google\.(com|co\.th)$/.test(value) || ['bing.com','search.yahoo.com'].some(h=>value===h || value.endsWith(`.${h}`))) return 'ORGANIC_SEARCH'
  return value ? 'OTHER' : 'UNKNOWN'
}
