/** PriceBook V2.8 — deterministic preview ONLY. No LINE sends, no payout, no DB writes. */
export type Deduction = {code:string;repairCost:number;residualLoss?:number;riskReserve?:number};
export type Logistics = {method:"IN_STORE"|"PARCEL"|"PICKUP";province?:string;verified?:boolean;shipping?:number;packaging?:number;insurance?:number;pickup?:number;handling?:number;risk?:number};
export type PriceInput = {
 versionId:string;versionStatus:"DRAFT"|"TESTING"|"ACTIVE"|"ARCHIVED";entryId?:string;
 modelConfirmed:boolean;conditionConfirmed:boolean;ownershipClear:boolean;
 resale?:number;targetProfit?:number;processing?:number;warranty?:number;marketCeiling?:number;
 deductions?:Deduction[];logistics:Logistics;offer?:number;
};
export type PriceResult={status:"BLOCKED"|"PREVIEW_ONLY"|"READY_FOR_APPROVAL";reasons:string[];maximumBuy:number|null;breakdown:Record<string,number>|null;requiresOwnerApproval:true;canSendLine:false;versionId:string};
const valid=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
const val=(n?:number)=>n??0;
export function previewPriceV28(x:PriceInput):PriceResult {
 const reasons:string[]=[];
 const output:PriceResult={status:"BLOCKED",reasons,maximumBuy:null,breakdown:null,requiresOwnerApproval:true,canSendLine:false,versionId:x.versionId};
 if(!x.versionId?.trim()) reasons.push("VERSION_MISSING");
 if(!x.entryId?.trim()) reasons.push("ENTRY_MISSING");
 if(!x.modelConfirmed) reasons.push("MODEL_UNCONFIRMED");
 if(!x.conditionConfirmed) reasons.push("CONDITION_UNCONFIRMED");
 if(!x.ownershipClear) reasons.push("OWNERSHIP_RISK");
 for(const [name,n] of [["RESALE",x.resale],["PROFIT",x.targetProfit],["PROCESSING",x.processing],["WARRANTY",x.warranty]] as const)
   if(!valid(n)||(name==="RESALE"&&n===0)) reasons.push(name+"_INVALID");
 if(x.marketCeiling!==undefined&&!valid(x.marketCeiling)) reasons.push("MARKET_CEILING_INVALID");
 if(x.offer!==undefined&&!valid(x.offer)) reasons.push("OFFER_INVALID");
 const seen=new Set<string>();
 for(const d of x.deductions??[]){
  if(!d.code?.trim()||seen.has(d.code)) reasons.push("DUPLICATE_OR_MISSING_DEFECT");
  seen.add(d.code);
  if([d.repairCost,d.residualLoss,d.riskReserve].some(n=>n!==undefined&&!valid(n))) reasons.push("DEFECT_AMOUNT_INVALID");
 }
 const l=x.logistics;
 if(!l||!["IN_STORE","PARCEL","PICKUP"].includes(l.method)) reasons.push("LOGISTICS_INVALID");
 else {
  if([l.shipping,l.packaging,l.insurance,l.pickup,l.handling,l.risk].some(n=>n!==undefined&&!valid(n))) reasons.push("LOGISTICS_COST_INVALID");
  if(l.method!=="IN_STORE"&&(!l.province?.trim()||l.verified!==true)) reasons.push("PROVINCIAL_COST_UNVERIFIED");
 }
 if(reasons.length) return output;
 const condition=(x.deductions??[]).reduce((sum,d)=>sum+d.repairCost+val(d.residualLoss)+val(d.riskReserve),0);
 const logistics=val(l.shipping)+val(l.packaging)+val(l.insurance)+val(l.pickup)+val(l.handling)+val(l.risk);
 const raw=x.resale!-x.targetProfit!-x.processing!-x.warranty!-condition-logistics;
 const ceiling=Math.max(0,Math.floor(Math.min(raw,x.marketCeiling??Infinity)));
 output.maximumBuy=ceiling;
 output.breakdown={resale:x.resale!,profit:x.targetProfit!,processing:x.processing!,warranty:x.warranty!,condition,logistics,marketCeiling:x.marketCeiling??0};
 if(!ceiling) reasons.push("NO_POSITIVE_CEILING");
 if(x.offer!==undefined&&x.offer>ceiling) reasons.push("HARD_MAX_EXCEEDED");
 if(reasons.length) return output;
 if(x.versionStatus!=="ACTIVE"){output.status="PREVIEW_ONLY";reasons.push("VERSION_NOT_ACTIVE");return output;}
 output.status="READY_FOR_APPROVAL";return output;
}
