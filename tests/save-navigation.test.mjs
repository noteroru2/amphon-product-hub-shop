import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function compile(file, imports = {}) {
  const source = fs.readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), 'utf8').replaceAll('import.meta.env', '({VITE_R2_UPLOAD_API: "https://upload.test"})');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)((key) => {
    if (!(key in imports)) throw Error(`Unexpected import ${key}`);
    return imports[key];
  }, exports);
  return exports;
}
const schemas = compile('productSchemas');
const errors = compile('errors');
const { createHubNavigation } = compile('hubNavigation');
const profile = { id: 'employee', active: true, role: 'sales' };
const oldImage = { id: 'image-1', object_key: 'old.jpg', public_url: 'https://img.test/old.jpg', sort_order: 0, is_cover: true, image_role: 'cover' };
function fixture(overrides = {}) {
  const row = { id: 'product-1', sku: 'TEST-1', category: 'notebook', title: 'Legacy laptop', status: 'published', one_managed: true, price: 9000, specs: {}, product_images: [{...oldImage}], ...overrides };
  const calls = [];
  let rejectProductUpdate = false;
  let auditFailure = false;
  const db = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'employee' }, access_token: 'test' } } }) },
    rpc: async () => ({ data: [], error: null }),
    from(table) {
      const call = { table, operation: 'select', filters: [] }; calls.push(call);
      const chain = {
        select(fields) { call.fields = fields; return chain; },
        update(payload) { call.operation = 'update'; call.payload = payload; return chain; },
        insert(payload) { call.operation = 'insert'; call.payload = payload; return chain; },
        upsert(payload) { call.operation = 'upsert'; call.payload = payload; return chain; },
        delete() { call.operation = 'delete'; return chain; },
        eq(key, value) { call.filters.push([key, value]); return chain; },
        in(key, value) { call.filters.push([key, value]); return chain; },
        single() { call.single = true; return chain; },
        maybeSingle() { return chain; },
        then(resolve, reject) { return Promise.resolve().then(() => {
          if (table === 'products') {
            if (call.operation === 'update') {
              if (rejectProductUpdate) return { error: { message: 'No visible row', code: 'PGRST116' } };
              Object.assign(row, call.payload);
            }
            return { data: structuredClone(row), error: null };
          }
          if (table === 'product_images') {
            if (call.operation === 'insert') { const image = { id: `new-${row.product_images.length}`, ...call.payload }; row.product_images.push(image); return {data: image}; }
            if (call.operation === 'update') { const image = row.product_images.find(image => image.id === call.filters.find(([key]) => key === 'id')[1]); Object.assign(image, call.payload); return {data: image}; }
          }
          if (table === 'activity_logs' && auditFailure) throw Error('audit transport failed');
          return { data: null, error: null };
        }).then(resolve, reject); },
      };
      return chain;
    },
  };
  const api = compile('backend', { './supabase': { supabase: db }, './productSchemas': schemas, './errors': errors });
  const draft = api.draftFromProduct({ ...row, images: row.product_images.map(i => ({id:i.id,objectKey:i.object_key,publicUrl:i.public_url,sortOrder:i.sort_order,isCover:i.is_cover,imageRole:i.image_role})) }, profile.id);
  return { api, row, calls, draft, rejectUpdate: () => rejectProductUpdate = true, failAudit: () => auditFailure = true };
}

test('legacy published details save without republishing, rewriting photos or ONE prices', async () => {
  const f = fixture(); f.draft.notes = 'Updated notes';
  assert.throws(() => schemas.validateReadyToList(f.draft));
  const saved = await f.api.saveProduct(f.draft, profile);
  assert.equal(saved.notes, 'Updated notes'); assert.equal(saved.status, 'published');
  const writes = f.calls.filter(c => c.table === 'products' && c.operation === 'update');
  assert.equal(writes.length, 1); assert.equal(writes[0].single, true);
  assert.equal('status' in writes[0].payload, false); assert.equal('price' in writes[0].payload, false);
  assert.equal(f.calls.filter(c => c.table === 'product_images').length, 0);
  assert.ok(f.calls.filter(c => c.table === 'products').every(c => c.filters.some(([key,value]) => key === 'id' && value === 'product-1')));
});
test('new publish transition still rejects incomplete details before writes', async () => {
  const f = fixture({status:'draft'}); f.draft.status='ready_to_list';
  await assert.rejects(f.api.saveProduct(f.draft, profile), /ข้อมูลสำหรับลงขาย/);
  assert.equal(f.calls.some(c => c.operation === 'update'), false);
});
test('background System SOLD is not overwritten by an old open editor', async () => {
  const f=fixture(); f.row.status='sold'; f.draft.notes='Amended description';
  const saved=await f.api.saveProduct(f.draft,profile);
  assert.equal(saved.status,'sold'); assert.equal(saved.notes,'Amended description');
});
test('zero-row update is surfaced and does not proceed to images or success', async () => {
  const f=fixture(); f.rejectUpdate();
  await assert.rejects(f.api.saveProduct(f.draft,profile), error => error.code==='PGRST116');
  assert.equal(f.calls.some(c => c.table==='product_images'),false);
});
test('audit transport failure does not turn a completed product save into failure', async () => {
  const f=fixture(); f.failAudit();
  assert.equal((await f.api.saveProduct(f.draft,profile)).id,'product-1');
});
test('newly uploaded photos participate in the final saved order', async () => {
  const f=fixture(); f.draft.images.unshift({id:'upload-1',blob:new Blob(['image']),name:'new.jpg',order:0,isCover:false,imageRole:'other'});
  let checkpoint;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async () => ({ok:true,json:async () => ({objectKey:'new.jpg',publicUrl:'https://img.test/new.jpg'})});
  try { const saved=await f.api.saveProduct(f.draft,profile,{onUploadDone:(_id,remote) => checkpoint=remote});
    assert.ok(checkpoint.remoteImageId); assert.equal(saved.images[0].objectKey,'new.jpg'); assert.equal(saved.images[1].objectKey,'old.jpg');
  } finally { globalThis.fetch=originalFetch; }
});
test('Supabase error objects display useful messages', () => {
  assert.equal(errors.errorMessage({message:'Permission denied',details:'Account inactive'}),'Permission denied · Account inactive');
});

function fakeBrowser() {
  const entries=[{}];let position=0;let listener;
  const browser={
    history:{get state(){return entries[position];},replaceState(s){entries[position]=s;},pushState(s){entries.splice(position+1);entries.push(s);position++;},back(){this.go(-1);},go(delta){assert.notEqual(delta,0,'go(0) would reload the editor');const next=position+delta;if(next<0||next>=entries.length)return;position=next;listener?.({state:entries[position]});}},
    addEventListener(_name,fn){listener=fn;},removeEventListener(){listener=undefined;},
  };return browser;
}
test('Back restores actual originating pages and wizard steps; save exits to caller', () => {
  const browser=fakeBrowser();let route={tab:'home'};
  const nav=createHubNavigation(browser,route,next=>route=next,()=>true);
  nav.navigate({tab:'products'}); nav.navigate({tab:'add',draftId:'a',step:4}); nav.back();assert.equal(route.tab,'products');
  nav.navigate({tab:'scanner'});nav.navigate({tab:'add',draftId:'b',step:4});nav.navigate({tab:'add',draftId:'b',step:2});nav.navigate({tab:'add',draftId:'b',step:3});
  nav.back();assert.equal(route.step,2);nav.back();assert.equal(route.step,4);nav.exitEditor();assert.equal(route.tab,'scanner');
  nav.navigate({tab:'profile'});nav.navigate({tab:'employees'});browser.history.back();assert.equal(route.tab,'profile');
  browser.history.go(1);assert.equal(route.tab,'employees');nav.dispose();
});
test('browser Back during save restores its position without reload or route loss',()=>{
  const browser=fakeBrowser();let locked=false;let route={tab:'home'};
  const nav=createHubNavigation(browser,route,next=>route=next,()=>!locked);
  nav.navigate({tab:'add',draftId:'a',step:4});locked=true;browser.history.back();assert.equal(route.tab,'add');
  locked=false;nav.back();assert.equal(route.tab,'home');
});

test('partial upload retry submits only pending images and keeps completed checkpoints', async () => {
  const f=fixture();
  f.draft.images.push(...['a','b'].map((id,i)=>({id,blob:new Blob([id]),name:`${id}.jpg`,order:i+1,isCover:false,imageRole:'other'})));
  const originalFetch=globalThis.fetch;let attempts=0;
  globalThis.fetch=async()=>{attempts++;if(attempts===2)throw Error('network interrupted');return {ok:true,json:async()=>({objectKey:`upload-${attempts}.jpg`,publicUrl:`https://img.test/${attempts}.jpg`})};};
  const hooks={onUploadDone:(id,remote)=>{Object.assign(f.draft.images.find(image=>image.id===id),remote,{blob:undefined});}};
  try {
    await assert.rejects(f.api.saveProduct(f.draft,profile,hooks),/บางรูปอัปโหลดไม่สำเร็จ/);
    assert.ok(f.draft.images[1].remoteImageId);assert.equal(f.draft.images[2].remoteImageId,undefined);
    const saved=await f.api.saveProduct(f.draft,profile,hooks);
    assert.equal(attempts,3);assert.equal(saved.images.length,3);
    assert.equal(f.calls.filter(c=>c.table==='product_images'&&c.operation==='insert').length,2);
  } finally {globalThis.fetch=originalFetch;}
});
test('ONE-managed stock actions stay in System while ordinary detail edits stay available',()=>{
  const f=fixture();
  assert.equal(f.api.allowedStatuses('published','owner',true).includes('sold'),false);
  assert.equal(f.api.allowedStatuses('published','sales',true).includes('published'),true);
  assert.deepEqual(f.api.allowedStatuses('reserved','owner',true),['reserved']);
  assert.equal(f.api.allowedStatuses('published','owner',false).includes('sold'),true);
});

test('failed saves record the database error and write stage for system diagnosis',async()=>{
 const f=fixture();f.rejectUpdate();
 await assert.rejects(f.api.saveProduct(f.draft,profile));
 await new Promise(resolve=>setImmediate(resolve));
 const failure=f.calls.find(c=>c.table==='activity_logs'&&c.payload?.action==='product_save_failed');
 assert.equal(failure.payload.metadata.stage,'write_details');
 assert.equal(failure.payload.metadata.error_code,'PGRST116');
 assert.equal(failure.payload.metadata.error,'No visible row');
 assert.ok(failure.payload.metadata.attempt_id);
});
