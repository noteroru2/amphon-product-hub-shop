const endpoint='https://mfpdtlxwdbxitgfzdape.supabase.co/functions/v1/seo-workbench/contact'
const storageKey='amphon-source-v1'
export function initSeoAttribution() {
  let source: {session:string;referrer:string;expires:number}
  try {
    const old=JSON.parse(sessionStorage.getItem(storageKey) || 'null')
    if(old?.expires>Date.now() && /^[a-f0-9]{32}$/.test(old.session)) source=old
    else {
      let referrer=''; try { referrer=new URL(document.referrer).hostname; if(referrer===location.hostname) referrer='' } catch {}
      source={session:Array.from(crypto.getRandomValues(new Uint8Array(16))).map(n=>n.toString(16).padStart(2,'0')).join(''),referrer,expires:Date.now()+86400000}
      sessionStorage.setItem(storageKey,JSON.stringify(source))
    }
  } catch { return } // Contact links remain usable if browser storage is disabled.
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a'):null
    if(!target || !/^https:\/\/line\.me\/R\/(ti\/p|oaMessage)\/(%40|@)webuy/i.test(target.href)) return
    const url=new URL(endpoint)
    url.search=new URLSearchParams({site:'shop',page:location.origin+location.pathname,session:source.session,referrer:source.referrer,sku:document.getElementById('add-to-cart')?.dataset.sku || ''}).toString()
    target.href=url.href
  },true)
}
