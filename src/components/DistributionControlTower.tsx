import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShoppingBag, Zap } from "lucide-react";
import {
  getDistributionControlTower,
  refreshDistributionControlTower,
  type DistributionControlTower as Tower,
} from "../lib/channelSettings";
import type { ProductSummary, Profile } from "../types/product";

function pct(value:number){return Number.isFinite(value)?value.toFixed(1):"0.0"}
function fmtDate(value?:string|null){
  if(!value)return "-";
  return new Intl.DateTimeFormat("th-TH",{dateStyle:"short",timeStyle:"short"}).format(new Date(value));
}

export default function DistributionControlTower({
  profile,products,onEdit,
}:{
  profile:Profile;
  products:ProductSummary[];
  onEdit:(product:ProductSummary)=>void;
}){
  const [data,setData]=useState<Tower|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);

  const refresh=async(repair=false)=>{
    setBusy(repair);
    try{
      if(repair)await refreshDistributionControlTower();
      setData(await getDistributionControlTower());
      setError(null);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setLoading(false);setBusy(false);}
  };
  useEffect(()=>{void refresh();const id=window.setInterval(()=>void refresh(),60000);return()=>window.clearInterval(id)},[]);

  const byId=useMemo(()=>new Map(products.map(p=>[p.id,p])),[products]);
  const problems=useMemo(()=>data?.matrix.filter(x=>Number(x.coverage_pct)<100)??[],[data]);

  if(loading&&!data)return <div className="distribution-tower loading">กำลังโหลด Distribution Control Tower...</div>;
  return <section className="distribution-tower">
    <header className="distribution-tower-head">
      <div>
        <p className="eyebrow">SALES DISTRIBUTION</p>
        <h2>Distribution Control Tower</h2>
        <small>Coverage Matrix · Facebook Reliability · Sold Sync · Marketplace · Content→Sale</small>
      </div>
      <div className="distribution-tower-actions">
        {["owner","admin"].includes(profile.role)&&<button type="button" disabled={busy} onClick={()=>void refresh(true)}><Zap />ซ่อม/Sync ตอนนี้</button>}
        <button type="button" onClick={()=>void refresh()}><RefreshCw className={busy?"spin":""}/></button>
      </div>
    </header>

    {error&&<div className="distribution-error">{error}</div>}
    {data&&<>
      <div className="distribution-kpis">
        <div><span>Coverage</span><b>{pct(data.summary.coveragePct)}%</b><small>{data.summary.fullyDistributed}/{data.summary.totalEligible} SKU</small></div>
        <div><span>Missing</span><b>{data.summary.missing}</b><small>เป้าหมาย ≤5%</small></div>
        <div><span>Facebook Gap</span><b>{data.summary.facebookGap}</b><small>เพจที่ยังไม่ครบ</small></div>
        <div><span>Marketplace Pending</span><b>{data.summary.marketplacePending}</b><small>ต้องยืนยัน Manual</small></div>
        <div className={data.summary.criticalAlerts?"danger":""}><span>Critical Alerts</span><b>{data.summary.criticalAlerts}</b><small>Open {data.summary.openAlerts}</small></div>
      </div>

      <div className="distribution-health-row">
        <div className="distribution-health-card">
          <strong>Facebook Reliability</strong>
          <span>FAILED <b>{data.facebookHealth?.failed_jobs??0}</b></span>
          <span>Stuck <b>{data.facebookHealth?.stuck_jobs??0}</b></span>
          <span>Metric Error <b>{data.facebookHealth?.metric_errors??0}</b></span>
          <span>Last post <b>{fmtDate(data.facebookHealth?.last_posted_at)}</b></span>
        </div>
        <div className="distribution-health-card">
          <strong>Page Health</strong>
          {data.facebookConnections.map(x=><span key={x.connection_key} className={x.activation_status==="ACTIVE"&&!x.last_error?"ok":"bad"}>
            {x.label}: <b>{x.activation_status}</b>{x.last_error?" · ERROR":""}
          </span>)}
        </div>
      </div>

      {!!data.alerts.length&&<div className="distribution-alert-list">
        {data.alerts.slice(0,8).map(a=><div key={a.id} className={"distribution-alert "+a.severity.toLowerCase()}>
          <AlertTriangle/><span><b>{a.alert_type}</b><small>{String((a.details as any)?.sku||a.connection_key||"")} · {fmtDate(a.last_seen_at)}</small></span>
        </div>)}
      </div>}

      <div className="distribution-matrix-wrap">
        <div className="distribution-section-title"><strong>Coverage Matrix</strong><small>แสดงรายการที่ Coverage ยังไม่ครบก่อน · Strategy มาจาก Stock Turnover</small></div>
        <table className="distribution-matrix">
          <thead><tr><th>สินค้า</th><th>Strategy</th><th>SHOP</th><th>FB</th><th>Marketplace</th><th>LINE</th><th>Coverage</th><th></th></tr></thead>
          <tbody>
            {[...problems,...((data.matrix||[]).filter(x=>Number(x.coverage_pct)>=100))].slice(0,100).map(row=>{
              const product=byId.get(row.product_id);
              return <tr key={row.product_id} className={Number(row.coverage_pct)<100?"needs-work":""}>
                <td><b>{row.title}</b><small>{row.sku} · {row.stock_age_days} วัน</small></td>
                <td><span className={"strategy "+row.distribution_strategy.toLowerCase()}>{row.distribution_strategy}</span><small>FB {row.facebook_posts_per_week}x/wk</small></td>
                <td>{row.website_published?<CheckCircle2/>:<AlertTriangle/>}</td>
                <td><b>{row.facebook_live_pages}/{row.facebook_required_pages}</b></td>
                <td>{row.marketplace_required?(row.marketplace_published?<CheckCircle2/>:row.marketplace_posted?<span className="pending"><ShoppingBag/>รอ Verify URL</span>:<span className="pending"><ShoppingBag/>รอลง</span>):<span className="muted">ไม่บังคับ</span>}</td>
                <td>{row.line_shared?"✓":"—"}</td>
                <td><b>{pct(Number(row.coverage_pct))}%</b></td>
                <td>{product&&<button type="button" onClick={()=>onEdit(product)}>เปิดสินค้า</button>}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>

      <div className="distribution-learning">
        <div className="distribution-section-title"><strong>Content → Sale Learning</strong><small>นับ DIRECT attribution จาก AMPHON System เท่านั้น</small></div>
        <div className="distribution-learning-grid">
          {data.contentSales.slice(0,8).map(x=><div key={x.connection_key+":"+x.template_id}>
            <strong>{x.connection_key} · {x.template_id}</strong>
            <span>Posts {x.posts} · Measured {x.measured_posts}</span>
            <span>Direct sales <b>{x.direct_sales}</b> · Profit <b>{Number(x.direct_profit||0).toLocaleString("th-TH")}฿</b></span>
            <span>Sales /100 posts <b>{Number(x.direct_sales_per_100_posts||0).toFixed(2)}</b></span>
          </div>)}
          {!data.contentSales.length&&<div className="empty">รอข้อมูลขายใหม่จาก AMPHON System เพื่อเริ่ม Attribution</div>}
        </div>
      </div>
    </>}
  </section>;
}
