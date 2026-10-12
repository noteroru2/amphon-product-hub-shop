import {chromium} from 'playwright'
import {createHash} from 'node:crypto'
const endpoint='https://mfpdtlxwdbxitgfzdape.supabase.co/functions/v1/seo-workbench'
async function identity(){const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);url.searchParams.set('audience',endpoint);const r=await fetch(url,{headers:{Authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`}});if(!r.ok)throw new Error('OIDC unavailable');const data=await r.json();return data.value}
let token=await identity();let issuedAt=Date.now()
async function api(action,data={}){if(Date.now()-issuedAt>180000){token=await identity();issuedAt=Date.now()}const r=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action,...data})});const result=await r.json();if(!r.ok)throw new Error(result.error||`Evidence gateway HTTP ${r.status}`);return result}
const browser=await chromium.launch({headless:true})
try{
 for(let batch=0;batch<5;batch++){
  const jobs=await api('render_claim');if(!jobs.length)break
  for(const job of jobs){
   const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false})
   try{
    const allowed=new URL(job.origin).hostname
    await context.route('**/*',route=>{
     const req=route.request();let u;try{u=new URL(req.url())}catch{return route.abort()}
     const firstParty=[allowed,`www.${allowed}`].includes(u.hostname)
     const publicAssets=['fonts.googleapis.com','fonts.gstatic.com','static.cloudflareinsights.com','images.unsplash.com','amphon-product-images.noteroru2.workers.dev','mfpdtlxwdbxitgfzdape.supabase.co'].includes(u.hostname)
     const navigation=req.isNavigationRequest()&&req.frame()===req.frame().page().mainFrame()
     if(u.protocol!=='https:'||u.username||u.password||u.port||req.method()!=='GET'||(!firstParty&&!publicAssets)||(navigation&&!firstParty))return route.abort()
     return route.continue()
    })
    const page=await context.newPage()
    const response=await page.goto(job.page,{waitUntil:'domcontentloaded',timeout:30000})
    if(!response || response.status()>=400)throw new Error(`Public page HTTP ${response?.status()||'unknown'}`)
    await page.waitForFunction(()=>((document.querySelector('main')||document.querySelector('article')||document.body)?.innerText||'').trim().length>=100,null,{timeout:20000})
    const final=new URL(page.url());if(![allowed,`www.${allowed}`].includes(final.hostname))throw new Error('External document redirect')
    const raw=await page.evaluate(()=>((document.querySelector('main')||document.querySelector('article')||document.body)?.innerText||''))
    const text=raw.replace(/\s+/g,' ').trim().slice(0,12000)
    if(text.length<100)throw new Error('Insufficient rendered text')
    const title=await page.title()
    if(/^(just a moment|attention required|access denied|verify you are human)/i.test(title)||await page.locator('#challenge-running,form#challenge-form').count())throw new Error('Browser challenge; readable evidence not confirmed')
    if(job.stage==='PUBLISH'){
     const noindex=await page.locator('meta[name="robots"],meta[name="googlebot"]').evaluateAll(nodes=>nodes.some(n=>/(noindex|none)/i.test(n.getAttribute('content')||'')))
     if(noindex)throw new Error('Live noindex warning; do not start experiment')
     const proof=(job.proof_excerpt||'').replace(/\s+/g,' ').trim()
     if(proof.length<80||!(job.approved_body||'').replace(/\s+/g,' ').includes(proof)||!text.includes(proof)||(job.previous_excerpt||'').replace(/\s+/g,' ').includes(proof))throw new Error('New approved text not found on live page')
    }
    await api('render_finish',{job_id:job.job_id,lease_id:job.lease_id,source_url:page.url(),source_hash:createHash('sha256').update(text).digest('hex'),page_title:title,excerpt:text})
    console.log(`Evidence job ${job.job_id}: ${job.stage} complete (${text.length} readable characters)`)
   }catch(error){await api('render_fail',{job_id:job.job_id,lease_id:job.lease_id,error:error.message});console.log(`Evidence job ${job.job_id}: requires review (${error.message})`)}
   finally{await context.close()}
  }
 }
}finally{await browser.close()}
