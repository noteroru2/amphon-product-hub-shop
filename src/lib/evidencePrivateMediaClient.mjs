export async function loadPrivateEvidenceImage({baseUrl,publishableKey,accessToken,imageId,purpose,fetchImpl=fetch}) {
 const endpoint=new URL('/functions/v1/evidence-private-media',baseUrl)
 if(endpoint.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(endpoint.hostname))throw Error('PRIVATE_MEDIA_CONFIGURATION_REQUIRED')
 if(!accessToken)throw Error('PRIVATE_MEDIA_AUTH_REQUIRED')
 const response=await fetchImpl(endpoint,{method:'POST',headers:{apikey:publishableKey,
  authorization:'Bearer '+accessToken,'content-type':'application/json'},body:JSON.stringify({image_id:imageId,purpose}),
  cache:'no-store',redirect:'error',signal:AbortSignal.timeout(60000)})
 if(!response.ok||!/^image\/(jpeg|png|webp)(?:;|$)/i.test(response.headers.get('content-type')||''))throw Error('PRIVATE_MEDIA_ACCESS_DENIED')
 const blob=await response.blob()
 if(blob.size>8*1024*1024)throw Error('PRIVATE_MEDIA_SIZE_INVALID')
 return blob
}
