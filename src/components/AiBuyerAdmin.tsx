import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Banknote,
  ChevronLeft,
  CircleDollarSign,
  CircleOff,
  HandCoins,
  LoaderCircle,
  MessageCircle,
  PackageCheck,
  RefreshCw,
  Send,
  ShieldCheck,
  ShoppingBag,
  Store,
  WalletCards,
  XCircle,
} from "lucide-react";
import type { ProductSummary, Profile } from "../types/product";
import {
  loadAiBuyerCase,
  loadAiBuyerDashboard,
  loadAiBuyerOwnerModel,
  saveAiBuyerFinalOutcome,
  saveAiBuyerLedgerLine,
  saveAiBuyerOwnerPricebookReview,
  type AiBuyerCaseDetail,
  type AiBuyerDashboardCase,
  type AiBuyerDealSummary,
  type AiBuyerLedgerLine,
  type AiBuyerOwnerPricebookReview,
  type AiBuyerOwnerModelResponse,
} from "../lib/aiBuyerAdmin";
import "../styles/aiBuyerAdmin.css";

type CaseFilter = "active" | "needs-label" | "purchased" | "all";

type PricebookReviewDraft = {
  openingOffer: string;
  targetBuy: string;
  hardMax: string;
  note: string;
};

type LedgerDraft = {
  id?: string;
  lineNo: number;
  productId: string;
  status: string;
  purchasePrice: string;
  repairCost: string;
  partsCost: string;
  transportCost: string;
  warrantyCost: string;
  channelFee: string;
  otherCost: string;
  salePrice: string;
  saleChannel: string;
  salePriceVerified: boolean;
  note: string;
};

const privilegedRoles = new Set<Profile["role"]>(["owner", "admin"]);

function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(n) + " ฿";
}

function compactMoney(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(n);
}

function usd(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: n > 0 && n < 0.01 ? 4 : 2,
  }).format(n);
}

function pct(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 }).format(n) + "%";
}

function when(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function numberOrNull(value: string) {
  const clean = value.replace(/,/g, "").trim();
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function caseStateLabel(state: string) {
  const labels: Record<string, string> = {
    NEW: "เคสใหม่",
    IDENTIFYING_PRODUCT: "กำลังระบุสินค้า",
    COLLECTING_PHOTOS: "รอข้อมูล",
    NEED_MORE_INFO: "รอข้อมูล",
    READY_TO_PRICE: "พร้อมตีราคา",
    PRICING: "กำลังตีราคา",
    OFFERED: "เสนอราคาแล้ว",
    NEGOTIATING: "กำลังต่อรอง",
    ACCEPTED: "ตกลงราคา",
    COLLECTING_FULFILLMENT: "รอส่งมอบ",
    ACTION_REQUIRED: "ต้องดำเนินการ",
    ADMIN_ASSIGNED: "Admin รับเคส",
    COMPLETED: "ซื้อสำเร็จ",
    HUMAN_REVIEW: "ตรวจโดยคน",
    CUSTOMER_DECLINED: "ลูกค้าไม่ขาย",
    EXPIRED: "ไม่มีการตอบกลับ",
    CANCELLED: "ยกเลิก",
  };
  return labels[state] || state;
}

function outcomeLabel(value?: string | null) {
  const labels: Record<string, string> = {
    AGREED_PENDING_HANDOVER: "ตกลงราคา / รอรับของ",
    PURCHASED: "ซื้อสำเร็จ",
    CUSTOMER_DECLINED_PRICE: "ลูกค้าไม่ขายเพราะราคา",
    CUSTOMER_NO_RESPONSE: "ลูกค้าไม่ตอบ",
    SOLD_ELSEWHERE: "ขายให้ที่อื่น",
    CONDITION_REJECTED: "สภาพไม่ผ่าน",
    IDENTITY_MISMATCH: "รุ่น/สเปกไม่ตรง",
    OWNERSHIP_RISK: "ติดล็อก/ความเป็นเจ้าของ",
    OUTSIDE_POLICY: "นอกนโยบายรับซื้อ",
    CANCELLED_OTHER: "ยกเลิกอื่น ๆ",
  };
  return value ? labels[value] || value : "ยังไม่ระบุผล";
}

function blankLedger(line?: AiBuyerLedgerLine | null): LedgerDraft {
  return {
    id: line?.id,
    lineNo: line?.line_no || 1,
    productId: line?.product_id || "",
    status: line?.status || "PENDING",
    purchasePrice: line?.purchase_price == null ? "" : String(line.purchase_price),
    repairCost: String(line?.repair_cost || 0),
    partsCost: String(line?.parts_cost || 0),
    transportCost: String(line?.transport_cost || 0),
    warrantyCost: String(line?.warranty_cost || 0),
    channelFee: String(line?.channel_fee || 0),
    otherCost: String(line?.other_cost || 0),
    salePrice: line?.sale_price == null ? "" : String(line.sale_price),
    saleChannel: line?.sale_channel || "",
    salePriceVerified: Boolean(line?.sale_price_verified),
    note: line?.note || "",
  };
}

function SummaryCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="ai-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function CaseListItem({
  item,
  active,
  onClick,
}: {
  item: AiBuyerDashboardCase;
  active: boolean;
  onClick: () => void;
}) {
  const label = item.finalOutcome?.label;
  return (
    <button
      type="button"
      className={"ai-case-card" + (active ? " active" : "")}
      onClick={onClick}
    >
      <div className="ai-case-head">
        <div>
          <strong>{item.title || "ยังไม่ระบุสินค้า"}</strong>
          <small>
            {item.customer?.displayName || "ลูกค้า LINE"} · {item.category || "ไม่ทราบหมวด"}
          </small>
        </div>
        {item.needsFinalLabel && <span className="ai-need-label">รอปิดผล</span>}
      </div>
      <p>{item.lastMessage?.text || (item.lastMessage?.type === "IMAGE" ? "📷 รูปภาพ" : "ยังไม่มีข้อความ")}</p>
      <div className="ai-case-meta">
        <span>{caseStateLabel(item.state)}</span>
        {item.pricing?.targetBuy != null && (
          <span>Target {money(item.pricing.targetBuy)}</span>
        )}
        {label && <span>{outcomeLabel(label)}</span>}
      </div>
      {item.deal?.grossProfit != null && (
        <div className={"ai-profit-inline " + (Number(item.deal.grossProfit) >= 0 ? "positive" : "negative")}>
          กำไรจริง {money(item.deal.grossProfit)}
        </div>
      )}
    </button>
  );
}

function PriceStrip({ detail }: { detail: AiBuyerCaseDetail }) {
  const pricing = detail.pricing[0];
  if (!pricing) {
    return <div className="ai-empty-mini">ยังไม่มี Pricing Decision</div>;
  }
  return (
    <div className="ai-price-strip">
      <div><span>Opening</span><strong>{money(pricing.opening_offer)}</strong></div>
      <div><span>Target</span><strong>{money(pricing.target_buy)}</strong></div>
      <div><span>Hard max</span><strong>{money(pricing.hard_max)}</strong></div>
      <div><span>Resale</span><strong>{money(pricing.estimated_resale)}</strong></div>
    </div>
  );
}

function ProfitSummary({ summary }: { summary?: AiBuyerDealSummary | null }) {
  if (!summary) return <div className="ai-empty-mini">ยังไม่มีข้อมูล Profit Ledger</div>;
  return (
    <div className="ai-profit-grid">
      <div><span>ซื้อจริง</span><strong>{money(summary.purchase_total)}</strong></div>
      <div><span>ต้นทุนรวม</span><strong>{money(summary.total_cost)}</strong></div>
      <div><span>ขายจริง</span><strong>{money(summary.sale_total)}</strong></div>
      <div className={Number(summary.gross_profit || 0) >= 0 ? "profit" : "loss"}>
        <span>กำไรขั้นต้น</span><strong>{money(summary.gross_profit)}</strong>
      </div>
    </div>
  );
}

export function AiBuyerAdmin({
  profile,
  products,
  onBack,
}: {
  profile: Profile;
  products: ProductSummary[];
  onBack: () => void;
}) {
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof loadAiBuyerDashboard>> | null>(null);
  const [ownerModel, setOwnerModel] = useState<AiBuyerOwnerModelResponse | null>(null);
  const [ownerModelLoading, setOwnerModelLoading] = useState(false);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, PricebookReviewDraft>>({});
  const [detail, setDetail] = useState<AiBuyerCaseDetail | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<CaseFilter>("active");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [outcome, setOutcome] = useState("");
  const [agreedPrice, setAgreedPrice] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");

  const [ledgerDraft, setLedgerDraft] = useState<LedgerDraft>(blankLedger());

  const canAccess = privilegedRoles.has(profile.role);

  async function refreshDashboard(keepSelected = true) {
    if (!canAccess) return;
    setLoading(true);
    setError(null);
    try {
      const next = await loadAiBuyerDashboard();
      setDashboard(next);
      const candidate =
        keepSelected && selectedId && next.cases.some((item) => item.id === selectedId)
          ? selectedId
          : next.cases[0]?.id || "";
      if (candidate && candidate !== selectedId) setSelectedId(candidate);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshOwnerModel() {
    if (!canAccess) return;
    setOwnerModelLoading(true);
    try {
      const next = await loadAiBuyerOwnerModel();
      setOwnerModel(next);
      setReviewDrafts((current) => {
        const output = { ...current };
        for (const row of next.pricebookReviews) {
          if (!output[row.case_id]) {
            output[row.case_id] = {
              openingOffer: String(row.final_opening_offer),
              targetBuy: String(row.final_target_buy),
              hardMax: String(row.final_hard_max),
              note: row.review_note || "",
            };
          }
        }
        return output;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOwnerModelLoading(false);
    }
  }

  async function reviewPricebook(row: AiBuyerOwnerPricebookReview, status: "APPROVED" | "REJECTED") {
    const draft = reviewDrafts[row.case_id] || {
      openingOffer: String(row.final_opening_offer),
      targetBuy: String(row.final_target_buy),
      hardMax: String(row.final_hard_max),
      note: row.review_note || "",
    };
    const openingOffer = numberOrNull(draft.openingOffer);
    const targetBuy = numberOrNull(draft.targetBuy);
    const hardMax = numberOrNull(draft.hardMax);
    if (openingOffer == null || targetBuy == null || hardMax == null) {
      setError("กรุณากรอกราคา Opening / Target / Hard max ให้ครบ");
      return;
    }
    if (openingOffer > targetBuy || targetBuy > hardMax) {
      setError("ราคาต้องเรียง Opening ≤ Target ≤ Hard max");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveAiBuyerOwnerPricebookReview({
        caseId: row.case_id,
        status,
        openingOffer,
        targetBuy,
        hardMax,
        note: draft.note || null,
      });
      setNotice(status === "APPROVED" ? "อนุมัติ Owner Price Book candidate แล้ว" : "ปฏิเสธ candidate แล้ว");
      await refreshOwnerModel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function refreshDetail(caseId = selectedId) {
    if (!caseId || !canAccess) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setError(null);
    try {
      const next = await loadAiBuyerCase(caseId);
      setDetail(next);
      const final = next.finalOutcome;
      setOutcome(final?.final_label || "");
      setAgreedPrice(final?.final_agreed_price == null ? "" : String(final.final_agreed_price));
      setPurchasePrice(final?.purchase_price == null ? "" : String(final.purchase_price));
      setOutcomeNote(final?.note || "");
      setLedgerDraft(blankLedger(next.ledger[0] || null));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void refreshDashboard(false);
    void refreshOwnerModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, profile.role]);

  useEffect(() => {
    if (selectedId) void refreshDetail(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(t);
  }, [notice]);

  const cases = useMemo(() => {
    const all = dashboard?.cases || [];
    const q = query.trim().toLowerCase();
    return all.filter((item) => {
      if (
        q &&
        ![
          item.title,
          item.category,
          item.customer?.displayName,
          item.lastMessage?.text,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      ) return false;

      if (filter === "needs-label") return Boolean(item.needsFinalLabel);
      if (filter === "purchased") return item.finalOutcome?.label === "PURCHASED";
      if (filter === "active") {
        return !["COMPLETED", "CUSTOMER_DECLINED", "EXPIRED", "CANCELLED"].includes(item.state);
      }
      return true;
    });
  }, [dashboard, filter, query]);

  const selected = dashboard?.cases.find((item) => item.id === selectedId) || null;

  const ledgerEstimate = useMemo(() => {
    const purchase = numberOrNull(ledgerDraft.purchasePrice) || 0;
    const extras = [
      ledgerDraft.repairCost,
      ledgerDraft.partsCost,
      ledgerDraft.transportCost,
      ledgerDraft.warrantyCost,
      ledgerDraft.channelFee,
      ledgerDraft.otherCost,
    ].reduce((sum, value) => sum + (numberOrNull(value) || 0), 0);
    const total = purchase + extras;
    const sale = numberOrNull(ledgerDraft.salePrice);
    return {
      total,
      profit: sale == null ? null : sale - total,
    };
  }, [ledgerDraft]);

  if (!canAccess) {
    return (
      <section className="screen page-pad ai-buyer-admin">
        <header className="topbar">
          <button className="icon-btn" onClick={onBack}><ChevronLeft /></button>
          <div><p className="eyebrow">ADMIN ONLY</p><h1>AI Buyer</h1></div>
        </header>
        <div className="ai-access-denied">
          <ShieldCheck />
          <strong>เมนูนี้สำหรับ Owner / Admin เท่านั้น</strong>
          <p>บัญชีพนักงาน Sales และ Technician จะไม่เห็นและเรียก API นี้ไม่ได้</p>
        </div>
      </section>
    );
  }

  async function saveOutcome(label = outcome) {
    if (!selectedId || !label) return;
    const agreed = numberOrNull(agreedPrice);
    const purchased = numberOrNull(purchasePrice);
    if (label === "AGREED_PENDING_HANDOVER" && agreed == null) {
      setError("กรุณาระบุราคาที่ตกลง");
      return;
    }
    if (label === "PURCHASED" && purchased == null && agreed == null) {
      setError("กรุณาระบุราคาซื้อจริง");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveAiBuyerFinalOutcome({
        caseId: selectedId,
        finalLabel: label,
        finalAgreedPrice: agreed,
        purchasePrice: purchased,
        reasonCode: label,
        note: outcomeNote.trim() || null,
      });
      setOutcome(label);
      setNotice("บันทึก Final Deal Label แล้ว");
      await Promise.all([refreshDetail(selectedId), refreshDashboard()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveLedger() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const product = products.find((item) => item.id === ledgerDraft.productId);
      await saveAiBuyerLedgerLine({
        id: ledgerDraft.id,
        caseId: selectedId,
        lineNo: ledgerDraft.lineNo,
        productId: ledgerDraft.productId || null,
        itemTitle: product?.title || detail?.case.title || null,
        category: detail?.case.category || product?.category || null,
        model: product?.model || null,
        sku: product?.sku || null,
        status: ledgerDraft.status,
        purchasePrice: numberOrNull(ledgerDraft.purchasePrice),
        repairCost: numberOrNull(ledgerDraft.repairCost) || 0,
        partsCost: numberOrNull(ledgerDraft.partsCost) || 0,
        transportCost: numberOrNull(ledgerDraft.transportCost) || 0,
        warrantyCost: numberOrNull(ledgerDraft.warrantyCost) || 0,
        channelFee: numberOrNull(ledgerDraft.channelFee) || 0,
        otherCost: numberOrNull(ledgerDraft.otherCost) || 0,
        salePrice: numberOrNull(ledgerDraft.salePrice),
        saleChannel: ledgerDraft.saleChannel.trim() || null,
        soldAt:
          ledgerDraft.status === "SOLD" && numberOrNull(ledgerDraft.salePrice) != null
            ? new Date().toISOString()
            : null,
        salePriceVerified: ledgerDraft.salePriceVerified,
        note: ledgerDraft.note.trim() || null,
      });
      setNotice("บันทึก Profit Ledger แล้ว");
      await Promise.all([refreshDetail(selectedId), refreshDashboard()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen ai-buyer-admin">
      <header className="ai-admin-topbar">
        <button className="icon-btn" onClick={onBack}><ChevronLeft /></button>
        <div>
          <p className="eyebrow">ADMIN · AI BUYER</p>
          <h1>รับซื้อ / ปิดดีล</h1>
          <small>ตอบ LINE · Final Label · Profit Ledger</small>
        </div>
        <button
          className="refresh-button"
          onClick={() => {
            void refreshDashboard();
            void refreshOwnerModel();
          }}
          disabled={loading || ownerModelLoading}
        >
          <RefreshCw className={loading || ownerModelLoading ? "spin" : ""} />
        </button>
      </header>

      {notice && <div className="ai-admin-toast">{notice}</div>}
      {error && (
        <div className="ai-admin-error">
          <XCircle size={18} /> <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>ปิด</button>
        </div>
      )}

      <div className="ai-summary-grid">
        <SummaryCard label="เคส" value={String(dashboard?.summary.total || 0)} />
        <SummaryCard
          label="รอปิดผล"
          value={String(dashboard?.summary.needsFinalLabel || 0)}
          note="ควรกำกับผลจริง"
        />
        <SummaryCard label="ซื้อสำเร็จ" value={String(dashboard?.summary.purchased || 0)} />
        <SummaryCard
          label="กำไรที่บันทึก"
          value={money(dashboard?.summary.grossProfit || 0)}
        />
        <SummaryCard
          label="OpenAI เดือนนี้"
          value={
            dashboard?.openai?.status === "live"
              ? usd(dashboard.openai.monthToDate)
              : dashboard?.openai?.status === "not_configured"
                ? "ยังไม่เชื่อม"
                : "—"
          }
          note={dashboard?.openai?.status === "live" ? "Organization MTD" : "Cost API"}
        />
        <SummaryCard
          label="โหมดอัตโนมัติ"
          value={
            (dashboard?.modes || []).every((mode) => mode.mode === "SHADOW")
              ? "SHADOW"
              : "ตรวจสอบ"
          }
          note={`${(dashboard?.modes || []).filter((mode) => mode.mode === "SHADOW").length}/${dashboard?.modes?.length || 0} หมวด`}
        />
      </div>

      {dashboard?.learning && (
        <section className="ai-learning-strip">
          <div className="ai-learning-head">
            <div>
              <strong>Learning 5 วัน</strong>
              <small>
                {dashboard.learning.status === "CAPTURING"
                  ? `กำลังเก็บข้อมูล · เหลือประมาณ ${Math.max(0, Math.round(Number(dashboard.learning.hours_remaining || 0)))} ชม.`
                  : dashboard.learning.status}
              </small>
            </div>
            <span className={dashboard.learning.owner_manual_events > 0 ? "good" : "warn"}>
              OWNER_MANUAL {dashboard.learning.owner_manual_events}
            </span>
          </div>
          <div className="ai-learning-metrics">
            <div>
              <MessageCircle size={16} />
              <span>ลูกค้า</span>
              <strong>{dashboard.learning.customer_events}</strong>
            </div>
            <div>
              <Send size={16} />
              <span>คำตอบคุณ</span>
              <strong>{dashboard.learning.owner_manual_events}</strong>
            </div>
            <div>
              <Banknote size={16} />
              <span>ราคา Manual</span>
              <strong>{dashboard.learning.price_quote_labels}</strong>
            </div>
            <div>
              <BadgeCheck size={16} />
              <span>Final Label</span>
              <strong>{dashboard.learning.final_labeled_cases}</strong>
            </div>
            <div>
              <PackageCheck size={16} />
              <span>ซื้อจริง</span>
              <strong>{dashboard.learning.purchased_cases}</strong>
            </div>
          </div>
          {dashboard.learning.owner_manual_events === 0 && (
            <p>
              ตอนนี้มีข้อมูลลูกค้าแล้ว แต่ยังไม่มีคำตอบ OWNER_MANUAL จริง —
              ให้ตอบลูกค้าจากกล่องแชตในหน้านี้ เพื่อให้ระบบเรียนรู้สไตล์คุณโดยตรง
            </p>
          )}
        </section>
      )}

      <section className="ai-owner-model-panel">
        <div className="ai-owner-model-head">
          <div>
            <span className="ai-shadow-chip"><ShieldCheck size={15} /> SHADOW</span>
            <h2>Owner Model V2 · Compare & Calibrate</h2>
            <p>AI คิดก่อนคุณตอบ → เทียบราคาและบทสนทนา → เรียนจากกำไรจริง โดยยังไม่ปรับราคา live เอง</p>
          </div>
          <small>{ownerModelLoading ? "กำลังอัปเดต…" : "Promotion ต้องผ่าน gate ทุกข้อ"}</small>
        </div>

        <div className="ai-summary-grid owner-model">
          <SummaryCard label="AI ↔ Owner ราคา" value={String(ownerModel?.status?.paired_pricing_cases || 0)} note="เป้าหมาย ≥ 20 / หมวด" />
          <SummaryCard label="Shadow Chat ↔ Owner" value={String(ownerModel?.status?.conversation_shadow_pairs || 0)} note="เทียบคำตอบก่อนส่งจริง" />
          <SummaryCard label="Price Book รอตรวจ" value={String(ownerModel?.status?.pending_pricebook_reviews || 0)} note="อนุมัติ / แก้ / ปฏิเสธ" />
          <SummaryCard label="หมวดผ่าน Gate" value={String(ownerModel?.status?.promotion_ready_categories || 0)} note="ยังต้องอนุมัติโดยคน" />
        </div>

        <div className="ai-owner-style-strip">
          <span>ข้อความจริง {ownerModel?.style?.owner_messages || 0}</span>
          <span>Median {ownerModel?.style?.median_chars ?? "—"} ตัวอักษร</span>
          <span>ลงท้าย “ครับ” {pct(ownerModel?.style?.pct_with_khrap)}</span>
          <span>ใช้ ? {pct(ownerModel?.style?.pct_question_mark)}</span>
          <span>Style pairs {ownerModel?.style?.shadow_owner_pairs || 0}</span>
        </div>

        <div className="ai-owner-gates">
          {(ownerModel?.promotionGate || []).map((gate) => (
            <article key={gate.category} className={gate.ready_for_approval_review ? "ready" : ""}>
              <div className="ai-owner-gate-title">
                <strong>{gate.category}</strong>
                <span>{gate.ready_for_approval_review ? "พร้อม Review" : gate.current_mode}</span>
              </div>
              <div className="ai-owner-gate-metrics">
                <span>ราคา {gate.paired_cases}/20</span>
                <span>Error {pct(gate.median_abs_opening_error_pct)}</span>
                <span>Chat {gate.conversation_pairs}/20</span>
                <span>Replay {gate.replay_regression_cases} regression</span>
              </div>
              {!gate.ready_for_approval_review && Boolean(gate.blockers?.length) && (
                <small>{gate.blockers?.join(" · ")}</small>
              )}
            </article>
          ))}
        </div>

        <details className="ai-owner-details" open>
          <summary>
            <span>Price Book Review</span>
            <b>{ownerModel?.pricebookReviews.filter((row) => row.status === "PENDING").length || 0} รอตรวจ</b>
          </summary>
          <div className="ai-pricebook-review-grid">
            {(ownerModel?.pricebookReviews || []).map((row) => {
              const draft = reviewDrafts[row.case_id] || {
                openingOffer: String(row.final_opening_offer),
                targetBuy: String(row.final_target_buy),
                hardMax: String(row.final_hard_max),
                note: row.review_note || "",
              };
              return (
                <article key={row.case_id} className={"ai-pricebook-review " + row.status.toLowerCase()}>
                  <div className="ai-pricebook-review-head">
                    <div>
                      <strong>{row.model_name || row.model_code || row.brand || row.category || "สินค้า"}</strong>
                      <small>{row.category || "ไม่ทราบหมวด"} · {row.candidate_confidence || "—"} confidence</small>
                    </div>
                    <span>{row.status}</span>
                  </div>
                  <div className="ai-review-price-grid">
                    {([
                      ["openingOffer", "Opening"],
                      ["targetBuy", "Target"],
                      ["hardMax", "Hard max"],
                    ] as Array<[keyof Pick<PricebookReviewDraft, "openingOffer" | "targetBuy" | "hardMax">, string]>).map(([key, label]) => (
                      <label key={key}>
                        <span>{label}</span>
                        <input
                          inputMode="numeric"
                          value={draft[key]}
                          onChange={(event) =>
                            setReviewDrafts((current) => ({
                              ...current,
                              [row.case_id]: { ...draft, [key]: event.target.value },
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <input
                    className="ai-review-note"
                    value={draft.note}
                    onChange={(event) =>
                      setReviewDrafts((current) => ({
                        ...current,
                        [row.case_id]: { ...draft, note: event.target.value },
                      }))
                    }
                    placeholder="เหตุผลที่แก้ราคา / หมายเหตุ"
                  />
                  <div className="ai-review-actions">
                    <button type="button" className="success" disabled={busy} onClick={() => void reviewPricebook(row, "APPROVED")}>
                      <BadgeCheck size={16} /> อนุมัติ
                    </button>
                    <button type="button" className="danger" disabled={busy} onClick={() => void reviewPricebook(row, "REJECTED")}>
                      <CircleOff size={16} /> ปฏิเสธ
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </details>

        <details className="ai-owner-details">
          <summary><span>AI vs Owner · Pricing Error</span><b>{ownerModel?.status?.paired_pricing_cases || 0} paired</b></summary>
          <div className="ai-owner-table-wrap">
            <table className="ai-owner-table">
              <thead><tr><th>หมวด</th><th>Pairs</th><th>MAE</th><th>Median Opening Error</th><th>AI แพงเกิน &gt;10%</th></tr></thead>
              <tbody>
                {(ownerModel?.errorByCategory || []).map((row) => (
                  <tr key={row.category || "UNKNOWN"}>
                    <td>{row.category || "UNKNOWN"}</td><td>{row.paired_cases}</td><td>{money(row.mae_baht)}</td>
                    <td>{pct(row.median_abs_opening_error_pct)}</td><td>{row.unsafe_ai_opening_over_10pct_cases}</td>
                  </tr>
                ))}
                {!ownerModel?.errorByCategory.length && <tr><td colSpan={5}>ยังไม่มี paired case ใหม่หลังเปิด V2</td></tr>}
              </tbody>
            </table>
          </div>
        </details>

        <details className="ai-owner-details">
          <summary><span>Deal Economics</span><b>{ownerModel?.status?.sold_economic_cases || 0} sold cases</b></summary>
          <div className="ai-owner-table-wrap">
            <table className="ai-owner-table">
              <thead><tr><th>หมวด</th><th>ขายแล้ว</th><th>กำไรเฉลี่ย</th><th>ROI</th><th>ถือสต็อก Median</th></tr></thead>
              <tbody>
                {(ownerModel?.economics || []).map((row) => (
                  <tr key={row.category || "UNKNOWN"}>
                    <td>{row.category || "UNKNOWN"}</td><td>{row.sold_cases}</td><td>{money(row.avg_gross_profit)}</td>
                    <td>{pct(row.avg_roi_pct)}</td><td>{row.median_holding_days == null ? "—" : row.median_holding_days + " วัน"}</td>
                  </tr>
                ))}
                {!ownerModel?.economics.length && <tr><td colSpan={5}>บันทึกราคาซื้อจริงและราคาขายจริงเพื่อเริ่มเรียนกำไร</td></tr>}
              </tbody>
            </table>
          </div>
        </details>

        {Boolean(ownerModel?.conversationPairs.length) && (
          <details className="ai-owner-details">
            <summary><span>Conversation Shadow ล่าสุด</span><b>{ownerModel?.conversationPairs.length} คู่</b></summary>
            <div className="ai-shadow-conversation-list">
              {ownerModel?.conversationPairs.slice(0, 8).map((pair) => (
                <article key={pair.case_id + String(pair.owner_replied_at)}>
                  <small>{pair.category || "UNKNOWN"} · similarity {pct(pair.length_similarity_pct)}</small>
                  <p><b>AI:</b> {pair.ai_draft || "—"}</p>
                  <p><b>คุณ:</b> {pair.owner_actual || "—"}</p>
                </article>
              ))}
            </div>
          </details>
        )}
      </section>

      <div className="ai-admin-toolbar">
        <label>
          <MessageCircle size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหาลูกค้า / รุ่น / ข้อความ"
          />
        </label>
        <div className="ai-filter-pills">
          {([
            ["active", "กำลังคุย"],
            ["needs-label", "รอปิดผล"],
            ["purchased", "ซื้อแล้ว"],
            ["all", "ทั้งหมด"],
          ] as Array<[CaseFilter, string]>).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={filter === key ? "active" : ""}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={"ai-admin-workspace " + (selectedId ? "has-selection" : "")}>
        <aside className="ai-case-list">
          {loading && !dashboard ? (
            <div className="ai-loading"><LoaderCircle className="spin" /> กำลังโหลดเคส</div>
          ) : cases.length ? (
            cases.map((item) => (
              <CaseListItem
                key={item.id}
                item={item}
                active={item.id === selectedId}
                onClick={() => setSelectedId(item.id)}
              />
            ))
          ) : (
            <div className="ai-empty-mini">ไม่พบเคสในตัวกรองนี้</div>
          )}
        </aside>

        <div className="ai-case-detail">
          {!selectedId ? (
            <div className="ai-detail-empty">
              <MessageCircle />
              <strong>เลือกเคสเพื่อเริ่มทำงาน</strong>
            </div>
          ) : detailLoading && !detail ? (
            <div className="ai-loading"><LoaderCircle className="spin" /> กำลังโหลดบทสนทนา</div>
          ) : detail ? (
            <>
              <div className="ai-mobile-back">
                <button type="button" onClick={() => setSelectedId("")}>
                  <ChevronLeft size={17} /> รายการเคส
                </button>
              </div>

              <section className="ai-case-overview">
                <div className="ai-case-overview-head">
                  <div>
                    <span className="ai-state-chip">{caseStateLabel(detail.case.state)}</span>
                    <h2>{detail.case.title || "ยังไม่ระบุสินค้า"}</h2>
                    <p>
                      {detail.customer?.display_name || "ลูกค้า LINE"}
                      {detail.customer?.phone ? " · " + detail.customer.phone : ""}
                    </p>
                  </div>
                  {selected?.needsFinalLabel && (
                    <span className="ai-need-label large">ต้องปิดผลจริง</span>
                  )}
                </div>
                <PriceStrip detail={detail} />
                <p className="ai-chat-moved-note">
                  แชทถูกย้ายไปเมนู <b>LINE OA Chat</b> ด้านล่างแล้ว เพื่อให้ตอบลูกค้าและดูรูปได้สะดวกกว่า
                </p>
              </section>

              <section className="ai-panel">
                <div className="ai-panel-head">
                  <div><BadgeCheck /><strong>Final Deal Label</strong></div>
                  <small>{outcomeLabel(detail.finalOutcome?.final_label)}</small>
                </div>

                <div className="ai-outcome-quick">
                  <button
                    type="button"
                    className="success"
                    onClick={() => {
                      setOutcome("PURCHASED");
                      void saveOutcome("PURCHASED");
                    }}
                    disabled={busy}
                  >
                    <PackageCheck /> ซื้อสำเร็จ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOutcome("AGREED_PENDING_HANDOVER");
                      void saveOutcome("AGREED_PENDING_HANDOVER");
                    }}
                    disabled={busy}
                  >
                    <HandCoins /> ตกลง / รอรับของ
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      setOutcome("CUSTOMER_DECLINED_PRICE");
                      void saveOutcome("CUSTOMER_DECLINED_PRICE");
                    }}
                    disabled={busy}
                  >
                    <CircleOff /> ลูกค้าไม่ขาย
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      setOutcome("SOLD_ELSEWHERE");
                      void saveOutcome("SOLD_ELSEWHERE");
                    }}
                    disabled={busy}
                  >
                    <Store /> ขายที่อื่น
                  </button>
                </div>

                <div className="ai-form-grid">
                  <label>
                    <span>ราคาที่ตกลง</span>
                    <input
                      inputMode="numeric"
                      value={agreedPrice}
                      onChange={(event) => setAgreedPrice(event.target.value)}
                      placeholder="เช่น 5,200"
                    />
                  </label>
                  <label>
                    <span>ราคาซื้อจริง</span>
                    <input
                      inputMode="numeric"
                      value={purchasePrice}
                      onChange={(event) => setPurchasePrice(event.target.value)}
                      placeholder="ยอดจ่ายจริง"
                    />
                  </label>
                  <label className="wide">
                    <span>ผลลัพธ์</span>
                    <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
                      <option value="">ยังไม่ระบุ</option>
                      <option value="AGREED_PENDING_HANDOVER">ตกลง / รอรับของ</option>
                      <option value="PURCHASED">ซื้อสำเร็จ</option>
                      <option value="CUSTOMER_DECLINED_PRICE">ลูกค้าไม่ขายเพราะราคา</option>
                      <option value="CUSTOMER_NO_RESPONSE">ลูกค้าไม่ตอบ</option>
                      <option value="SOLD_ELSEWHERE">ขายให้ที่อื่น</option>
                      <option value="CONDITION_REJECTED">สภาพไม่ผ่าน</option>
                      <option value="IDENTITY_MISMATCH">รุ่น/สเปกไม่ตรง</option>
                      <option value="OWNERSHIP_RISK">ติดล็อก/ความเป็นเจ้าของ</option>
                      <option value="OUTSIDE_POLICY">นอกนโยบายรับซื้อ</option>
                      <option value="CANCELLED_OTHER">ยกเลิกอื่น ๆ</option>
                    </select>
                  </label>
                  <label className="wide">
                    <span>หมายเหตุ</span>
                    <input
                      value={outcomeNote}
                      onChange={(event) => setOutcomeNote(event.target.value)}
                      placeholder="เหตุผล/รายละเอียดที่ควรให้ระบบเรียนรู้"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="ai-secondary-action"
                  onClick={() => void saveOutcome()}
                  disabled={busy || !outcome}
                >
                  <BadgeCheck size={17} /> บันทึกผลดีล
                </button>
              </section>

              <section className="ai-panel">
                <div className="ai-panel-head">
                  <div><CircleDollarSign /><strong>Profit Ledger</strong></div>
                  <small>กำไรจริงหลังซื้อ</small>
                </div>

                <ProfitSummary summary={detail.dealSummary} />

                {detail.ledger.length > 1 && (
                  <div className="ai-ledger-lines">
                    {detail.ledger.map((line) => (
                      <button
                        key={line.id}
                        className={ledgerDraft.id === line.id ? "active" : ""}
                        type="button"
                        onClick={() => setLedgerDraft(blankLedger(line))}
                      >
                        #{line.line_no} {line.item_title || "สินค้า"} · {money(line.total_cost)}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setLedgerDraft(blankLedger({
                          ...(detail.ledger[0] || {}),
                          id: "",
                          line_no: detail.ledger.length + 1,
                        } as AiBuyerLedgerLine))
                      }
                    >
                      + เพิ่มรายการ
                    </button>
                  </div>
                )}

                <div className="ai-form-grid ledger">
                  <label className="wide">
                    <span>เชื่อมสินค้าใน Product Hub</span>
                    <select
                      value={ledgerDraft.productId}
                      onChange={(event) =>
                        setLedgerDraft((current) => ({ ...current, productId: event.target.value }))
                      }
                    >
                      <option value="">ยังไม่เชื่อมสินค้า</option>
                      {products
                        .filter((product) => product.status !== "cancelled")
                        .map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.sku} · {product.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <span>สถานะ</span>
                    <select
                      value={ledgerDraft.status}
                      onChange={(event) =>
                        setLedgerDraft((current) => ({ ...current, status: event.target.value }))
                      }
                    >
                      <option value="PENDING">รอรับของ</option>
                      <option value="ACQUIRED">รับซื้อแล้ว</option>
                      <option value="IN_STOCK">อยู่ในสต็อก</option>
                      <option value="SOLD">ขายแล้ว</option>
                      <option value="RETURNED">คืนสินค้า</option>
                      <option value="WRITE_OFF">ตัดสูญ</option>
                      <option value="CANCELLED">ยกเลิก</option>
                    </select>
                  </label>
                  <label>
                    <span>ราคาซื้อจริง</span>
                    <input
                      inputMode="numeric"
                      value={ledgerDraft.purchasePrice}
                      onChange={(event) =>
                        setLedgerDraft((current) => ({ ...current, purchasePrice: event.target.value }))
                      }
                    />
                  </label>
                  {([
                    ["repairCost", "ค่าซ่อม"],
                    ["partsCost", "ค่าอะไหล่"],
                    ["transportCost", "ค่ารับ/ส่ง"],
                    ["warrantyCost", "สำรองประกัน"],
                    ["channelFee", "ค่าช่องทาง"],
                    ["otherCost", "ค่าอื่น ๆ"],
                  ] as Array<[keyof LedgerDraft, string]>).map(([key, label]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <input
                        inputMode="numeric"
                        value={String(ledgerDraft[key] || "")}
                        onChange={(event) =>
                          setLedgerDraft((current) => ({ ...current, [key]: event.target.value }))
                        }
                      />
                    </label>
                  ))}
                  <label>
                    <span>ราคาขายจริง</span>
                    <input
                      inputMode="numeric"
                      value={ledgerDraft.salePrice}
                      onChange={(event) =>
                        setLedgerDraft((current) => ({ ...current, salePrice: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    <span>ช่องทางขาย</span>
                    <input
                      value={ledgerDraft.saleChannel}
                      onChange={(event) =>
                        setLedgerDraft((current) => ({ ...current, saleChannel: event.target.value }))
                      }
                      placeholder="หน้าร้าน / Facebook / Website"
                    />
                  </label>
                  <label className="wide ai-checkbox-field">
                    <input
                      type="checkbox"
                      checked={ledgerDraft.salePriceVerified}
                      onChange={(event) =>
                        setLedgerDraft((current) => ({
                          ...current,
                          salePriceVerified: event.target.checked,
                        }))
                      }
                    />
                    <span>ยืนยันว่าราคาขายนี้คือยอดจริง</span>
                  </label>
                  <label className="wide">
                    <span>หมายเหตุ Ledger</span>
                    <input
                      value={ledgerDraft.note}
                      onChange={(event) =>
                        setLedgerDraft((current) => ({ ...current, note: event.target.value }))
                      }
                      placeholder="เช่น เปลี่ยนแบต 900 บาท / ขายส่ง"
                    />
                  </label>
                </div>

                <div className="ai-ledger-preview">
                  <div>
                    <WalletCards />
                    <span>ต้นทุนรวม</span>
                    <strong>{money(ledgerEstimate.total)}</strong>
                  </div>
                  <div className={ledgerEstimate.profit == null || ledgerEstimate.profit >= 0 ? "profit" : "loss"}>
                    <ShoppingBag />
                    <span>กำไรประมาณ</span>
                    <strong>{money(ledgerEstimate.profit)}</strong>
                  </div>
                </div>

                <button
                  type="button"
                  className="ai-secondary-action"
                  onClick={() => void saveLedger()}
                  disabled={busy}
                >
                  <CircleDollarSign size={17} /> บันทึก Profit Ledger
                </button>
              </section>
            </>
          ) : (
            <div className="ai-detail-empty">
              <MessageCircle />
              <strong>ไม่พบข้อมูลเคส</strong>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
