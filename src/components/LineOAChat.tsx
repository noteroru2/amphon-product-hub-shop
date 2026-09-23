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
  loadAiBuyerChatCase,
  loadAiBuyerChatList,
  loadAiBuyerImageBlob,
  markAiBuyerChatRead,
  sendAiBuyerManualReply,
  type AiBuyerChatCaseDetail,
  type AiBuyerChatCaseSummary,
  type AiBuyerChatImage,
  type AiBuyerChatMessage,
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
  return (
    new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(n) +
    " บาท"
  );
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
  item: AiBuyerChatCaseSummary;
  active: boolean;
  onClick: () => void;
}) {
  const customer = item.customer?.displayName || "ลูกค้า LINE";
  const preview =
    item.lastMessage?.text ||
    (item.lastMessage?.type === "IMAGE" ? "📷 ส่งรูปภาพ" : "ยังไม่มีข้อความ");
  const unread = Number(item.unreadCount || 0);

  return (
    <button
      type="button"
      className={
        "lineoa-thread" +
        (active ? " active" : "") +
        (unread > 0 ? " unread" : "")
      }
      onClick={onClick}
    >
      <div className="lineoa-avatar-wrap">
        <div className="lineoa-avatar">
          {item.customer?.pictureUrl ? (
            <img src={item.customer.pictureUrl} alt="" loading="lazy" />
          ) : (
            <span>{initials(customer)}</span>
          )}
        </div>
        {unread > 0 && (
          <span className="lineoa-unread-badge">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </div>

      <div className="lineoa-thread-copy">
        <div className="lineoa-thread-head">
          <strong>{customer}</strong>
          <time>{timeOnly(item.lastMessage?.createdAt || item.lastActivityAt)}</time>
        </div>
        <b>{item.title || "ยังไม่ระบุสินค้า"}</b>
        <p>{preview}</p>
        <div className="lineoa-thread-tags">
          {item.offer?.amount != null && (
            <span className="price">เสนอ {money(item.offer.amount)}</span>
          )}
          {item.imageCount > 0 && <span>📷 {item.imageCount}</span>}
          {unread > 0 && <span className="unread-tag">ยังไม่ได้อ่าน</span>}
        </div>
      </div>
    </button>
  );
}

function LazyChatImage({
  image,
  onOpen,
}: {
  image: AiBuyerChatImage;
  onOpen: (url: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = hostRef.current;
    if (!node || url || failed) return;

    let objectUrl = "";
    let cancelled = false;
    let loading = false;

    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const blob = await loadAiBuyerImageBlob(image.id);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    if (!("IntersectionObserver" in window)) {
      void load();
      return () => {
        cancelled = true;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: "320px 0px" },
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [failed, image.id, url]);

  return (
    <div ref={hostRef} className="lineoa-image-slot">
      {url ? (
        <button
          type="button"
          className="lineoa-image-thumb"
          onClick={() => onOpen(url)}
        >
          <img src={url} alt="รูปจากลูกค้า" loading="lazy" decoding="async" />
        </button>
      ) : failed ? (
        <div className="lineoa-image-missing">
          <ImageIcon />
          <span>เปิดรูปไม่ได้</span>
        </div>
      ) : (
        <div className="lineoa-image-loading">
          <LoaderCircle className="spin" />
          <span>กำลังโหลดรูป</span>
        </div>
      )}
    </div>
  );
}

function ChatBubble({
  message,
  images,
  onOpenImage,
}: {
  message: AiBuyerChatMessage;
  images: AiBuyerChatImage[];
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
            {source === "OWNER_MANUAL"
              ? "คุณ"
              : source === "AI" || source === "AI_BUYER"
                ? "AI"
                : "ร้าน"}
          </small>
        )}
        <div className={"lineoa-bubble " + (outbound ? "shop" : "customer")}>
          {message.message_type === "TEXT" && <p>{message.text_content || "—"}</p>}

          {message.message_type === "IMAGE" && (
            <div className="lineoa-image-grid">
              {linkedImages.length ? (
                linkedImages.map((image) => (
                  <LazyChatImage key={image.id} image={image} onOpen={onOpenImage} />
                ))
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
  onUnreadChange,
}: {
  profile: Profile;
  onUnreadChange?: (count: number) => void;
}) {
  const [chatList, setChatList] = useState<AiBuyerChatCaseSummary[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<AiBuyerChatCaseDetail | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [offer, setOffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const canAccess = privilegedRoles.has(profile.role);

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const node = messageListRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
  };

  const isNearBottom = () => {
    const node = messageListRef.current;
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight < 180;
  };

  useEffect(() => {
    document.body.classList.add("lineoa-active");
    const viewport = window.visualViewport;

    const syncViewport = () => {
      const height = viewport?.height || window.innerHeight;
      const top = viewport?.offsetTop || 0;
      document.documentElement.style.setProperty(
        "--lineoa-viewport-height",
        `${Math.round(height)}px`,
      );
      document.documentElement.style.setProperty(
        "--lineoa-viewport-top",
        `${Math.round(top)}px`,
      );
    };

    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);

    return () => {
      document.body.classList.remove("lineoa-active", "lineoa-chat-open");
      document.documentElement.style.removeProperty("--lineoa-viewport-height");
      document.documentElement.style.removeProperty("--lineoa-viewport-top");
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("lineoa-chat-open", Boolean(selectedId));
    return () => document.body.classList.remove("lineoa-chat-open");
  }, [selectedId]);

  async function refreshList(silent = false) {
    if (!canAccess) return;
    if (silent) setRefreshing(true);
    else setLoading(true);
    if (!silent) setError(null);

    try {
      const next = await loadAiBuyerChatList(120);
      setChatList(next.cases);
      const nextUnread = Number(next.unreadTotal || 0);
      setUnreadTotal(nextUnread);
      onUnreadChange?.(nextUnread);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function markRead(caseId: string) {
    const currentUnread =
      chatList.find((item) => item.id === caseId)?.unreadCount || 0;

    if (currentUnread > 0) {
      setChatList((current) =>
        current.map((item) =>
          item.id === caseId ? { ...item, unreadCount: 0 } : item,
        ),
      );
      setUnreadTotal((current) => {
        const next = Math.max(0, current - currentUnread);
        onUnreadChange?.(next);
        return next;
      });
    }

    try {
      await markAiBuyerChatRead(caseId);
    } catch {
      void refreshList(true);
    }
  }

  async function refreshDetail(caseId = selectedId, silent = false) {
    if (!caseId || !canAccess) {
      setDetail(null);
      return;
    }

    const keepAtBottom = isNearBottom();
    if (!silent) {
      setDetail(null);
      setDetailLoading(true);
      setError(null);
    }

    try {
      const next = await loadAiBuyerChatCase(caseId);
      setDetail(next);
      void markRead(caseId);

      if (!silent || keepAtBottom) {
        window.requestAnimationFrame(() =>
          scrollToBottom(silent ? "auto" : "auto"),
        );
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void refreshList(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, profile.role]);

  useEffect(() => {
    if (selectedId) void refreshDetail(selectedId, false);
    else setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!canAccess) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshList(true);
      if (selectedId) void refreshDetail(selectedId, true);
    }, 10000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess, selectedId]);

  useEffect(() => {
    if (!detail) return;
    const timer = window.setTimeout(() => {
      if (isNearBottom()) scrollToBottom("auto");
    }, 40);
    return () => window.clearTimeout(timer);
  }, [detail?.case.id, detail?.messages.length]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const cases = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chatList.filter((item) => {
      if (onlyUnread && Number(item.unreadCount || 0) <= 0) return false;
      if (!q) return true;
      return [
        item.customer?.displayName,
        item.title,
        item.category,
        item.lastMessage?.text,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [chatList, onlyUnread, query]);

  const selected = chatList.find((item) => item.id === selectedId) || null;
  const offerAmount = numeric(offer);
  const canSend = Boolean(text.trim()) || offerAmount != null;

  async function send() {
    if (!selectedId || !canSend) return;
    setSending(true);
    setError(null);

    try {
      const currentOffer = offerAmount;
      await sendAiBuyerManualReply({
        caseId: selectedId,
        text: text.trim(),
        offerAmount: currentOffer,
      });

      setText("");
      setOffer("");
      setNotice(
        currentOffer != null
          ? `ส่งราคา ${money(currentOffer)} และบันทึก Manual Price แล้ว`
          : "ส่งข้อความ LINE แล้ว",
      );

      await refreshDetail(selectedId, true);
      void refreshList(true);
      window.requestAnimationFrame(() => scrollToBottom("smooth"));
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
          <div className="lineoa-list-title">
            <small>AMPHON · LINE OA</small>
            <div>
              <h1>แชท</h1>
              {unreadTotal > 0 && (
                <span className="lineoa-unread-total">
                  {unreadTotal > 99 ? "99+" : unreadTotal}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshList(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw className={loading || refreshing ? "spin" : ""} />
          </button>
        </header>

        <div className="lineoa-list-tools">
          <label className="lineoa-search">
            <Search />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ค้นหาชื่อลูกค้า รุ่น หรือข้อความ"
            />
          </label>
          <button
            type="button"
            className={"lineoa-unread-filter" + (onlyUnread ? " active" : "")}
            onClick={() => setOnlyUnread((current) => !current)}
          >
            <span className="lineoa-unread-dot" />
            ยังไม่อ่าน
            {unreadTotal > 0 && <b>{unreadTotal}</b>}
          </button>
        </div>

        <div className="lineoa-thread-list">
          {loading && !chatList.length ? (
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
            <div className="lineoa-empty">
              {onlyUnread ? "ไม่มีข้อความที่ยังไม่ได้อ่าน" : "ไม่พบแชท"}
            </div>
          )}
        </div>
      </aside>

      <main className="lineoa-chat-pane">
        {!selectedId ? (
          <div className="lineoa-chat-empty">
            <MessageCircle />
            <strong>เลือกแชทเพื่อเริ่มตอบลูกค้า</strong>
            <span>จุดแดงคือข้อความใหม่ที่ยังไม่ได้อ่าน</span>
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
                    : detail.pricing?.current_authorized_offer != null
                      ? money(detail.pricing.current_authorized_offer)
                      : "—"}
                </strong>
              </div>
            </header>

            {error && (
              <div className="lineoa-error">
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)}>
                  ปิด
                </button>
              </div>
            )}
            {notice && <div className="lineoa-notice">{notice}</div>}

            <div ref={messageListRef} className="lineoa-message-list">
              {detail.hasMore && (
                <div className="lineoa-history-note">
                  แสดง 120 ข้อความล่าสุด เพื่อให้เปิดแชทเร็วและลื่น
                </div>
              )}

              <div className="lineoa-day-divider">
                <span>บทสนทนาล่าสุด</span>
              </div>

              {detail.messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  images={detail.images}
                  onOpenImage={setViewer}
                />
              ))}
            </div>

            <footer className="lineoa-composer">
              <div className="lineoa-offer-box">
                <Banknote />
                <label>
                  <span>ราคาเสนอรับซื้อ</span>
                  <input
                    inputMode="numeric"
                    value={offer}
                    onChange={(event) => setOffer(event.target.value)}
                    onFocus={() =>
                      window.setTimeout(() => scrollToBottom("auto"), 120)
                    }
                    placeholder="เช่น 5,200"
                  />
                </label>
                {offerAmount != null && <b>{money(offerAmount)}</b>}
              </div>

              <div className="lineoa-compose-row">
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onFocus={() =>
                    window.setTimeout(() => scrollToBottom("auto"), 120)
                  }
                  placeholder={
                    offerAmount != null
                      ? "พิมพ์ข้อความเพิ่ม หรือส่งราคาอย่างเดียว"
                      : "พิมพ์ข้อความถึงลูกค้า…"
                  }
                  rows={1}
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
                <button
                  type="button"
                  disabled={!canSend || sending}
                  onClick={() => void send()}
                >
                  {sending ? <LoaderCircle className="spin" /> : <Send />}
                  <span>{offerAmount != null ? "ส่งราคา" : "ส่ง"}</span>
                </button>
              </div>

              {offerAmount != null && (
                <p className="lineoa-offer-preview">
                  บันทึก {money(offerAmount)} เป็น Manual Price และส่งราคาเข้า LINE
                  พร้อมกัน
                </p>
              )}
            </footer>
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
          <button type="button" onClick={() => setViewer(null)}>
            <X />
          </button>
          <img
            src={viewer}
            alt="รูปจาก LINE"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}
