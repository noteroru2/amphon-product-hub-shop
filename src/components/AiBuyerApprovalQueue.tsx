import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Bot,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import type { Profile } from "../types/product";
import {
  approveAiBuyerOffer,
  bootstrapAiBuyerApprovalQueue,
  loadAiBuyerApprovalQueue,
  type AiBuyerApprovalQueueItem,
} from "../lib/aiBuyerAdmin";
import "../styles/aiBuyerApprovalQueue.css";

const privilegedRoles = new Set<Profile["role"]>(["owner", "admin"]);

function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(n) + " บาท";
}

function pct(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Math.round(n * 100) + "%";
}

function dateTime(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

function initials(name?: string | null) {
  return String(name || "ลูกค้า").trim().slice(0, 2).toUpperCase();
}

function sourceLabel(source?: string | null) {
  if (source === "PRICE_BOOK") return "Price Book";
  if (source === "SPEC_ENGINE") return "Spec Engine";
  if (source === "MARKET") return "Market";
  return source || "Pricing Engine";
}

function confidenceTone(value?: number | null) {
  const n = Number(value || 0);
  if (n >= 0.9) return "high";
  if (n >= 0.75) return "medium";
  return "low";
}

function guardLabel(reason: string) {
  switch (reason) {
    case "READY": return "Guard ผ่าน";
    case "HARD_MAX_EXCEEDED": return "เกิน Hard Max";
    case "PENDING_OFFER_MISSING": return "ไม่พบ Offer";
    case "PRICING_DECISION_MISSING": return "ไม่พบ Pricing";
    case "CASE_MISSING": return "ไม่พบเคส";
    default: return "ต้องตรวจ";
  }
}

function ApprovalCard({
  item,
  confirming,
  busy,
  onAskConfirm,
  onCancelConfirm,
  onApprove,
}: {
  item: AiBuyerApprovalQueueItem;
  confirming: boolean;
  busy: boolean;
  onAskConfirm: () => void;
  onCancelConfirm: () => void;
  onApprove: () => void;
}) {
  const proposal = Number(item.offer?.amount ?? NaN);
  const hardMax = Number(item.pricing?.hardMax ?? NaN);
  const target = Number(item.pricing?.targetBuy ?? NaN);
  const bookOpening = Number(item.priceBook?.openingOffer ?? NaN);
  const bookDelta =
    Number.isFinite(proposal) && Number.isFinite(bookOpening) && bookOpening > 0
      ? ((proposal - bookOpening) / bookOpening) * 100
      : null;
  const room = Number(item.guard.roomToHardMax ?? NaN);
  const confidence = Number(item.pricing?.confidence || 0);
  const customer = item.customer?.displayName || "ลูกค้า LINE";
  const canApprove = Boolean(item.guard.canApprove && item.case && item.offer);

  return (
    <article className={"approval-card " + (canApprove ? "ready" : "blocked")}>
      <div className="approval-card-head">
        <div className="approval-customer">
          <div className="approval-avatar">
            {item.customer?.pictureUrl ? (
              <img src={item.customer.pictureUrl} alt="" loading="lazy" />
            ) : (
              <span>{initials(customer)}</span>
            )}
          </div>
          <div>
            <strong>{customer}</strong>
            <small>
              {(item.case?.category || "ไม่ทราบหมวด") + " · " + dateTime(item.task.createdAt)}
            </small>
          </div>
        </div>

        <span className={"approval-guard " + (canApprove ? "ok" : "warn")}>
          {canApprove ? <ShieldCheck /> : <TriangleAlert />}
          {guardLabel(item.guard.reason)}
        </span>
      </div>

      <div className="approval-product">
        <h2>{item.case?.title || item.product.modelName || "ยังไม่ระบุสินค้า"}</h2>
        <p>
          {[item.product.modelCode, item.priceBook.conditionKey]
            .filter(Boolean)
            .join(" · ") || "ตรวจจากข้อมูลลูกค้าและ Pricing Engine"}
        </p>
      </div>

      {item.lastCustomerMessage?.text && (
        <div className="approval-last-message">
          <UserRound />
          <span>{item.lastCustomerMessage.text}</span>
        </div>
      )}

      <div className="approval-price-hero">
        <span>AI กำลังจะเสนอ</span>
        <strong>{money(item.offer?.amount)}</strong>
        <small>
          {sourceLabel(item.pricing?.source) +
            (item.priceBook.versionName ? " · " + item.priceBook.versionName : "")}
        </small>
      </div>

      <div className="approval-price-grid">
        <div>
          <span>PriceBook Opening</span>
          <strong>{money(item.priceBook.openingOffer ?? item.pricing?.openingOffer)}</strong>
          {bookDelta != null && (
            <small className={bookDelta > 0 ? "up" : bookDelta < 0 ? "down" : ""}>
              {bookDelta === 0
                ? "ตรงกับ Book"
                : (bookDelta > 0 ? "+" : "") + bookDelta.toFixed(1) + "% จาก Book"}
            </small>
          )}
        </div>
        <div>
          <span>Target Buy</span>
          <strong>{money(target)}</strong>
          <small>
            {Number.isFinite(proposal) && Number.isFinite(target)
              ? proposal <= target
                ? "อยู่ใน Target"
                : "สูงกว่า Target " + money(proposal - target)
              : "—"}
          </small>
        </div>
        <div className="hardmax">
          <span>Hard Max</span>
          <strong>{money(hardMax)}</strong>
          <small>
            {Number.isFinite(room)
              ? "เหลือเพดาน " + money(room)
              : "Price Guard บังคับใช้"}
          </small>
        </div>
        <div>
          <span>Resale Estimate</span>
          <strong>{money(item.pricing?.estimatedResale ?? item.priceBook.estimatedResale)}</strong>
          <small>ราคาอ้างอิงขายต่อ</small>
        </div>
      </div>

      <div className="approval-confidence">
        <div>
          <span>Pricing Confidence</span>
          <strong>{pct(confidence)}</strong>
        </div>
        <div className={"approval-confidence-track " + confidenceTone(confidence)}>
          <i style={{ width: Math.max(0, Math.min(100, confidence * 100)) + "%" }} />
        </div>
        <small>
          {"Identity " + pct(item.case?.identityConfidence) +
            " · Readiness " + pct(item.case?.pricingReadiness)}
        </small>
      </div>

      <div className="approval-safety-note">
        <ShieldCheck />
        <div>
          <strong>Price Guard</strong>
          <span>
            {"ระบบจะส่งเฉพาะ Offer ที่ผ่าน Hard Max แล้วเท่านั้น" +
              (item.offer?.round ? " · Negotiation round " + item.offer.round : "")}
          </span>
        </div>
      </div>

      {!confirming ? (
        <button
          type="button"
          className="approval-send"
          disabled={!canApprove || busy}
          onClick={onAskConfirm}
        >
          {canApprove ? <BadgeCheck /> : <TriangleAlert />}
          {canApprove ? "อนุมัติส่ง " + money(item.offer?.amount) : "ยังอนุมัติไม่ได้"}
        </button>
      ) : (
        <div className="approval-confirm">
          <div>
            <strong>{"ยืนยันส่งราคา " + money(item.offer?.amount) + "?"}</strong>
            <p>LINE จะส่งข้อเสนอจริงให้ลูกค้าทันที และเคสจะเปลี่ยนเป็น OFFERED</p>
          </div>
          <div className="approval-confirm-actions">
            <button type="button" className="ghost" onClick={onCancelConfirm} disabled={busy}>
              <X /> ยกเลิก
            </button>
            <button type="button" className="confirm" onClick={onApprove} disabled={busy}>
              {busy ? <LoaderCircle className="spin" /> : <CheckCircle2 />}
              ยืนยันและส่ง LINE
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export function AiBuyerApprovalQueue({
  profile,
  onBack,
}: {
  profile: Profile;
  onBack: () => void;
}) {
  const canAccess = privilegedRoles.has(profile.role);
  const [data, setData] = useState<Awaited<ReturnType<typeof loadAiBuyerApprovalQueue>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [confirmId, setConfirmId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "blocked">("all");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh(silent = false) {
    if (!canAccess) return;
    if (silent) setRefreshing(true);
    else setLoading(true);
    if (!silent) setError(null);
    try {
      const next = await loadAiBuyerApprovalQueue(160);
      setData(next);
      if (confirmId && !next.items.some((item) => item.offer?.id === confirmId)) {
        setConfirmId("");
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, profile.role]);

  useEffect(() => {
    if (!canAccess) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 8000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const items = useMemo(() => {
    const rows = data?.items || [];
    if (filter === "ready") return rows.filter((item) => item.guard.canApprove);
    if (filter === "blocked") return rows.filter((item) => !item.guard.canApprove);
    return rows;
  }, [data, filter]);

  async function syncBacklog() {
    if (!canAccess || bootstrapping) return;
    setBootstrapping(true);
    setError(null);
    try {
      const result = await bootstrapAiBuyerApprovalQueue(4);
      setNotice(
        result.attempted > 0
          ? "ประมวลผลคิวราคา " + result.attempted + " เคสแล้ว"
          : "ไม่มีเคส READY_TO_PRICE เพิ่มเติม",
      );
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBootstrapping(false);
    }
  }

  async function approve(item: AiBuyerApprovalQueueItem) {
    if (!item.case?.id || !item.offer?.id || !item.guard.canApprove) return;
    setBusyId(item.offer.id);
    setError(null);
    try {
      await approveAiBuyerOffer(item.case.id, item.offer.id);
      setConfirmId("");
      setNotice(
        "ส่งราคา " + money(item.offer.amount) + " ให้ " +
        (item.customer?.displayName || "ลูกค้า") + " แล้ว",
      );
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  }

  if (!canAccess) {
    return (
      <section className="approval-screen">
        <div className="approval-denied">
          <ShieldCheck />
          <strong>Approval Queue สำหรับ Owner / Admin เท่านั้น</strong>
        </div>
      </section>
    );
  }

  const approvalModes =
    data?.modes.filter((mode) => mode.mode === "APPROVAL" && mode.active).length || 0;

  return (
    <section className="approval-screen">
      <header className="approval-topbar">
        <button type="button" onClick={onBack} aria-label="กลับ">
          <ArrowLeft />
        </button>
        <div>
          <small>AI BUYER · APPROVAL MODE</small>
          <h1>Approval Queue</h1>
        </div>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={loading || refreshing}
          aria-label="รีเฟรช"
        >
          <RefreshCw className={loading || refreshing ? "spin" : ""} />
        </button>
      </header>

      <div className="approval-mode-banner">
        <Bot />
        <div>
          <strong>{"APPROVAL " + approvalModes + "/7"}</strong>
          <span>AI ตีราคาได้ แต่จะไม่ส่ง Offer จนกว่าคุณกดอนุมัติ</span>
        </div>
      </div>

      <div className="approval-summary">
        <div><span>รออนุมัติ</span><strong>{data?.summary.pending ?? 0}</strong></div>
        <div><span>พร้อมส่ง</span><strong>{data?.summary.readyToSend ?? 0}</strong></div>
        <div><span>ติด Guard</span><strong>{data?.summary.blocked ?? 0}</strong></div>
        <div><span>รอตีราคา</span><strong>{data?.summary.backlogReadyToPrice ?? 0}</strong></div>
        <div><span>Confidence เฉลี่ย</span><strong>{pct(data?.summary.averageConfidence)}</strong></div>
      </div>

      {(data?.summary.backlogReadyToPrice ?? 0) > 0 && (
        <div className="approval-backlog-banner">
          <div>
            <LoaderCircle className={bootstrapping ? "spin" : ""} />
            <span>
              มี <b>{data?.summary.backlogReadyToPrice ?? 0} เคส</b> ที่ READY_TO_PRICE
              แต่ยังไม่ได้สร้าง Offer สำหรับ Approval
            </span>
          </div>
          <button type="button" onClick={() => void syncBacklog()} disabled={bootstrapping}>
            {bootstrapping ? "กำลังประมวลผล…" : "สร้างคิวราคา"}
          </button>
        </div>
      )}

      <div className="approval-filters">
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
          ทั้งหมด
        </button>
        <button type="button" className={filter === "ready" ? "active" : ""} onClick={() => setFilter("ready")}>
          พร้อมส่ง
        </button>
        <button type="button" className={filter === "blocked" ? "active" : ""} onClick={() => setFilter("blocked")}>
          ต้องตรวจ
        </button>
      </div>

      {error && (
        <div className="approval-error">
          <TriangleAlert />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}><X /></button>
        </div>
      )}

      {notice && (
        <div className="approval-notice">
          <CheckCircle2 />
          <span>{notice}</span>
        </div>
      )}

      <div className="approval-content">
        {loading && !data ? (
          <div className="approval-loading">
            <LoaderCircle className="spin" />
            <strong>กำลังโหลดคิวราคา</strong>
          </div>
        ) : items.length ? (
          items.map((item) => (
            <ApprovalCard
              key={item.task.id}
              item={item}
              confirming={confirmId === item.offer?.id}
              busy={busyId === item.offer?.id}
              onAskConfirm={() => setConfirmId(item.offer?.id || "")}
              onCancelConfirm={() => setConfirmId("")}
              onApprove={() => void approve(item)}
            />
          ))
        ) : (
          <div className="approval-empty">
            {(data?.summary.backlogReadyToPrice ?? 0) > 0 ? (
              <LoaderCircle className={bootstrapping ? "spin" : ""} />
            ) : (
              <CheckCircle2 />
            )}
            <strong>
              {(data?.summary.backlogReadyToPrice ?? 0) > 0
                ? "มีเคสรอตีราคา แต่ยังไม่ถูก Materialize"
                : filter === "all"
                  ? "ไม่มีราคาใหม่รออนุมัติ"
                  : "ไม่มีรายการในตัวกรองนี้"}
            </strong>
            <span>
              {(data?.summary.backlogReadyToPrice ?? 0) > 0
                ? "กด “สร้างคิวราคา” เพื่อให้ Pricing Engine สร้าง Offer แล้วรายการจะขึ้นให้อนุมัติทันที"
                : "เมื่อ AI ตีราคาเสร็จใน APPROVAL mode รายการจะขึ้นหน้านี้อัตโนมัติ"}
            </span>
          </div>
        )}
      </div>

      <footer className="approval-footer-note">
        <Clock3 />
        <span>รีเฟรชอัตโนมัติทุก 8 วินาที · READY_TO_PRICE จะถูกเติมเข้าคิวอัตโนมัติ · ราคาเกิน Hard Max จะกดส่งไม่ได้</span>
      </footer>
    </section>
  );
}
