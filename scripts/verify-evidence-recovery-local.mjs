// Standalone iterative synthetic rehearsal; refuses every hosted endpoint.
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import {runLocalRecoveryTests} from '../tests/helpers/evidence-recovery-local.mjs'
const locals=Object.fromEntries(readFileSync(process.env.EVIDENCE_LOCAL_ENV_FILE,'utf8').split(/\r?\n/)
 .filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1).trim().replace(/^"|"$/g,'')]}))
const api=locals.API_URL
if(api!=='http://127.0.0.1:55321')throw Error('NOT_ISOLATED_LOCAL_REFUSE_NETWORK')
const original=globalThis.fetch
globalThis.fetch=(input,init)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url)
 if(url.origin==='https://evidence-local-test.supabase.co')url.host='127.0.0.1:55321',url.protocol='http:'
 if(url.origin!==api)throw Error('SYNTHETIC_LOCAL_NETWORK_DENIED')
 return original(url,{...init,redirect:'error'})
}
try {
 const options={auth:{persistSession:false,autoRefreshToken:false}}
 const service=createClient(api,locals.SERVICE_ROLE_KEY,options),ownerClient=createClient(api,locals.ANON_KEY,options)
 const owner=await ownerClient.auth.signInWithPassword({email:'evidence-owner-synthetic@example.invalid',password:'SyntheticPassword-For-CI-2026!'})
 const admin=await createClient(api,locals.ANON_KEY,options).auth.signInWithPassword({email:'evidence-admin-synthetic@example.invalid',password:'SyntheticPassword-For-CI-2026!'})
 if(owner.error||admin.error)throw Error('SYNTHETIC_FIXTURE_SIGNIN_REQUIRED')
 await runLocalRecoveryTests({api,anon:locals.ANON_KEY,service,ownerClient,ownerId:owner.data.user.id,
  ownerToken:owner.data.session.access_token,adminToken:admin.data.session.access_token,serviceKey:locals.SERVICE_ROLE_KEY,locals,fetchImpl:globalThis.fetch})
}finally{globalThis.fetch=original}
