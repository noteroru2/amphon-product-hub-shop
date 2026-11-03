/** Server-side preflight. Never trust browser-side canApprove. */
export interface ApprovalGuardInput {
  categoryEnabled:boolean;
  categoryMode:string;
  caseState:string;
  offerDecisionId:string;
  latestDecisionId:string;
  offerAmount:number;
  decisionHardMax:number;
  decisionConfidence:number;
  priceSource:string;
  decisionVersionId:string|null;
  activeVersionId:string|null;
}
export type ApprovalGuardResult={allowed:true}|{allowed:false;reason:string};
const terminal=new Set(['OFFERED','ACCEPTED','COMPLETED','CANCELLED','EXPIRED','CUSTOMER_DECLINED']);
export function evaluateApprovalGuard(input:ApprovalGuardInput):ApprovalGuardResult {
  if(!input.categoryEnabled||input.categoryMode!=='APPROVAL')return {allowed:false,reason:'CATEGORY_NOT_IN_APPROVAL'};
  if(terminal.has(input.caseState))return {allowed:false,reason:'CASE_NOT_APPROVABLE_STATE'};
  if(!input.offerDecisionId||!input.latestDecisionId||input.offerDecisionId!==input.latestDecisionId)return {allowed:false,reason:'STALE_OFFER_DECISION'};
  if(!Number.isSafeInteger(input.offerAmount)||input.offerAmount<=0)return {allowed:false,reason:'OFFER_AMOUNT_INVALID'};
  if(!Number.isFinite(input.decisionHardMax)||input.decisionHardMax<=0)return {allowed:false,reason:'DECISION_HARD_MAX_INVALID'};
  if(!Number.isFinite(input.decisionConfidence)||input.decisionConfidence<0.85)return {allowed:false,reason:'DECISION_CONFIDENCE_LOW'};
  if(input.offerAmount>input.decisionHardMax)return {allowed:false,reason:'HARD_MAX_EXCEEDED'};
  if(input.priceSource==='PRICE_BOOK'){
    if(!input.decisionVersionId||!input.activeVersionId||input.decisionVersionId!==input.activeVersionId)
      return {allowed:false,reason:'STALE_OR_UNPUBLISHED_PRICEBOOK'};
  }
  if(!['PRICE_BOOK','SPEC_ENGINE','MARKET','ADMIN'].includes(input.priceSource))return {allowed:false,reason:'UNKNOWN_PRICE_SOURCE'};
  return {allowed:true};
}
