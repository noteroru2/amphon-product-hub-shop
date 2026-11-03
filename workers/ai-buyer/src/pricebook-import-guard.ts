/** Fail-closed import activation policy. Draft imports cannot mutate live category rules. */
export function resolvePriceBookImportPolicy(input:{activate?:boolean;categoryRuleCount:number}){
 if(input.categoryRuleCount>0) throw new Error('UNVERSIONED_CATEGORY_RULES_BLOCKED');
 if(input.activate!==undefined&&typeof input.activate!=='boolean')throw new Error('ACTIVATE_FLAG_INVALID');
 return {activate:input.activate===true};
}
