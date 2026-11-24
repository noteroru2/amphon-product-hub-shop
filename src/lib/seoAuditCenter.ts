import { supabase } from './supabase'

export type AuditCategory = 'ALL'|'CONTENT'|'UX_UI'|'TECHNICAL'|'AEO_GEO'|'MEASUREMENT'
export type AuditPriority = 'ALL'|'P0'|'P1'|'P2'
export type AuditStatus = 'OPEN'|'BRIEF_READY'|'DISMISSED'

export interface AuditSite { id:string; label:string; origin:string }
export interface AuditMetric {
  site_id:string; window_days:number; start_date:string; end_date:string;
  clicks:number; impressions:number; ctr:number|null; position:number|null; dates_present:number
}
export interface AuditCatalogItem {
  code:string; site_id:string|null; category:Exclude<AuditCategory,'ALL'>;
  priority:Exclude<AuditPriority,'ALL'>; title:string; target_page:string|null;
  focus_query:string|null; finding:string; recommendation:string; acceptance:string;
  evidence_kind:string; source_issue_url:string; source_as_of:string
}
export interface AuditRun {
  id:string; requested_by:string; site_filter:string; category_filter:AuditCategory;
  priority_filter:AuditPriority; evidence_label:string; source_issue_url:string;
  source_as_of:string; gsc_snapshot:AuditMetric[]; created_at:string
}
export interface AuditTask extends Omit<AuditCatalogItem,'code'|'source_issue_url'|'source_as_of'> {
  id:number; run_id:string; template_code:string; status:AuditStatus;
  review_note:string; reviewed_at:string|null; created_at:string
}
export interface AuditCenterData { sites:AuditSite[]; catalog:AuditCatalogItem[]; runs:AuditRun[] }

function client(){
  if(!supabase) throw new Error('ยังไม่ได้เชื่อมฐานข้อมูล AMPHON')
  return supabase
}

export async function loadAuditCenter():Promise<AuditCenterData>{
  const db=client()
  const [sites,catalog,runs]=await Promise.all([
    db.from('commerce_seo_sites').select('id,label,origin').eq('enabled',true).order('id'),
    db.from('commerce_seo_audit_catalog').select('*').order('code'),
    db.from('commerce_seo_audit_runs').select('*').order('created_at',{ascending:false}).limit(30),
  ])
  for(const r of [sites,catalog,runs]) if(r.error) throw new Error(r.error.message)
  return {
    sites:sites.data as AuditSite[] || [],
    catalog:catalog.data as AuditCatalogItem[] || [],
    runs:runs.data as AuditRun[] || [],
  }
}
export async function loadAuditTasks(runId:string):Promise<AuditTask[]>{
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,28}$/i.test(runId)) throw new Error('รหัส Audit ไม่ถูกต้อง')
  const {data,error}=await client().from('commerce_seo_audit_tasks')
    .select('*').eq('run_id',runId).order('priority').order('template_code')
  if(error) throw new Error(error.message)
  return data as AuditTask[] || []
}
export function matchingAuditCatalog(catalog:AuditCatalogItem[],site:string,category:AuditCategory,priority:AuditPriority,validSites:Set<string>):AuditCatalogItem[]{
  return catalog.filter(t=>
    (!t.site_id||validSites.has(t.site_id)) &&
    (site==='ALL'||!t.site_id||t.site_id===site) &&
    (category==='ALL'||t.category===category) &&
    (priority==='ALL'||t.priority===priority)
  )
}
export async function startAuditRun(site:string,category:AuditCategory,priority:AuditPriority){
  const {data,error}=await client().rpc('seo_audit_center_manage',{
    p_action:'create_run',
    p_data:{site_id:site,category,priority,request_key:crypto.randomUUID()}
  })
  if(error) throw new Error(error.message)
  if(!data?.id||data?.generated_live_crawl!==false||data?.production_deployed!==false)throw new Error('ตรวจผลรับรอง Audit ไม่ผ่าน')
  return data as {id:string;tasks:number;generated_live_crawl:false;site_edits_performed:false;github_pr_created:false;production_deployed:false}
}
export async function setAuditTaskStatus(taskId:number,status:AuditStatus,note=''){
  const {data,error}=await client().rpc('seo_audit_center_manage',{
    p_action:'review_task',p_data:{task_id:taskId,status,note}
  })
  if(error) throw new Error(error.message)
  if(data?.task_id!==taskId||data?.status!==status||data?.production_deployed!==false)throw new Error('ระบบยืนยันสถานะไม่ตรงกัน')
  return data
}
export function buildAuditWorkOrder(task:AuditTask,run:AuditRun,site?:AuditSite):string {
  const scope=task.site_id ? site?.label||task.site_id : 'เว็บไซต์ที่เลือกในรายงาน / ตรวจแยกตามเว็บก่อนแก้'
  const relevant=run.gsc_snapshot.filter(r=>!task.site_id||r.site_id===task.site_id)
  const baselines=relevant.map(m=>
    m.site_id+': '+m.start_date+' ถึง '+m.end_date+' (GSC FINAL '+m.window_days+' วัน); clicks='+m.clicks+', impressions='+m.impressions+', CTR='+(m.ctr??'ไม่มี')+', avg_position='+(m.position??'ไม่มี')
  ).join('\n')
  return [
    'AMPHON SEO Audit & AI Improvement Center — งานสำหรับ ChatGPT ตรวจหลักฐานและเตรียมแผนเท่านั้น',
    'Audit Source: '+run.source_issue_url+' (ผลตรวจ ณ '+run.source_as_of+')',
    'Audit Run: '+run.id+' / Catalog: '+task.template_code+' / Priority: '+task.priority+' / Type: '+task.category,
    'เว็บไซต์: '+scope,
    'เป้าหมายหน้า: '+(task.target_page||'ต้องระบุ URL จริงหลังตรวจ GitHub/GSC'),
    'คำค้น: '+(task.focus_query||'ต้องตรวจ Keyword Ownership ก่อน'),
    'ข้อค้นพบจากรอบแรก: '+task.finding,
    'แนวทางที่เสนอ: '+task.recommendation,
    'เกณฑ์รับงาน: '+task.acceptance,
    'หลักฐานแหล่งข้อมูล: '+task.evidence_kind,
    'Baseline รายเว็บไซต์ (GSC ไม่ใช่ SERP):\n'+(baselines||'ไม่มี snapshot ของไซต์นี้ ต้องตรวจ GSC FINAL ก่อน'),
    'ข้อกำหนด: อ่านข้อมูลและ Source จริงล่าสุดก่อนเสนอแก้ไข; ตรวจ Canonical, URL และ Keyword Ownership; ห้ามสร้างราคาหรือเคสรับซื้อ/รีวิว/สาขาปลอม ห้ามนำข้อมูลส่วนบุคคลลงเว็บ',
    'ให้ส่งกลับ: 1) Findings ที่มีหลักฐาน 2) แผนแก้ Content / UX/UI / Technical ตามขอบเขต 3) File-by-file proposed diff 4) QA checklist 5) GSC before/after methodology 7/14/28 วัน',
    'สำคัญ: ห้ามแก้ Production, Merge, Deploy หรือสร้าง PR จากการคัดลอก Brief นี้โดยอัตโนมัติ ต้องใช้ Source Change Request + Owner Approval + Draft PR/CI + release approval แยกกัน',
  ].join('\n\n')
}
