import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {privateImageMustUseNetwork} from '../src/lib/evidenceImageCachePolicy.ts'
const privatePaths=['/storage/v1/object/sign/trade-evidence-private/fake.jpg?token=synthetic',
 '/storage/v1/render/image/sign/other/fake.jpg?token=synthetic',
 '/evidence/fake/fake.webp','/media/evidence/fake.webp','/photo.jpg?X-Amz-Signature=synthetic',
 '/photo.jpg?TOKEN=synthetic','/photo.jpg?signature=synthetic']
const publicPaths=['/products/fake.webp','/storage/v1/object/public/products/fake.webp',
 '/storage/v1/render/image/public/products/fake.webp?width=400']
test('private/signed/authorized evidence images bypass persistent cache; public product images remain cacheable',()=>{
 for(const path of privatePaths)assert.equal(privateImageMustUseNetwork({
  request:{destination:'image',headers:new Headers()},url:new URL(path,'https://synthetic.invalid')}),true,path)
 for(const path of publicPaths)assert.equal(privateImageMustUseNetwork({
  request:{destination:'image',headers:new Headers()},url:new URL(path,'https://synthetic.invalid')}),false,path)
 assert.equal(privateImageMustUseNetwork({request:{destination:'image',headers:new Headers({authorization:'synthetic'})},
  url:new URL('https://synthetic.invalid/products/fake.webp')}),true)
})
test('activation cleanup removes old private entries, retains public product images and never uses network',async()=>{
 const requests=[...privatePaths,...publicPaths].map(p=>new Request(new URL(p,'https://synthetic.invalid')))
 requests.push(new Request('https://synthetic.invalid/authorized.jpg',{headers:{authorization:'synthetic'}}))
 const retained=new Set(requests);let pending
 const cache={async keys(){return [...retained]},async delete(r){return retained.delete(r)}}
 runInNewContext(readFileSync(new URL('../public/evidence-cache-cleanup.js',import.meta.url),'utf8'),{
  self:{addEventListener(type,fn){assert.equal(type,'activate');fn({waitUntil(p){pending=p}})}},
  caches:{async has(name){assert.equal(name,'product-images');return true},async open(){return cache}},URL,
  fetch(){throw Error('NO_NETWORK_IN_SYNTHETIC_CACHE_TEST')}
 })
 await pending
 assert.deepEqual([...retained].map(r=>new URL(r.url).pathname).sort(),publicPaths.map(p=>new URL(p,'https://synthetic.invalid').pathname).sort())
})
test('PWA config puts private NetworkOnly/no-store route before historical public CacheFirst route',()=>{
 const config=readFileSync(new URL('../vite.config.ts',import.meta.url),'utf8')
 assert.ok(config.indexOf("handler: 'NetworkOnly'")<config.indexOf("handler: 'CacheFirst'"))
 assert.match(config,/fetchOptions: \{ cache: 'no-store' \}/)
 assert.match(config,/importScripts: \['\/evidence-cache-cleanup.js'\]/)
})
