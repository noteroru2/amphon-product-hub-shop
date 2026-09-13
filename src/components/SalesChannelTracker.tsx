import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  History,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { copyText } from "../lib/sales";
import {
  listProductPublications,
  listPublicationHistory,
  publicationChannels,
  removePublicationRealtimeChannel,
  saveProductPublication,
  subscribePublications,
} from "../lib/publications";
import type {
  ProductDraft,
  ProductPublication,
  Profile,
  PublicationChannel,
  SalesChannelPublicationEvent,
} from "../types/product";
import { PublicationConfirmSheet } from "./PublicationConfirmSheet";
import { ProductCleanupTaskNotice } from "./CleanupTaskQueue";
import "../styles/salesChannelTracker.css";

const TRACKED_CHANNELS: PublicationChannel[] = [
  "website",
  "marketplace",
  "facebook",
  "line",
];

function thaiDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusLabel(
  channel: PublicationChannel,
  status: ProductPublication["status"],
) {
  if (status === "published")
    return channel === "line" ? "ส่งแล้ว" : "เผยแพร่แล้ว";
  if (status === "ended") return "นำออกแล้ว";
  if (status === "expired") return "หมดอายุแล้ว";
  return channel === "line" ? "ยังไม่ได้ส่ง" : "ยังไม่ได้โพสต์";
}

export default function SalesChannelTracker({
  draft,
  profile,
}: {
  draft: ProductDraft;
  profile: Profile;
}) {
  const productId = draft.remoteProductId || "";
  const [records, setRecords] = useState<ProductPublication[]>([]);
  const [history, setHistory] = useState<SalesChannelPublicationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmChannel, setConfirmChannel] =
    useState<PublicationChannel | null>(null);
  const [busy, setBusy] = useState<PublicationChannel | null>(null);
  const canManage = ["owner", "admin", "sales"].includes(profile.role);
  const product = useMemo(
    () => ({ id: productId, sku: draft.sku || "", status: draft.status }),
    [draft.sku, draft.status, productId],
  );

  const refresh = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    try {
      const [nextRecords, nextHistory] = await Promise.all([
        listProductPublications([productId]),
        listPublicationHistory(productId),
      ]);
      setRecords(nextRecords);
      setHistory(nextHistory);
      setError(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "โหลดช่องทางการขายไม่สำเร็จ",
      );
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let timer: number | undefined;
    const channel = subscribePublications(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 300);
    });
    return () => {
      window.clearTimeout(timer);
      if (channel) void removePublicationRealtimeChannel(channel);
    };
  }, [profile.id, refresh]);

  const activeExternal = records.filter((record) => {
    const definition = publicationChannels.find(
      (item) => item.id === record.channel,
    );
    return (
      record.status === "published" &&
      record.channel !== "website" &&
      definition?.persistentListing
    );
  });

  async function transition(
    record: ProductPublication,
    status: "ended" | "expired",
  ) {
    if (
      !window.confirm(
        status === "ended"
          ? "ยืนยันว่าปิด/นำประกาศออกแล้วหรือไม่?"
          : "ยืนยันว่าประกาศหมดอายุแล้วหรือไม่?",
      )
    )
      return;
    setBusy(record.channel);
    setMessage(null);
    try {
      await saveProductPublication({
        product,
        profile,
        channel: record.channel,
        status,
        externalUrl: record.externalUrl,
        actionId: crypto.randomUUID(),
      });
      setMessage(
        status === "ended"
          ? "บันทึกว่าปิดประกาศแล้ว"
          : "บันทึกว่าประกาศหมดอายุแล้ว",
      );
      await refresh();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "บันทึกสถานะไม่สำเร็จ กรุณาลองใหม่",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!productId) return null;
  return (
    <section className="sales-channel-tracker" data-hub5-sales-channel-tracker>
      <header>
        <div>
          <strong>ช่องทางการขาย</strong>
          <small>SHOP จากระบบจริง · Social จากคำยืนยันพนักงาน</small>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="รีเฟรชช่องทาง"
        >
          <RefreshCw className={loading ? "spin" : ""} />
        </button>
      </header>
      {draft.status === "sold" && activeExternal.length ? (
        <div className="channel-cleanup-alert">
          <AlertTriangle />
          <div>
            <strong>
              มีช่องทางขายที่ยังไม่ได้ปิด {activeExternal.length} ช่องทาง
            </strong>
            <small>
              {activeExternal
                .map(
                  (record) =>
                    publicationChannels.find(
                      (item) => item.id === record.channel,
                    )?.label,
                )
                .join(", ")}
            </small>
          </div>
        </div>
      ) : null}
      {draft.status === "sold" ? (
        <ProductCleanupTaskNotice productId={productId} />
      ) : null}
      {draft.status === "reserved" ? (
        <div className="channel-reserved-warning">
          สินค้าถูกจอง — ประกาศเดิมยังแสดงอยู่ แต่ควรตรวจสอบก่อนสร้างประกาศใหม่
        </div>
      ) : null}
      {error ? (
        <div className="save-error">
          {error}
          <button type="button" onClick={() => void refresh()}>
            ลองใหม่
          </button>
        </div>
      ) : null}
      {loading && !records.length ? (
        <div className="channel-loading">
          <LoaderCircle className="spin" />
          กำลังโหลดสถานะช่องทาง
        </div>
      ) : (
        <div className="channel-status-list">
          {TRACKED_CHANNELS.map((channelId) => {
            const definition = publicationChannels.find(
              (item) => item.id === channelId,
            )!;
            const record = records.find((item) => item.channel === channelId);
            const status = record?.status || "not_published";
            const isShop = channelId === "website";
            return (
              <article
                key={channelId}
                className={`channel-status-card status-${status}`}
              >
                <div className="channel-status-head">
                  <span>{definition.emoji}</span>
                  <div>
                    <strong>{definition.label}</strong>
                    <small>{statusLabel(channelId, status)}</small>
                  </div>
                  <b>{status === "published" ? "●" : "○"}</b>
                </div>
                {record?.publishedAt ? (
                  <div className="channel-actor">
                    {channelId === "line" ? "ส่งเมื่อ" : "โพสต์เมื่อ"}{" "}
                    {thaiDate(record.publishedAt)} · โดย{" "}
                    {record.publishedByName || "พนักงาน"}
                  </div>
                ) : null}
                {record?.endedAt && status !== "published" ? (
                  <div className="channel-actor">
                    อัปเดต {thaiDate(record.endedAt)} · โดย{" "}
                    {record.endedByName || "พนักงาน"}
                  </div>
                ) : null}
                <div className="channel-card-actions">
                  {record?.externalUrl ? (
                    <>
                      <a
                        href={record.externalUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        <ExternalLink />
                        เปิดประกาศ
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          void copyText(record.externalUrl!).then(() =>
                            setMessage("คัดลอกลิงก์แล้ว"),
                          )
                        }
                      >
                        <ClipboardCopy />
                        คัดลอกลิงก์
                      </button>
                    </>
                  ) : null}
                  {!isShop &&
                  canManage &&
                  status !== "published" &&
                  draft.status !== "sold" ? (
                    <button
                      type="button"
                      className="channel-mark"
                      onClick={() => setConfirmChannel(channelId)}
                    >
                      {definition.manualConfirmationLabel}
                    </button>
                  ) : null}
                  {!isShop &&
                  canManage &&
                  status === "published" &&
                  definition.persistentListing ? (
                    <>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void transition(record!, "ended")}
                      >
                        {busy === channelId ? (
                          <LoaderCircle className="spin" />
                        ) : null}
                        ปิดประกาศแล้ว
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void transition(record!, "expired")}
                      >
                        หมดอายุแล้ว
                      </button>
                    </>
                  ) : null}
                  {!isShop &&
                  canManage &&
                  channelId === "line" &&
                  status === "published" ? (
                    <button
                      type="button"
                      className="channel-mark"
                      onClick={() => setConfirmChannel("line")}
                    >
                      บันทึกว่าส่งอีกครั้ง
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {message ? <div className="publish-message">{message}</div> : null}
      {!!history.length ? (
        <details className="channel-history">
          <summary>
            <History />
            ประวัติช่องทาง ({history.length})
          </summary>
          <div>
            {history.slice(0, 12).map((event) => (
              <div key={event.id}>
                <span>
                  {
                    publicationChannels.find(
                      (item) => item.id === event.channel,
                    )?.emoji
                  }
                </span>
                <p>
                  <strong>
                    {event.eventType.toUpperCase()} ·{" "}
                    {
                      publicationChannels.find(
                        (item) => item.id === event.channel,
                      )?.label
                    }
                  </strong>
                  <small>
                    {thaiDate(event.occurredAt)} · {event.actorName}
                  </small>
                </p>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {confirmChannel ? (
        <PublicationConfirmSheet
          channel={confirmChannel}
          product={product}
          profile={profile}
          onClose={() => setConfirmChannel(null)}
          onSaved={async () => {
            setMessage(
              confirmChannel === "line"
                ? "บันทึกว่าส่ง LINE แล้ว"
                : "บันทึกว่าโพสต์แล้ว",
            );
            await refresh();
          }}
        />
      ) : null}
    </section>
  );
}
