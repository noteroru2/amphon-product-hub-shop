import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../workers/evidence-publisher/index.mjs'
const E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',I='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const O='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const env={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SECRET_KEY:'synthetic-secret',
 SUPABASE_PUBLISHABLE_KEY:'synthetic-public',ALLOWED_ORIGINS:'https://hub.example.invalid'}
const payload={evidence_id:E,image_id:I,targets:[{site_id:'amphon',page_path:'/synthetic'}]}
async function exercise(options,action) {
 const saved=globalThis.fetch,calls=[]
 let inserts=0
 globalThis.fetch=async(input,init={})=>{
  const u=new URL(input);calls.push({path:u.pathname,method:init.method||'GET'})
  assert.equal(u.origin,env.SUPABASE_URL)
  if(u.pathname==='/auth/v1/user')return Response.json({id:O})
  const table=u.pathname.split('/').at(-1)
  if(table==='profiles')return Response.json([{role:options.role||'owner',active:options.active!==false}])
  if(table==='trade_evidence')return Response.json([{status:'APPROVED',approved_at:'2026-11-26',
   permission_confirmed:!options.revoked,privacy_reviewed:true,transaction_verified:false}])
  if(table==='trade_evidence_images')return Response.json([{id:I,evidence_id:options.wrongImage?O:E,
   approved_for_public:true,storage_path:E+'/'+I+'.jpg'}])
  if(table==='commerce_seo_portfolio_projects')return Response.json([{site_id:'amphon',
   production_repo:'synthetic/repo',production_branch:'main',central_deploy_allowed:false}])
  if(table==='commerce_seo_sites')return Response.json([{id:'amphon'}])
  if(table==='commerce_evidence_publication_requests') {
   const receipt={id:I,site_id:'amphon',page_path:'/synthetic',status:options.cancelled?'CANCELLED':'PENDING_SOURCE_PR'}
   if(init.method==='POST') {
    inserts++
    if(options.conflict)return new Response(null,{status:409})
    return Response.json([{...receipt,private_media_key:'private-key-not-for-client',requested_by:O}])
   }
   if(init.method==='PATCH')return Response.json(options.cancelRace?[]:[{...receipt,status:'CANCELLED'}])
   return Response.json(options.existing||inserts||options.cancel? [receipt]:[])
  }
  throw Error('UNEXPECTED_TEST_NETWORK')
 }
 const invoke=(body=JSON.stringify(payload),path='/api/stage')=>worker.fetch(new Request('https://worker.invalid'+path,{
  method:'POST',headers:{origin:env.ALLOWED_ORIGINS,authorization:'Bearer synthetic-session'},body}),env)
 try{return await action({invoke,calls})}finally{globalThis.fetch=saved}
}
test('Worker denies Admin, inactive Owner, revoked consent and another evidence image before queue writes',async()=>{
 for(const options of [{role:'admin'},{active:false},{revoked:true},{wrongImage:true}])
  await exercise(options,async({invoke,calls})=>{
   assert.ok([403,422].includes((await invoke()).status))
   assert.ok(!calls.some(c=>c.method==='POST'))
  })
})
test('Worker bounds chunked bytes and reports malformed JSON without leaking errors',async()=>{
 await exercise({},async({invoke})=>{
  for(const [input,code] of [['x','BODY_INVALID'],[' '.repeat(12001),'BODY_TOO_LARGE'],['"'+'ก'.repeat(5000)+'"','BODY_TOO_LARGE']]) {
   const response=await invoke(input)
   assert.equal(response.status,422)
   assert.equal((await response.json()).error,code)
  }
 })
})
test('Worker concurrent enqueue conflict returns existing receipt and never returns private fields',async()=>{
 for(const options of [{},{conflict:true},{existing:true}])await exercise(options,async({invoke})=>{
  const response=await invoke(),result=await response.json()
  assert.equal(response.status,201)
  assert.equal(result.requests.length,1)
  assert.deepEqual(Object.keys(result.requests[0]).sort(),['id','page_path','site_id','status'])
 })
 await exercise({conflict:true,cancelled:true},async({invoke})=>assert.equal((await invoke()).status,422))
})
test('Worker cancellation uses conditional status update and refuses an execution race',async()=>{
 for(const race of [false,true])await exercise({cancel:true,cancelRace:race},async({invoke})=>{
  const response=await invoke(JSON.stringify({request_id:I}),'/api/cancel')
  assert.equal(response.status,race?422:200)
  const result=await response.json()
  assert.equal(race?result.error:result.private_media_cleanup,race?'QUEUE_STATE_CHANGED':'DEFERRED_LOCKED_REVIEW')
 })
})
