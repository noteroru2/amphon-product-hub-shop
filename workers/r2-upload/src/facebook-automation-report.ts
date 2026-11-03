type Load = <T=any>(path:string,init?:RequestInit)=>Promise<T>
type Row=Record<string,any>
const iso=(n:number)=>new Date(n).toISOString()
const bkkDay=(date:Date)=>new Intl.DateTimeFormat('en-CA',{
 timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'
}).format(date)
const number=(n:any)=>Number.isFinite(Number(n))?Number(n):0
/** Owner/admin/sales authenticated REST read: never exposes tokens or Graph request bodies. */
export async function facebookAutomationReport(load:Load,role:string){
 const now=Date.now(),last24=iso(now-86400000),last7=iso(now-7*86400000)
 const [settingsRows,queue,daily,usage,writeStates,attempts,sales,ledger,openAlerts] = await Promise.all([
  load<Row[]>('facebook_rotation_settings?id=eq.true&select=enabled,dry_run,page_daily_budget,rolling_24h_budget,min_page_gap_minutes,publish_window_start_hour,publish_window_end_hour,sold_sync_paused,price_sync_paused,catalog_sync_paused,active_connection_keys&limit=1'),
  load<Row[]>('facebook_automation_queue_status_v?select=id,product_id,connection_key,lane,status,attention_state,gate_reason,next_eligible_at,scheduled_at,sku,title,category,stock_age_days,attempts,last_error&order=scheduled_at.asc&limit=300'),
  load<Row[]>('facebook_automation_daily_v?select=day_bkk,connection_key,posted_count,new_arrival_count,rotation_count&order=day_bkk.desc&limit=75'),
  load<Row[]>('facebook_graph_usage_samples?recorded_at=gte.'+encodeURIComponent(last24)+'&select=connection_key,operation,http_status,error_code,app_call_percent,business_call_percent,recorded_at&order=recorded_at.desc&limit=700'),
  load<Row[]>('facebook_page_write_state?select=connection_key,retry_at,last_error&limit=10'),
  load<Row[]>('facebook_publish_attempts?select=connection_key,state,post_id,queue_id&limit=250'),
  role==='sales'?Promise.resolve([]):load<Row[]>('facebook_content_sale_performance_v?select=connection_key,direct_sales,direct_profit,posts&limit=180'),
  load<Row[]>('facebook_post_ledger?published_at=gte.'+encodeURIComponent(last7)+'&select=connection_key,post_id,published_at,status&order=published_at.desc&limit=350'),
  load<Row[]>('distribution_alerts?status=eq.OPEN&alert_type=like.FACEBOOK*&select=alert_type,connection_key,severity,details,last_seen_at&order=last_seen_at.desc&limit=40'),
 ])
 const settings=settingsRows[0]||null
 const keys:Array<string>=Array.isArray(settings?.active_connection_keys)?settings!.active_connection_keys:['page_1','page_2']
 const today=bkkDay(new Date(now))
 const statusNames=['READY','WAITING_BUDGET','WAITING_GAP','META_COOLDOWN','NEEDS_REVIEW','FAILED','POSTING','REPAIR_PENDING','PAUSED']
 const pages=keys.map(connectionKey=>{
  const q=queue.filter(x=>x.connection_key===connectionKey)
  const u=usage.filter(x=>x.connection_key===connectionKey)
  const receipts=attempts.filter(x=>x.connection_key===connectionKey)
  const w=writeStates.find(x=>x.connection_key===connectionKey)
  const day=daily.find(x=>x.connection_key===connectionKey&&x.day_bkk===today)
  const confirmed=ledger.filter(x=>x.connection_key===connectionKey && x.status==='LIVE')
  const counts=Object.fromEntries(statusNames.map(k=>[k,q.filter(x=>x.attention_state===k).length]))
  const recentSales=sales.filter(x=>x.connection_key===connectionKey)
  return {connectionKey,postsToday:number(day?.posted_count),postsLast7Days:daily.filter(x=>x.connection_key===connectionKey).reduce((n,x)=>n+number(x.posted_count),0),
   feedSuccess24h:u.filter(x=>x.operation==='feed-publish'&&x.http_status>=200&&x.http_status<300).length,
   graphErrors24h:u.filter(x=>x.http_status>=400).length,
   usagePercent:Math.max(0,...u.map(x=>number(x.app_call_percent)),...u.map(x=>number(x.business_call_percent))),
   confirmedReceipts:receipts.filter(x=>x.state==='CONFIRMED'&&x.post_id).length,
   needsPostIdReview:receipts.filter(x=>x.state!=='CONFIRMED'||!x.post_id).length,
   ledgerLast7Days:confirmed.length,queueCounts:counts,
   cooldownUntil:w?.retry_at||null,
   cooldownReason:w?.last_error||null,
   directSales:role==='sales'?null:recentSales.reduce((n,x)=>n+number(x.direct_sales),0),
   directProfit:role==='sales'?null:recentSales.reduce((n,x)=>n+number(x.direct_profit),0)}
 })
 return {generatedAt:new Date().toISOString(),settings,pages,queue:queue.slice(0,120),
  daily:daily.filter(x=>x.day_bkk>=bkkDay(new Date(now-7*86400000))),
  alerts:openAlerts.slice(0,30),metricSource:'Meta Graph headers / verified post ledger / AMPHON System direct attribution',
  financeVisible:role!=='sales'}
}
