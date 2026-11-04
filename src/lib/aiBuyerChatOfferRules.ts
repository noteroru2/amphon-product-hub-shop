import {supabase} from './supabase';
export type ChatOfferRule={
 id:string;draft_id:string|null;title:string;category:string;cpu_family:string;cpu_generation:number;
 gpu_model:string;ram_options:number[];ssd_gb:number;opening_min:number;opening_max:number;
 exclude_gpu_variants:string[];require_functional:boolean;description:string;
 status:'PENDING'|'APPROVED_DRAFT'|'DISMISSED';created_at:string;reviewed_at:string|null;
};
export async function listChatOfferRules():Promise<ChatOfferRule[]>{
 if(!supabase)throw new Error('Supabase ไม่ได้เชื่อมต่อ');
 const {data,error}=await supabase.from('ai_buyer_chat_offer_rules')
 .select('id,draft_id,title,category,cpu_family,cpu_generation,gpu_model,ram_options,ssd_gb,opening_min,opening_max,exclude_gpu_variants,require_functional,description,status,created_at,reviewed_at')
 .order('created_at',{ascending:false}).limit(50);
 if(error)throw new Error(error.message);
 return (data??[]) as ChatOfferRule[];
}
export async function decideChatOfferRule(id:string,action:'APPROVE_DRAFT'|'DISMISS'):Promise<string>{
 if(!supabase)throw new Error('Supabase ไม่ได้เชื่อมต่อ');
 const {data,error}=await supabase.rpc('ai_buyer_chat_offer_rule_decide',{p_rule_id:id,p_action:action});
 if(error)throw new Error(error.message);
 return String(data);
}
