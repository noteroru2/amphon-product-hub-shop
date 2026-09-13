const api=(process.env.AMPHON_STORE_API||'').replace(/\/$/,'')
const shop=(process.env.AMPHON_SHOP_URL||'').replace(/\/$/,'')
if(!api||!shop){
  console.error('LIVE_ACCEPTANCE_REQUIRED: set AMPHON_STORE_API and AMPHON_SHOP_URL')
  process.exit(2)
}

const maxAttempts=Math.max(1,Number(process.env.LIVE_ACCEPTANCE_RETRIES||20))
const delayMs=Math.max(1000,Number(process.env.LIVE_ACCEPTANCE_DELAY_MS||15000))
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms))

function errorDetail(e){
  if(!(e instanceof Error)) return String(e)
  const cause=e.cause
  const parts=[e.message]
  if(cause&&typeof cause==='object'){
    if('code' in cause&&cause.code) parts.push(String(cause.code))
    if('message' in cause&&cause.message&&cause.message!==e.message) parts.push(String(cause.message))
  }
  return parts.filter(Boolean).join(' | ')
}

async function requestCheck(name,url,test){
  try{
    const r=await fetch(url,{headers:{accept:'application/json,text/plain,*/*'}})
    const text=await r.text()
    if(!r.ok) return {ok:false,detail:`HTTP ${r.status}`}
    if(!test(r,text)) return {ok:false,detail:`HTTP ${r.status} content check failed`}
    return {ok:true,detail:`HTTP ${r.status}`}
  }catch(e){
    return {ok:false,detail:errorDetail(e)}
  }
}

async function checkOnce(name,url,test){
  const result=await requestCheck(name,url,test)
  if(result.ok){console.log(`PASS ${name}`);return true}
  console.error(`FAIL ${name}: ${result.detail}`)
  return false
}

async function checkWithRetry(name,url,test){
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const result=await requestCheck(name,url,test)
    if(result.ok){
      console.log(`PASS ${name}${attempt>1?` (attempt ${attempt}/${maxAttempts})`:''}`)
      return true
    }
    if(attempt===maxAttempts){
      console.error(`FAIL ${name}: ${result.detail} after ${maxAttempts} attempts`)
      return false
    }
    console.log(`WAIT ${name} attempt ${attempt}/${maxAttempts}: ${result.detail}`)
    console.log(`Retrying in ${Math.round(delayMs/1000)}s...`)
    await sleep(delayMs)
  }
  return false
}

const failures=[]
if(!await checkOnce('Store health',`${api}/health`,(_r,t)=>{try{const j=JSON.parse(t);return j.ok===true&&Number(j.version)>=6}catch{return false}})) failures.push('Store health')
if(!await checkOnce('Store settings',`${api}/settings`,(_r,t)=>{try{const j=JSON.parse(t);return !!j.settings&&typeof j.settings.purchaseEnabled==='boolean'}catch{return false}})) failures.push('Store settings')

console.log(`Shop custom-domain readiness: up to ${maxAttempts} attempts, ${Math.round(delayMs/1000)}s apart.`)
if(!await checkWithRetry('Shop robots',`${shop}/robots.txt`,(_r,t)=>t.includes('Sitemap:'))) failures.push('Shop robots')
if(!await checkWithRetry('Shop sitemap',`${shop}/sitemap.xml`,(_r,t)=>t.includes('<sitemapindex')||t.includes('<urlset'))) failures.push('Shop sitemap')

if(failures.length){
  console.error('LIVE ACCEPTANCE: FAIL')
  failures.forEach(x=>console.error(`- ${x}`))
  console.error('If only Shop robots/sitemap fail, inspect Cloudflare Workers > amphon-shop > Settings > Domains & Routes and confirm shop custom domain is Active, then verify DNS/SSL status.')
  process.exit(1)
}
console.log('LIVE HTTP SMOKE: PASS')
console.log('MANUAL/PROVIDER TEST STILL REQUIRED: Stripe card, PromptPay async, duplicate webhook, amount mismatch, expiry, refund, shipment, pickup, receipt, warranty.')
