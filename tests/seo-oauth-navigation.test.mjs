import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText
const code=compile(readFileSync(new URL('../src/lib/seoAuthorizationRecovery.ts',import.meta.url),'utf8'))
const {seoAuthorizationRecovery}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
test('older PWA authorization shell resumes on the owned Edge endpoint with the entire OAuth request unchanged',()=>{
 const search='?response_type=code&client_id=fixture&state=state%2Bvalue&code_challenge=pkce&code_challenge_method=S256&scope=seo%3Aread%20seo%3Adraft&resource=https%3A%2F%2Fhub.amphon.co.th%2Fseo-connector%2Fmcp&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Ffixture'
 assert.equal(seoAuthorizationRecovery({origin:'https://hub.amphon.co.th',pathname:'/seo-connector/authorize',search}),'https://mfpdtlxwdbxitgfzdape.supabase.co/functions/v1/seo-connector/authorize'+search)
 for(const pathname of ['/','/seo-connector/mcp','/seo-connector/authorize-other'])assert.equal(seoAuthorizationRecovery({origin:'https://hub.amphon.co.th',pathname,search}),null)
 assert.equal(seoAuthorizationRecovery({origin:'https://evil.test',pathname:'/seo-connector/authorize',search}),null)
 assert.equal(seoAuthorizationRecovery({origin:'https://hub.amphon.co.th',pathname:'/seo-connector/authorize',search:'?redirect_uri=https://evil.test'}),null)
})
test('new service worker leaves OAuth/MCP navigations to the server and keeps normal Hub navigation offline-capable',()=>{
 const source=compile(readFileSync(new URL('../vite.config.ts',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace('export default','return')
 const config=new Function('defineConfig','react','VitePWA',source)(x=>x,()=>({}),x=>x)
 const denylist=config.plugins[1].workbox.navigateFallbackDenylist
 for(const path of ['/seo-connector/authorize?state=fixture','/seo-connector/mcp','/.well-known/oauth-protected-resource/seo-connector/mcp','/.well-known/oauth-authorization-server/seo-connector'])assert.equal(denylist.some(re=>re.test(path)),true,path)
 for(const path of ['/','/?seo_mcp_request=fixture','/?tab=seo','/products'])assert.equal(denylist.some(re=>re.test(path)),false,path)
})
