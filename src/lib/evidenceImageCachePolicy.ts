// Self-contained: Workbox serializes this function into the generated worker.
export function privateImageMustUseNetwork({request,url}:{request:Request;url:URL}) {
 if(request.destination!=='image')return false
 const path=url.pathname.toLowerCase()
 let signed=false
 url.searchParams.forEach((_value,key)=>{if(/token|signature|authorization|^x-amz-/i.test(key))signed=true})
 return request.headers.has('authorization')||path.includes('trade-evidence-private')||
  /^\/(?:media\/)?evidence\//.test(path)||
  (path.startsWith('/storage/v1/')&&!/^\/storage\/v1\/(?:object|render\/image)\/public\//.test(path))||
  signed
}
