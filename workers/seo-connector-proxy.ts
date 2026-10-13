// Public discovery and transport proxy only. Credentials stay in the Edge Function.
const edge='https://mfpdtlxwdbxitgfzdape.supabase.co/functions/v1/seo-connector'
const discovery:Record<string,string>={
 '/.well-known/oauth-protected-resource/seo-connector/mcp':'/resource-metadata',
 '/.well-known/oauth-protected-resource':'/resource-metadata',
 '/.well-known/oauth-authorization-server/seo-connector':'/authorization-metadata',
 '/.well-known/oauth-authorization-server':'/authorization-metadata',
 '/seo-connector/.well-known/oauth-authorization-server':'/authorization-metadata',
}
export default {
 async fetch(req:Request,env:{ASSETS:{fetch:(req:Request)=>Promise<Response>}}) {
  const u=new URL(req.url),path=discovery[u.pathname]||(u.pathname.startsWith('/seo-connector/')?u.pathname.slice('/seo-connector'.length):null)
  if(!path)return env.ASSETS.fetch(req)
  if(!['/resource-metadata','/authorization-metadata','/mcp','/authorize','/token','/register','/revoke','/request','/consent','/disconnect'].includes(path))return new Response('Not found',{status:404})
  const h=new Headers(req.headers);h.delete('cookie');h.delete('host');
  return fetch(edge+path+u.search,{method:req.method,headers:h,body:['GET','HEAD'].includes(req.method)?undefined:req.body,redirect:'manual'})
 }
}
