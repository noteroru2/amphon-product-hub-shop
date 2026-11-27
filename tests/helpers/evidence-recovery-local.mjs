import assert from 'node:assert/strict'
import {randomUUID,createHash,createHmac} from 'node:crypto'
import sharp from 'sharp'
import {storeAdapter} from '../../scripts/evidence-draft-pr.mjs'
import {stagePrivateEvidenceImage} from '../../scripts/evidence-image-sharp.mjs'
import {executeEvidenceDraftPr} from '../../scripts/evidence-draft-pr-core.mjs'
import {cleanupEvidenceMedia} from '../../scripts/evidence-cleanup.mjs'
import {reconcileEvidenceOperation} from '../../scripts/evidence-reconcile.mjs'
import {createPrivateMediaHandler} from '../../supabase/functions/_shared/evidence-private-media.mjs'
import {createClient} from '@supabase/supabase-js'

export async function runLocalRecoveryTests({api,anon,service,ownerClient,ownerId,ownerToken,adminToken,serviceKey,locals,fetchImpl}) {
 let checks=0
 const check=async(name,fn)=>{await fn();checks++;console.log('PASS RECOVERY LOCAL: '+name)}
 const unwrap=out=>{assert.equal(out.error,null,out.error?.message);return out.data}
 const input=await sharp({create:{width:160,height:120,channels:3,background:'#735f2a'}}).jpeg().toBuffer()
 const objects=new Map();let uploads=0,deletes=0,losePut=false,loseDelete=false
 const remote={async downloadPrivate(){return input},async headPrivate(key){return objects.get(key)?.head||null},
  async putPrivate(key,bytes){assert.equal(objects.has(key),false);uploads++;
   objects.set(key,{bytes,head:{sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,etag:'"'+createHash('md5').update(bytes).digest('hex')+'"'}});
   if(losePut){losePut=false;throw Error('synthetic response loss')}},
  async deletePrivate(key){deletes++;objects.delete(key);if(loseDelete){loseDelete=false;throw Error('synthetic response loss')}}}
 const seed=async()=>{
  const e=randomUUID(),i=randomUUID(),q=randomUUID(),key='evidence/'+e+'/'+i+'.webp'
  unwrap(await service.from('trade_evidence').insert({id:e,kind:'purchase',status:'APPROVED',
   permission_confirmed:true,privacy_reviewed:true,approved_at:new Date().toISOString(),transaction_verified:false,title:'Synthetic recovery case'}))
  unwrap(await service.from('trade_evidence_images').insert({id:i,evidence_id:e,storage_path:e+'/'+i+'.jpg',approved_for_public:true}))
  unwrap(await service.from('commerce_evidence_publication_requests').insert({id:q,evidence_id:e,image_id:i,
   site_id:'amphon',page_path:new URL('/บริการ/รับซื้อโน๊ตบุ๊ค','https://synthetic.invalid').pathname,
   private_media_key:key,claim_kind:'ASSESSMENT_ONLY',requested_by:ownerId}))
  const store=storeAdapter('https://evidence-local-test.supabase.co',serviceKey)
  return {e,i,q,key,store}
 }
 const approve=async(kind,key,op,etag)=>unwrap(await ownerClient.rpc('evidence_owner_approve',{
  p_kind:kind,p_key:key,p_operation:op||null,p_etag:etag||null,p_quiescent:true}))
 const recover=async(s,kind)=>{const op=await s.store.operations.lookup(kind+':'+(kind==='PR'?s.q:s.key));
  s.store.recoveryApproval=await approve('RECOVER',s.key,op.id);return op}
 const stage=s=>stagePrivateEvidenceImage(s.q,{store:s.store,remote,dryRun:false})
 const cancel=s=>service.from('commerce_evidence_publication_requests').update({status:'CANCELLED'}).eq('id',s.q).then(unwrap)
 const clock=(s,enabled=true,expire=null)=>service.rpc('synthetic_retention_clock',{p_key:s.key,p_enabled:enabled,p_expire:expire}).then(unwrap)

 const s=await seed()
 await check('lost PUT response persists uncertainty; unauthorized retry cannot repeat upload',async()=>{
  losePut=true
  await assert.rejects(stage(s),/RECONCILIATION_REQUIRED/)
  assert.equal((await s.store.operations.lookup('STAGE:'+s.key)).state,'UNCERTAIN')
  const count=uploads;await assert.rejects(stage(s));assert.equal(uploads,count)
 })
 await check('Owner quiescent recovery HEAD-verifies existing object and fences the old executor',async()=>{
  const old=await recover(s,'STAGE'),count=uploads
  assert.equal((await stage(s)).outcome,'PRIVATE_WEBP_STAGED');assert.equal(uploads,count)
  await assert.rejects(s.store.operations.assert(old))
  const events=await s.store.operations.audit(old.id)
  assert.ok(events.some(e=>e.event==='UNCERTAIN_HELD'))
  assert.ok(events.some(e=>e.event==='OWNER_QUIESCENT_RECOVERY'))
  assert.ok(events.some(e=>e.event==='DONE'))
 })
 const c=await seed()
 await check('crash after object verification before DB checkpoint is recovered without re-upload',async()=>{
  const original=c.store.operations.checkpoint;c.store.operations.checkpoint=async()=>{throw Error('synthetic DB outage')}
  await assert.rejects(stage(c));c.store.operations.checkpoint=original
  const count=uploads;await recover(c,'STAGE');await stage(c);assert.equal(uploads,count)
 })
 await check('lost checkpoint response preserves the committed object proof and safely reconciles',async()=>{
  const t=await seed(),checkpoint=t.store.operations.checkpoint
  t.store.operations.checkpoint=async(...args)=>{await checkpoint(...args);throw Error('synthetic checkpoint response loss')}
  await assert.rejects(stage(t));t.store.operations.checkpoint=checkpoint
  const op=await t.store.operations.lookup('STAGE:'+t.key);assert.ok(op.checkpoints.object)
  const count=uploads;await recover(t,'STAGE');await stage(t);assert.equal(uploads,count)
 })
 await check('parallel stages cannot share an active reservation or duplicate the object',async()=>{
  const t=await seed(),results=await Promise.allSettled([stage(t),stage(t)])
  assert.ok(results.some(r=>r.status==='fulfilled'))
  assert.equal(objects.has(t.key),true)
  assert.ok(results.every(r=>r.status==='rejected'||r.value.outcome==='PRIVATE_WEBP_STAGED'))
 })
 await check('committed DB stage receipt with lost response retries by HEAD without a second upload',async()=>{
  const t=await seed(),finish=t.store.operations.finish
  t.store.operations.finish=async op=>{await finish(op);throw Error('synthetic receipt response lost')}
  await assert.rejects(stage(t));t.store.operations.finish=finish
  const count=uploads
  assert.equal((await t.store.operations.lookup('STAGE:'+t.key)).state,'DONE')
  await stage(t);assert.equal(uploads,count)
 })
 await check('negative HEAD after an uncertain PUT never authorizes a second upload or unlocks cleanup',async()=>{
  const t=await seed(),put=remote.putPrivate
  remote.putPrivate=async()=>{throw Error('synthetic connection lost before visible commit')}
  try {await assert.rejects(stage(t))}finally{remote.putPrivate=put}
  const count=uploads;await recover(t,'STAGE');await assert.rejects(stage(t));assert.equal(uploads,count)
  const op=await t.store.operations.lookup('STAGE:'+t.key)
  assert.equal(op.state,'UNCERTAIN')
 })
 await check('cancellation during PUT requires read-only reconciliation and never reports queue success',async()=>{
  const t=await seed(),put=remote.putPrivate
  remote.putPrivate=async(key,bytes)=>{await put(key,bytes);await cancel(t)}
  try {await assert.rejects(stage(t))}finally{remote.putPrivate=put}
  const operation=await t.store.operations.lookup('STAGE:'+t.key),count=uploads
  const approval=await approve('RECOVER',t.key,operation.id)
  const result=await reconcileEvidenceOperation({opKey:'STAGE:'+t.key,approval,store:t.store,remote})
  assert.equal(result.outcome,'REMOTE_EFFECT_RECONCILED_AUTHORIZATION_BLOCKED');assert.equal(uploads,count)
  assert.equal(unwrap(await service.from('commerce_evidence_publication_requests').select('status').eq('id',t.q).single()).status,'CANCELLED')
 })
 const source='---\ntitle: "Synthetic"\n---\n\n# Synthetic case\n\n## ส่งรูปเช็กราคาโน๊ตบุ๊คก่อนตัดสินใจ\n'
 const refs=new Map(),pulls=new Map();let text='',prs=0,losePr=true
 const github={async getBranchHead(){return 'a'.repeat(40)},async getBranchRef(repo,b){return refs.get(b)||null},
  async getPullsForHead(repo,b){return pulls.get(b)||[]},async getOverlappingOpenPrs(){return []},
  async getFile(repo,path,sha){return {type:'file',size:source.length,blob_sha:'b'.repeat(40),content:sha==='d'.repeat(40)?text:source}},
  async getCommitTree(){return 'b'.repeat(40)},async createTree(repo,base,files){text=files[0].content;return 'c'.repeat(40)},
  async createCommit(){return 'd'.repeat(40)},async createBranch(repo,b,sha){assert.equal(refs.has(b),false);refs.set(b,sha)},
  async getCommitReview(){return {parents:[{sha:'a'.repeat(40)}],changedFiles:[{filename:'src/content/services/รับซื้อโน๊ตบุ๊ค.md'}]}},
  async createDraftPr(repo,p){assert.equal(pulls.has(p.head),false);prs++;const number=80+prs,pr={state:'open',draft:true,number,html_url:'https://github.com/'+repo+'/pull/'+number,
   head:{ref:p.head,sha:'d'.repeat(40),repo:{full_name:repo}},base:{ref:p.base,repo:{full_name:repo}}};pulls.set(p.head,[pr]);
   if(losePr){losePr=false;throw Error('synthetic PR response lost')}return {draft:true,number,url:pr.html_url}}}
 await check('crash after PR creation recovers exact verified Draft PR without duplicate creation',async()=>{
  await assert.rejects(executeEvidenceDraftPr(s.q,{store:s.store,github,dryRun:false}))
  assert.equal(prs,1)
  await recover(s,'PR')
  const result=await executeEvidenceDraftPr(s.q,{store:s.store,github,dryRun:false})
  assert.equal(result.outcome,'DRAFT_PR_RECOVERED');assert.equal(prs,1)
  const row=unwrap(await service.from('commerce_evidence_publication_requests').select('status').eq('id',s.q).single())
  assert.equal(row.status,'DRAFT_PR_OPEN')
 })
 await check('crash between branch creation and PR creation resumes the exact branch once',async()=>{
  const t=await seed();await stage(t)
  const original=t.store.operations.checkpoint
  t.store.operations.checkpoint=async(op,phase,value)=>{if(phase==='branch')throw Error('synthetic crash after branch');return original(op,phase,value)}
  await assert.rejects(executeEvidenceDraftPr(t.q,{store:t.store,github,dryRun:false}))
  t.store.operations.checkpoint=original
  const count=prs;await recover(t,'PR')
  await executeEvidenceDraftPr(t.q,{store:t.store,github,dryRun:false});assert.equal(prs,count+1)
 })
 await check('lost final PR receipt response commits queue and journal atomically; retry records no duplicate',async()=>{
  const t=await seed();await stage(t)
  const finish=t.store.operations.finish
  t.store.operations.finish=async op=>{await finish(op);throw Error('synthetic final receipt loss')}
  await assert.rejects(executeEvidenceDraftPr(t.q,{store:t.store,github,dryRun:false}))
  t.store.operations.finish=finish
  assert.equal((await t.store.operations.lookup('PR:'+t.q)).state,'DONE')
  const count=prs,result=await executeEvidenceDraftPr(t.q,{store:t.store,github,dryRun:false})
  assert.equal(result.outcome,'ALREADY_RECORDED');assert.equal(prs,count)
 })
 await check('cancellation during PR creation is reconciled without promoting a cancelled queue',async()=>{
  const t=await seed();await stage(t)
  const create=github.createDraftPr
  github.createDraftPr=async(...args)=>{const pr=await create(...args);await cancel(t);return pr}
  try {await assert.rejects(executeEvidenceDraftPr(t.q,{store:t.store,github,dryRun:false}))}finally{github.createDraftPr=create}
  const op=await t.store.operations.lookup('PR:'+t.q),approval=await approve('RECOVER',t.key,op.id),count=prs
  const result=await reconcileEvidenceOperation({opKey:'PR:'+t.q,approval,store:t.store,github})
  assert.equal(result.outcome,'REMOTE_EFFECT_RECONCILED_AUTHORIZATION_BLOCKED');assert.equal(result.state,'BLOCKED');assert.equal(prs,count)
 })
 await check('cleanup is disabled by default, holds active references and requires Owner approval',async()=>{
  await assert.rejects(cleanupEvidenceMedia({key:c.key,store:c.store,remote}),/DISABLED/)
  await clock(c,false)
  const approval=await approve('DELETE',c.key,null,objects.get(c.key).head.etag)
  await assert.rejects(cleanupEvidenceMedia({key:c.key,approval,store:c.store,remote,enabled:true}))
  await clock(c,true)
  await assert.rejects(cleanupEvidenceMedia({key:c.key,approval,store:c.store,remote,enabled:true}))
  assert.equal(deletes,0)
 })
 await check('expired approval and a freshly cancelled reference both hold deletion',async()=>{
  await cancel(c)
  const approval=await approve('DELETE',c.key,null,objects.get(c.key).head.etag)
  await assert.rejects(cleanupEvidenceMedia({key:c.key,approval,store:c.store,remote,enabled:true}))
  await clock(c,true,approval)
  await assert.rejects(cleanupEvidenceMedia({key:c.key,approval,store:c.store,remote,enabled:true}))
  assert.equal(deletes,0)
 })
 await check('a shared active request and concurrent cancellation both prevent deletion',async()=>{
  const shared=randomUUID()
  unwrap(await service.from('commerce_evidence_publication_requests').insert({id:shared,evidence_id:c.e,image_id:c.i,
   site_id:'winner',page_path:'/synthetic-shared',private_media_key:c.key,claim_kind:'ASSESSMENT_ONLY',requested_by:ownerId}))
  const approval=await approve('DELETE',c.key,null,objects.get(c.key).head.etag)
  await clock(c,true)
  const results=await Promise.allSettled([
   service.from('commerce_evidence_publication_requests').update({status:'CANCELLED'}).eq('id',shared).then(unwrap),
   cleanupEvidenceMedia({key:c.key,approval,store:c.store,remote,enabled:true})])
  assert.equal(results[1].status,'rejected');assert.equal(deletes,0)
  await clock(c,true)
 })
 await check('lost DELETE response keeps permanent tombstone; quiescent retry verifies absence without deleting twice',async()=>{
  const etag=objects.get(c.key).head.etag,approval=await approve('DELETE',c.key,null,etag)
  loseDelete=true
  await assert.rejects(cleanupEvidenceMedia({key:c.key,approval,store:c.store,remote,enabled:true}))
  assert.equal(deletes,1)
  const row=unwrap(await service.from('commerce_evidence_publication_requests').select('*').eq('id',c.q).single())
  const reuse=await service.from('commerce_evidence_publication_requests').insert({...row,id:randomUUID(),page_path:'/synthetic-reuse',status:'PENDING_SOURCE_PR'})
  assert.ok(reuse.error)
  const op=await c.store.operations.lookup('DELETE:'+c.key)
  const recoveryApproval=await approve('RECOVER',c.key,op.id)
  const fresh=await approve('DELETE',c.key,null,etag)
  await cleanupEvidenceMedia({key:c.key,approval:fresh,recoveryApproval,store:c.store,remote,enabled:true})
  assert.equal(deletes,1)
  await cleanupEvidenceMedia({key:c.key,approval:fresh,store:c.store,remote,enabled:true})
  assert.equal(deletes,1)
 })
 await clock(c,false)

 // Genuine local authenticated private access. Upload only a generated image.
 unwrap(await service.storage.from('trade-evidence-private').upload(s.e+'/'+s.i+'.jpg',input,{contentType:'image/jpeg'}))
 const handler=createPrivateMediaHandler({url:api,key:anon,allowedOrigin:'https://hub.amphon.co.th',fetchImpl})
 const invoke=(token,purpose='EXPORT')=>handler(new Request('https://synthetic.invalid/private',{method:'POST',
  headers:{origin:'https://hub.amphon.co.th',authorization:'Bearer '+token},body:JSON.stringify({image_id:s.i,purpose})}))
 await check('private handler rechecks real Owner authorization; anonymous/Admin exports fail and responses are no-store',async()=>{
  const response=await invoke(ownerToken);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/)
  assert.equal((await response.arrayBuffer()).byteLength,input.length)
  assert.equal((await invoke(adminToken)).status,403)
  assert.equal((await invoke('invalid')).status,401)
 })
 await check('expired local JWT and revoked consent block both private handler and direct Storage download',async()=>{
  const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
  const payload=encode({sub:ownerId,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)-1})
  const unsigned=encode({alg:'HS256',typ:'JWT'})+'.'+payload
  const jwt=unsigned+'.'+createHmac('sha256',locals.JWT_SECRET).update(unsigned).digest('base64url')
  assert.equal((await invoke(jwt)).status,401)
  unwrap(await service.from('trade_evidence').update({permission_confirmed:false}).eq('id',s.e))
  assert.equal((await invoke(ownerToken)).status,403)
  assert.ok((await ownerClient.storage.from('trade-evidence-private').download(s.e+'/'+s.i+'.jpg')).error)
  unwrap(await service.from('trade_evidence').update({permission_confirmed:true}).eq('id',s.e))
 })
 await check('inactive Owner cannot obtain a recovery approval or private bytes',async()=>{
  unwrap(await service.from('profiles').update({active:false}).eq('id',ownerId))
  try {assert.equal((await invoke(ownerToken)).status,403)
   const result=await ownerClient.rpc('evidence_owner_approve',{p_kind:'DELETE',p_key:s.key,p_etag:objects.get(s.key).head.etag,p_quiescent:true})
   assert.ok(result.error)
  }finally{unwrap(await service.from('profiles').update({active:true}).eq('id',ownerId))}
 })
 await check('service role cannot impersonate an approving Owner; browser roles cannot execute the journal',async()=>{
  assert.ok((await service.rpc('evidence_owner_approve',{p_kind:'DELETE',p_key:s.key,p_etag:objects.get(s.key).head.etag,p_quiescent:true})).error)
  assert.ok((await ownerClient.rpc('evidence_operation',{p_action:'lookup',p:{op_key:'STAGE:'+s.key}})).error)
 })
 await check('read-only status hides executor capabilities; missing and superseded tokens are fenced',async()=>{
  const t=await seed(),input={kind:'STAGE',op_key:'STAGE:'+t.key,key:t.key,request_id:t.q,fingerprint:'a'.repeat(64),digest:'a'.repeat(64)}
  const old=await t.store.operations.begin(input),status=await t.store.operations.lookup(input.op_key)
  assert.equal(status.token,undefined)
  assert.equal((await t.store.operations.forRequest(t.q))[0].token,undefined)
  assert.ok((await service.rpc('evidence_operation',{p_action:'checkpoint',p:{id:old.id,phase:'object',value:{etag:'"synthetic"'}}})).error)
  const approval=await approve('RECOVER',t.key,old.id)
  const current=await t.store.operations.begin({...input,approval})
  assert.notEqual(current.token,old.token)
  await assert.rejects(t.store.operations.assert(old))
  await t.store.operations.assert(current)
 })
 await check('revoked approval stops cleanup before any remote deletion',async()=>{
  const t=await seed();await stage(t);await cancel(t);await clock(t,true)
  const approval=await approve('DELETE',t.key,null,objects.get(t.key).head.etag),count=deletes
  unwrap(await ownerClient.rpc('evidence_owner_revoke_approval',{p_approval:approval}))
  await assert.rejects(cleanupEvidenceMedia({key:t.key,approval,store:t.store,remote,enabled:true}))
  assert.equal(deletes,count)
 })
 await check('signed-out session cannot fetch private pixels or spend an existing cleanup approval',async()=>{
  const t=await seed();await stage(t);await cancel(t);await clock(t,true)
  const sessionClient=createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false}})
  const login=unwrap(await sessionClient.auth.signInWithPassword({email:'evidence-owner-synthetic@example.invalid',password:'SyntheticPassword-For-CI-2026!'}))
  const token=login.session.access_token
  const approval=unwrap(await sessionClient.rpc('evidence_owner_approve',{p_kind:'DELETE',p_key:t.key,p_etag:objects.get(t.key).head.etag,p_quiescent:true}))
  unwrap(await sessionClient.auth.signOut({scope:'local'}))
  assert.ok([401,403].includes((await invoke(token)).status))
  const direct=await fetchImpl(new URL('/storage/v1/object/authenticated/trade-evidence-private/'+s.e+'/'+s.i+'.jpg',api),{
   headers:{apikey:anon,authorization:'Bearer '+token},redirect:'error',cache:'no-store'})
  assert.equal(direct.ok,false)
  const count=deletes
  await assert.rejects(cleanupEvidenceMedia({key:t.key,approval,store:t.store,remote,enabled:true}))
  assert.equal(deletes,count)
 })
 await clock(c,false)
 if(process.env.EVIDENCE_LOCAL_EDGE_REQUIRED==='true') {
  const edge=token=>fetchImpl(new URL('/functions/v1/evidence-private-media',api),{method:'POST',
   headers:{apikey:anon,origin:'https://hub.amphon.co.th',authorization:'Bearer '+token,'content-type':'application/json'},
   body:JSON.stringify({image_id:s.i,purpose:'EXPORT'}),redirect:'error',cache:'no-store'})
  await check('actual local Edge runtime/gateway returns only authorized no-store private pixels',async()=>{
   const response=await edge(ownerToken);assert.equal(response.status,200)
   assert.match(response.headers.get('cache-control'),/no-store/)
   assert.equal((await response.arrayBuffer()).byteLength,input.length)
   assert.equal((await edge(adminToken)).status,403)
   assert.equal((await edge('invalid')).status,401)
  })
  await check('actual local Edge runtime denies revoked consent on the next request',async()=>{
   unwrap(await service.from('trade_evidence').update({permission_confirmed:false}).eq('id',s.e))
   try {assert.equal((await edge(ownerToken)).status,403)}finally{unwrap(await service.from('trade_evidence').update({permission_confirmed:true}).eq('id',s.e))}
  })
 }
 console.log('PASS RECOVERY LOCAL TOTAL: '+checks+' scenarios; real persistent SQL/Auth/Storage; only synthetic in-memory R2/GitHub')
}
