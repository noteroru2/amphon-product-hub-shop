const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const content=fs.readFileSync(path.join(__dirname,'../src/offer-approval-guard.ts'),'utf8');
const out=ts.transpileModule(content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
new Function('module','exports',out)(mod,mod.exports);
const {evaluateApprovalGuard:check}=mod.exports;
const good={categoryEnabled:true,categoryMode:'APPROVAL',caseState:'PRICING',offerDecisionId:'d1',latestDecisionId:'d1',offerAmount:10000,decisionHardMax:12000,decisionConfidence:0.95,priceSource:'PRICE_BOOK',decisionVersionId:'v1',activeVersionId:'v1'};
test('safe offer still only passes server preflight',()=>assert.deepEqual(check(good),{allowed:true}));
for(const [name,change,reason] of [
 ['rollout not active',{categoryEnabled:false},'CATEGORY_NOT_IN_APPROVAL'],
 ['category auto',{categoryMode:'AUTO'},'CATEGORY_NOT_IN_APPROVAL'],
 ['already offered',{caseState:'OFFERED'},'CASE_NOT_APPROVABLE_STATE'],
 ['old pricing',{offerDecisionId:'d0'},'STALE_OFFER_DECISION'],
 ['missing decision',{latestDecisionId:''},'STALE_OFFER_DECISION'],
 ['above hard max',{offerAmount:13000},'HARD_MAX_EXCEEDED'],
 ['negative offer',{offerAmount:-1},'OFFER_AMOUNT_INVALID'],
 ['zero hard max',{decisionHardMax:0},'DECISION_HARD_MAX_INVALID'],
 ['low confidence',{decisionConfidence:0.6},'DECISION_CONFIDENCE_LOW'],
 ['stale book',{activeVersionId:'v2'},'STALE_OR_UNPUBLISHED_PRICEBOOK'],
 ['no active book',{activeVersionId:null},'STALE_OR_UNPUBLISHED_PRICEBOOK'],
 ['no book version',{decisionVersionId:null},'STALE_OR_UNPUBLISHED_PRICEBOOK'],
 ['unknown source',{priceSource:'INVENTED'},'UNKNOWN_PRICE_SOURCE'],
])test(name,()=>assert.deepEqual(check({...good,...change}),{allowed:false,reason}));
test('spec engine may be versionless but must satisfy all other guards',()=>assert.deepEqual(check({...good,priceSource:'SPEC_ENGINE',decisionVersionId:null,activeVersionId:null}),{allowed:true}));
