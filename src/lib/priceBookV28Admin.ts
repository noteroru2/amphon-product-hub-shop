import {supabase} from './supabase';

export type Pb28Draft={id:string;title:string;status:'DRAFT'|'FROZEN'|'ARCHIVED';source_version_id:string|null;created_at:string;updated_at:string};
export type Pb28Entry={
 id:string;draft_id:string;category:string;brand:string;model:string;model_code:string;condition_key:string;
 estimated_resale:number;opening_offer:number;target_buy:number;hard_max:number;active:boolean;note:string;updated_at:string;
};
export type Pb28Row=Omit<Pb28Entry,'id'|'draft_id'|'updated_at'>;
export type Pb28Audit={id:number;draft_id:string;entry_id:string|null;actor_id:string;action:string;before_data:Record<string,unknown>|null;after_data:Record<string,unknown>|null;created_at:string};

function client(){if(!supabase)throw new Error('Supabase is not configured');return supabase;}
function checked<T>(data:T,error:{message:string}|null){if(error)throw new Error(error.message);return data;}

export async function listPb28Drafts(){
 const {data,error}=await client().from('ai_buyer_pb28_drafts').select('id,title,status,source_version_id,created_at,updated_at').order('updated_at',{ascending:false}).limit(100);
 return checked(data,error) as Pb28Draft[];
}
export async function listPb28Entries(draftId:string){
 const {data,error}=await client().from('ai_buyer_pb28_entries').select('id,draft_id,category,brand,model,model_code,condition_key,estimated_resale,opening_offer,target_buy,hard_max,active,note,updated_at').eq('draft_id',draftId).order('category').order('model').limit(1000);
 return checked(data,error) as Pb28Entry[];
}
export async function listPb28Audit(draftId:string){
 const {data,error}=await client().from('ai_buyer_pb28_audit').select('id,draft_id,entry_id,actor_id,action,before_data,after_data,created_at').eq('draft_id',draftId).order('id',{ascending:false}).limit(100);
 return checked(data,error) as Pb28Audit[];
}
export async function createPb28Draft(title:string,cloneActive:boolean){
 const {data,error}=await client().rpc('ai_buyer_pb28_create_draft',{p_title:title,p_clone_active:cloneActive});
 return checked(data,error) as string;
}
export async function savePb28Entry(draftId:string,entryId:string|null,row:Pb28Row){
 const {data,error}=await client().rpc('ai_buyer_pb28_save_entry',{p_draft_id:draftId,p_entry_id:entryId,p_row:row});
 return checked(data,error) as string;
}
export async function deletePb28Entry(draftId:string,entryId:string){
 const {data,error}=await client().rpc('ai_buyer_pb28_delete_entry',{p_draft_id:draftId,p_entry_id:entryId});
 return checked(data,error) as boolean;
}
export async function bulkPb28Edit(draftId:string,entryIds:string[],field:'estimated_resale'|'opening_offer'|'target_buy'|'hard_max',delta:number){
 const {data,error}=await client().rpc('ai_buyer_pb28_bulk_edit',{p_draft_id:draftId,p_entry_ids:entryIds,p_field:field,p_delta:delta});
 return checked(data,error) as number;
}
export async function importPb28Rows(draftId:string,rows:Pb28Row[]){
 if(rows.length===0||rows.length>250)throw new Error('นำเข้าได้ครั้งละ 1–250 รายการ');
 const {data,error}=await client().rpc('ai_buyer_pb28_import_rows',{p_draft_id:draftId,p_rows:rows});
 return checked(data,error) as number;
}

export async function managePb28Draft(draftId:string,action:'RENAME'|'FREEZE'|'REOPEN'|'ARCHIVE',title?:string){
 const {data,error}=await client().rpc('ai_buyer_pb28_manage_draft',{p_draft_id:draftId,p_action:action,p_title:title??null});
 return checked(data,error) as 'DRAFT'|'FROZEN'|'ARCHIVED';
}
