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
  saveAiBuyerFinalOutcome,
  saveAiBuyerLedgerLine,
  sendAiBuyerManualReply,
  type AiBuyerCaseDetail,
  type AiBuyerDashboardCase,
  type AiBuyerDealSummary,
  type AiBuyerLedgerLine,
} from "../lib/aiBuyerAdmin";
import "../styles/aiBuyerAdmin.css";

type CaseFilter = "active" | "needs-label" | "purchased" | "all";

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

function MessageBubble({
  message,
}: {
  message: AiBuyerCaseDetail["messages"][number];
}) {
  const outbound = message.direction === "OUTBOUND";
  const source = String(message.metadata?.source || "");
  return (
    <div className={"ai-message-row " + (outbound ? "outbound" : "inbound")}>
      <div className="ai-message-bubble">
        <small>
          {outbound
            ? source === "OWNER_MANUAL"
              ? "คุณ · Manual"
              : source === "AI_BUYER" || source === "AI"
                ? "AI"
                : "ร้าน"
            : "ลูกค้า"}
        </small>
        {message.message_type === "TEXT" ? (
          <p>{message.text_content || "—"}</p>
        ) : (
          <p className="ai-message-media">
            {message.message_type === "IMAGE" ? "📷 รูปภาพ" : message.message_type}
          </p>
        )}
        <time>{when(message.line_timestamp || message.created_at)}</time>
      </div>
    </div>
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
  const [detail, setDetail] = useState<AiBuyerCaseDetail | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<CaseFilter>("active");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [reply, setReply] = useState("");
  const [replyAmount, setReplyAmount] = useState("");

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

  async function sendReply() {
    if (!selectedId || !reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await sendAiBuyerManualReply({
        caseId: selectedId,
        text: reply.trim(),
        offerAmount: numberOrNull(replyAmount),
      });
      setReply("");
      setReplyAmount("");
      setNotice("ส่ง LINE และเก็บเป็น OWNER_MANUAL แล้ว");
      await Promise.all([refreshDetail(selectedId), refreshDashboard()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
        <button className="refresh-button" onClick={() => void refreshDashboard()} disabled={loading}>
          <RefreshCw className={loading ? "spin" : ""} />
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
      </div>

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
              </section>

              <section className="ai-panel">
                <div className="ai-panel-head">
                  <div><MessageCircle /><strong>แชต LINE</strong></div>
                  <small>{detail.messages.length} ข้อความ</small>
                </div>
                <div className="ai-chat-log">
                  {detail.messages.length ? (
                    detail.messages.map((message) => (
                      <MessageBubble key={message.id} message={message} />
                    ))
                  ) : (
                    <div className="ai-empty-mini">ยังไม่มีข้อความ</div>
                  )}
                </div>
                <div className="ai-reply-composer">
                  <textarea
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder="พิมพ์ตอบลูกค้าในสไตล์ของคุณ…"
                    rows={3}
                  />
                  <div className="ai-reply-row">
                    <label>
                      <Banknote size={16} />
                      <input
                        inputMode="numeric"
                        value={replyAmount}
                        onChange={(event) => setReplyAmount(event.target.value)}
                        placeholder="ราคาเสนอ (ถ้ามี)"
                      />
                    </label>
                    <button
                      type="button"
                      className="ai-primary-action"
                      disabled={busy || !reply.trim()}
                      onClick={() => void sendReply()}
                    >
                      <Send size={17} /> {busy ? "กำลังส่ง…" : "ส่ง LINE"}
                    </button>
                  </div>
                  <small>
                    ข้อความนี้จะถูกเก็บเป็น <b>OWNER_MANUAL</b> เพื่อใช้เรียนรู้วิธีคุยและปิดงานของคุณ
                  </small>
                </div>
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
