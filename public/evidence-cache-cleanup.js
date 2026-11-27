// Delete only private/signed entries left by the historical broad image cache.
// No network calls, object-storage deletes, keys, logs or publication actions.
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  if(!await caches.has('product-images'))return
  const cache=await caches.open('product-images')
  for(const request of await cache.keys()) {
   const url=new URL(request.url),path=url.pathname.toLowerCase()
   if(request.headers.has('authorization')||path.includes('trade-evidence-private')||
    /^\/(?:media\/)?evidence\//.test(path)||
    (path.startsWith('/storage/v1/')&&!/^\/storage\/v1\/(?:object|render\/image)\/public\//.test(path))||
    [...url.searchParams.keys()].some(key=>/token|signature|authorization|^x-amz-/i.test(key)))
    await cache.delete(request)
  }
 })())
})
