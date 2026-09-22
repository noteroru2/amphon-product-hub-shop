import fs from 'node:fs'

const supabaseUrl=(process.env.SUPABASE_URL||'').replace(/\/$/,'')
const serviceKey=process.env.SUPABASE_SECRET_KEY||''
if(!supabaseUrl||!serviceKey) throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY required')

const wrangler=fs.readFileSync('workers/ai-buyer/wrangler.jsonc','utf8')
if(!wrangler.includes('"AI_BUYER_PAUSED": "true"')){
  throw new Error('Offline replay refused: AI_BUYER_PAUSED is not true')
}

const fixtures=JSON.parse(fs.readFileSync('workers/ai-buyer/data/p0-regression-fixtures-v1.json','utf8'))
const headers={
  apikey:serviceKey,
  authorization:'Bearer '+serviceKey,
  'content-type':'application/json',
  accept:'application/json'
}

async function req(path, init={}){
  const r=await fetch(supabaseUrl+'/rest/v1/'+path,{...init,headers:{...headers,...(init.headers||{})}})
  const raw=await r.text()
  if(!r.ok) throw new Error('SUPABASE_'+r.status+':'+raw.slice(0,1000))
  return raw?JSON.parse(raw):null
}

const rpc=await req('rpc/ai_buyer_run_offline_replay',{
  method:'POST',
  headers:{prefer:'return=representation'},
  body:JSON.stringify({p_policy_version:fixtures.policyVersion})
})
const runId=Array.isArray(rpc)?rpc[0]:rpc
if(!runId||typeof runId!=='string') throw new Error('Replay run id missing: '+JSON.stringify(rpc))

const runs=await req('ai_buyer_offline_replay_runs?id=eq.'+encodeURIComponent(runId)+'&select=*')
const run=runs[0]
if(!run||run.status!=='SUCCEEDED') throw new Error('Replay did not succeed: '+JSON.stringify(run))

const ids=fixtures.cases.map(x=>x.caseId).join(',')
const rows=await req('ai_buyer_offline_replay_results?run_id=eq.'+encodeURIComponent(runId)
  +'&case_id=in.('+ids+')'
  +'&select=case_id,title,bucket,reason_code,detected_battery_bad,existing_battery_bad_tag,regression_codes')
const byId=new Map(rows.map(x=>[x.case_id,x]))

const failures=[]
for(const fixture of fixtures.cases){
  const row=byId.get(fixture.caseId)
  if(!row){
    failures.push({caseId:fixture.caseId,name:fixture.name,error:'MISSING_REPLAY_RESULT'})
    continue
  }
  if(row.bucket!==fixture.expectedBucket){
    failures.push({caseId:fixture.caseId,name:fixture.name,error:'BUCKET_MISMATCH',expected:fixture.expectedBucket,actual:row.bucket})
  }
  if(fixture.expectedReason&&row.reason_code!==fixture.expectedReason){
    failures.push({caseId:fixture.caseId,name:fixture.name,error:'REASON_MISMATCH',expected:fixture.expectedReason,actual:row.reason_code})
  }
  if(fixture.expectedBatteryBad===true&&row.detected_battery_bad!==true){
    failures.push({caseId:fixture.caseId,name:fixture.name,error:'BATTERY_BAD_NOT_DETECTED'})
  }
}

const summary=run.summary||{}
if(Number(summary.batteryPricedNormal||0)!==0){
  failures.push({error:'BATTERY_PRICED_NORMAL',count:summary.batteryPricedNormal})
}
if(Number(summary.batteryTagMissing||0)!==0){
  failures.push({error:'BATTERY_TAG_MISSING',count:summary.batteryTagMissing})
}

console.log(JSON.stringify({
  runId,
  summary,
  fixtures:fixtures.cases.length,
  failures
},null,2))

if(failures.length) process.exit(1)
console.log('AI BUYER P0 REGRESSION + OFFLINE REPLAY: PASS')
