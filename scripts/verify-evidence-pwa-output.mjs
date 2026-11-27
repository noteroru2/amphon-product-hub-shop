// Evaluate the actual generated SW against inert Workbox stubs, never a browser
// or network. Catches serialization/closure errors in security match callbacks.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const routes=[],imports=[]
let manifest=[]
class NetworkOnly {constructor(options){this.options=options}}
class CacheFirst {}
const workbox={NetworkOnly,CacheFirst,ExpirationPlugin:class {},NavigationRoute:class {},
 clientsClaim(){},cleanupOutdatedCaches(){},createHandlerBoundToURL(){return ()=>{}},
 precacheAndRoute(entries){manifest=entries},registerRoute(pattern,handler){routes.push({pattern,handler})}}
runInNewContext(readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8'),{
 self:{define:true,skipWaiting(){}},define(_deps,callback){callback(workbox)},
 importScripts(path){imports.push(path)},URL,
 fetch(){throw Error('PWA_OUTPUT_CHECK_MUST_NOT_FETCH')}
})
assert.ok(imports.includes('/evidence-cache-cleanup.js'))
assert.ok(manifest.some(x=>x.url==='index.html'))
assert.ok(manifest.some(x=>x.url==='evidence-cache-cleanup.js'))
const imageRoutes=routes.filter(r=>typeof r.pattern==='function')
assert.ok(imageRoutes[0].handler instanceof NetworkOnly)
assert.equal(imageRoutes[0].handler.options.fetchOptions.cache,'no-store')
for(const path of ['/storage/v1/object/sign/trade-evidence-private/synthetic.jpg?token=synthetic',
 '/evidence/synthetic/image.webp','/image.jpg?X-Amz-Signature=synthetic']) {
 assert.equal(imageRoutes[0].pattern({request:{destination:'image',headers:new Headers()},
  url:new URL(path,'https://synthetic.invalid')}),true)
}
assert.equal(imageRoutes[0].pattern({request:{destination:'image',headers:new Headers()},
 url:new URL('https://synthetic.invalid/products/synthetic.webp')}),false)
assert.ok(imageRoutes[1].handler instanceof CacheFirst)
assert.equal(readFileSync(new URL('../dist/evidence-cache-cleanup.js',import.meta.url),'utf8'),
 readFileSync(new URL('../public/evidence-cache-cleanup.js',import.meta.url),'utf8'))
console.log('PASS built PWA: private/signed images NetworkOnly/no-store before public caching; cleanup script imported and precached; no network')
