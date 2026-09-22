import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  ChevronLeft,
  Image as ImageIcon,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import type { Profile } from "../types/product";
import {
  loadAiBuyerCase,
  loadAiBuyerDashboard,
  loadAiBuyerImageBlob,
  sendAiBuyerManualReply,
  type AiBuyerCaseDetail,
  type AiBuyerDashboardCase,
} from "../lib/aiBuyerAdmin";
import "../styles/lineOAChat.css";

const privilegedRoles = new Set<Profile["role"]>(["owner", "admin"]);

function timeOnly(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
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

function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(n) + " บาท";
}

function numeric(value: string) {
  const raw = value.replace(/,/g, "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function initials(name?: string | null) {
  const clean = String(name || "ลูกค้า").trim();
  return clean.slice(0, 2).toUpperCase();
}

function ConversationItem({
  item,
  active,
  onClick,
}: {
  item: AiBuyerDashboardCase;
  active: boolean;
  onClick: () => void;
}) {
  const customer = item.customer?.displayName || "ลูกค้า LINE";
  const preview =
    item.lastMessage?.text ||
    (item.lastMessage?.type === "IMAGE" ? "📷 ส่งรูปภาพ" : "ยังไม่มีข้อความ");

  return (
    <button
      type="button"
      className={"lineoa-thread" + (active ? " active" : "")}
      onClick={onClick}
    >
      <div className="lineoa-avatar">
        {item.customer?.pictureUrl ? (
          <img src={item.customer.pictureUrl} alt="" />
        ) : (
          <span>{initials(customer)}</span>
        )}
      </div>
      <div className="lineoa-thread-copy">
        <div className="lineoa-thread-head">
          <strong>{customer}</strong>
          <time>{timeOnly(item.lastMessage?.createdAt || item.updatedAt)}</time>
        </div>
        <b>{item.title || "ยังไม่ระบุสินค้า"}</b>
        <p>{preview}</p>
        <div className="lineoa-thread-tags">
          {item.offer?.amount != null && (
            <span className="price">เสนอ {money(item.offer.amount)}</span>
          )}
          {item.imageCount > 0 && <span>📷 {item.imageCount}</span>}
        </div>
      </div>
    </button>
  );
}

function ChatBubble({
  message,
  images,
  imageUrls,
  onOpenImage,
}: {
  message: AiBuyerCaseDetail["messages"][number];
  images: AiBuyerCaseDetail["images"];
  imageUrls: Record<string, string>;
  onOpenImage: (url: string) => void;
}) {
  const outbound = message.direction === "OUTBOUND";
  const source = String(message.metadata?.source || "");
  const linkedImages = images.filter(
    (image) =>
      image.message_id === message.id ||
      Boolean(
        image.line_message_id &&
          message.line_message_id &&
          image.line_message_id === message.line_message_id,
      ),
  );

  return (
    <div className={"lineoa-message-row " + (outbound ? "outbound" : "inbound")}>
      <div className="lineoa-bubble-wrap">
        {outbound && (
          <small className="lineoa-speaker">
            {source === "OWNER_MANUAL" ? "คุณ" : source === "AI" || source === "AI_BUYER" ? "AI" : "ร้าน"}
          </small>
        )}
        <div className={"lineoa-bubble " + (outbound ? "shop" : "customer")}>
          {message.message_type === "TEXT" && (
            <p>{message.text_content || "—"}</p>
          )}

          {message.message_type === "IMAGE" && (
            <div className="lineoa-image-grid">
              {linkedImages.length ? (
                linkedImages.map((image) => {
                  const url = imageUrls[image.id];
                  return url ? (
                    <button
                      key={image.id}
                      type="button"
                      className="lineoa-image-thumb"
                      onClick={() => onOpenImage(url)}
                    >
                      <img src={url} alt="รูปจากลูกค้า" />
                    </button>
                  ) : (
                    <div key={image.id} className="lineoa-image-loading">
                      <LoaderCircle className="spin" />
                    </div>
                  );
                })
              ) : (
                <div className="lineoa-image-missing">
                  <ImageIcon />
                  <span>รูปภาพ</span>
                </div>
              )}
            </div>
          )}

          {!["TEXT", "IMAGE"].includes(message.message_type) && (
            <p className="lineoa-other-message">{message.message_type}</p>
          )}
        </div>
        <time>{dateTime(message.line_timestamp || message.created_at)}</time>
      </div>
    </div>
  );
}

export function LineOAChat({
  profile,
}: {
  profile: Profile;
}) {
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof loadAiBuyerDashboard>> | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<AiBuyerCaseDetail | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [offer, setOffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const canAccess = privilegedRoles.has(profile.role);

  async function refreshDashboard(keep = true) {
    if (!canAccess) return;
    setLoading(true);
    setError(null);
    try {
      const next = await loadAiBuyerDashboard(200);
      setDashboard(next);
      const nextId =
        keep && selectedId && next.cases.some((item) => item.id === selectedId)
          ? selectedId
          : next.cases[0]?.id || "";
      if (nextId && nextId !== selectedId) setSelectedId(nextId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    const urls: string[] = [];
    let cancelled = false;

    async function loadImages() {
      const images = detail?.images || [];
      if (!images.length) {
        setImageUrls({});
        return;
      }
      const next: Record<string, string> = {};
      await Promise.all(
        images.map(async (image) => {
          try {
            const blob = await loadAiBuyerImageBlob(image.id);
            if (cancelled) return;
            const url = URL.createObjectURL(blob);
            urls.push(url);
            next[image.id] = url;
          } catch {
            // Keep the message visible even if one image fails.
          }
        }),
      );
      if (!cancelled) setImageUrls(next);
    }

    void loadImages();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [detail?.case.id, detail?.images.length]);

  useEffect(() => {
    if (!detail) return;
    window.setTimeout(() => chatEndRef.current?.scrollIntoView({ block: "end" }), 80);
  }, [detail?.messages.length, imageUrls]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const cases = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (dashboard?.cases || [])
      .filter((item) => {
        if (!q) return true;
        return [
          item.customer?.displayName,
          item.title,
          item.category,
          item.lastMessage?.text,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      })
      .sort(
        (a, b) =>
          new Date(b.lastMessage?.createdAt || b.updatedAt).getTime() -
          new Date(a.lastMessage?.createdAt || a.updatedAt).getTime(),
      );
  }, [dashboard, query]);

  const selected = dashboard?.cases.find((item) => item.id === selectedId) || null;
  const offerAmount = numeric(offer);
  const canSend = Boolean(text.trim()) || offerAmount != null;

  async function send() {
    if (!selectedId || !canSend) return;
    setSending(true);
    setError(null);
    try {
      const result = await sendAiBuyerManualReply({
        caseId: selectedId,
        text: text.trim(),
        offerAmount,
      });
      setText("");
      setOffer("");
      setNotice(
        offerAmount != null
          ? `ส่งราคา ${money(offerAmount)} และบันทึกเป็น Manual Price แล้ว`
          : "ส่งข้อความ LINE แล้ว",
      );
      await Promise.all([refreshDetail(selectedId), refreshDashboard()]);
      if (result.sentText) {
        window.setTimeout(() => chatEndRef.current?.scrollIntoView({ block: "end" }), 80);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  if (!canAccess) {
    return (
      <section className="lineoa-screen">
        <div className="lineoa-denied">
          <ShieldCheck />
          <strong>LINE OA Chat สำหรับ Owner / Admin เท่านั้น</strong>
        </div>
      </section>
    );
  }

  return (
    <section className={"lineoa-screen " + (selectedId ? "chat-open" : "")}>
      <aside className="lineoa-sidebar">
        <header className="lineoa-list-header">
          <div className="lineoa-brand-dot">L</div>
          <div>
            <small>AMPHON · LINE OA</small>
            <h1>แชท</h1>
          </div>
          <button type="button" onClick={() => void refreshDashboard()} disabled={loading}>
            <RefreshCw className={loading ? "spin" : ""} />
          </button>
        </header>

        <label className="lineoa-search">
          <Search />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหาชื่อลูกค้า รุ่น หรือข้อความ"
          />
        </label>

        <div className="lineoa-thread-list">
          {loading && !dashboard ? (
            <div className="lineoa-loading">
              <LoaderCircle className="spin" /> กำลังโหลดแชท
            </div>
          ) : cases.length ? (
            cases.map((item) => (
              <ConversationItem
                key={item.id}
                item={item}
                active={item.id === selectedId}
                onClick={() => setSelectedId(item.id)}
              />
            ))
          ) : (
            <div className="lineoa-empty">ไม่พบแชท</div>
          )}
        </div>
      </aside>

      <main className="lineoa-chat-pane">
        {!selectedId ? (
          <div className="lineoa-chat-empty">
            <MessageCircle />
            <strong>เลือกแชทเพื่อเริ่มตอบลูกค้า</strong>
            <span>ข้อความที่ส่งจากหน้านี้จะถูกเก็บเป็น OWNER_MANUAL</span>
          </div>
        ) : detailLoading && !detail ? (
          <div className="lineoa-loading">
            <LoaderCircle className="spin" /> กำลังโหลดบทสนทนา
          </div>
        ) : detail ? (
          <>
            <header className="lineoa-chat-header">
              <button
                type="button"
                className="lineoa-mobile-back"
                onClick={() => setSelectedId("")}
              >
                <ChevronLeft />
              </button>
              <div className="lineoa-avatar small">
                {detail.customer?.picture_url ? (
                  <img src={detail.customer.picture_url} alt="" />
                ) : (
                  <span>{initials(detail.customer?.display_name)}</span>
                )}
              </div>
              <div className="lineoa-chat-title">
                <strong>{detail.customer?.display_name || "ลูกค้า LINE"}</strong>
                <span>{detail.case.title || selected?.title || "ยังไม่ระบุสินค้า"}</span>
              </div>
              <div className="lineoa-chat-price">
                <small>ราคาล่าสุด</small>
                <strong>
                  {selected?.offer?.amount != null
                    ? money(selected.offer.amount)
                    : detail.pricing[0]?.current_authorized_offer != null
                      ? money(detail.pricing[0].current_authorized_offer)
                      : "—"}
                </strong>
              </div>
            </header>

            {error && (
              <div className="lineoa-error">
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)}>ปิด</button>
              </div>
            )}
            {notice && <div className="lineoa-notice">{notice}</div>}

            <div className="lineoa-message-list">
              <div className="lineoa-day-divider"><span>บทสนทนาล่าสุด</span></div>
              {detail.messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  images={detail.images}
                  imageUrls={imageUrls}
                  onOpenImage={setViewer}
                />
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="lineoa-composer">
              <div className="lineoa-offer-box">
                <Banknote />
                <label>
                  <span>ราคาเสนอรับซื้อ</span>
                  <input
                    inputMode="numeric"
                    value={offer}
                    onChange={(event) => setOffer(event.target.value)}
                    placeholder="เช่น 5,200"
                  />
                </label>
                {offerAmount != null && <b>{money(offerAmount)}</b>}
              </div>

              <div className="lineoa-compose-row">
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={
                    offerAmount != null
                      ? "พิมพ์ข้อความเพิ่มเติมได้ หรือส่งราคาอย่างเดียว"
                      : "พิมพ์ข้อความถึงลูกค้า…"
                  }
                  rows={2}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      if (canSend && !sending) void send();
                    }
                  }}
                />
                <button type="button" disabled={!canSend || sending} onClick={() => void send()}>
                  {sending ? <LoaderCircle className="spin" /> : <Send />}
                  <span>{offerAmount != null ? "ส่งราคา" : "ส่ง"}</span>
                </button>
              </div>

              {offerAmount != null && (
                <p className="lineoa-offer-preview">
                  ระบบจะบันทึก {money(offerAmount)} เป็น Manual Price และส่งข้อความ
                  <b> “ราคาที่เสนอรับซื้อ: {money(offerAmount)}” </b>
                  ไปใน LINE ด้วย
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="lineoa-chat-empty">
            <MessageCircle />
            <strong>ไม่พบข้อมูลแชท</strong>
          </div>
        )}
      </main>

      {viewer && (
        <div className="lineoa-image-viewer" onClick={() => setViewer(null)}>
          <button type="button" onClick={() => setViewer(null)}><X /></button>
          <img src={viewer} alt="รูปจาก LINE" onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </section>
  );
}
