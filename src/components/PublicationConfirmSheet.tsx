import { useMemo, useState } from "react";
import { CheckCircle2, LoaderCircle, X } from "lucide-react";
import {
  publicationChannels,
  saveProductPublication,
} from "../lib/publications";
import type {
  ProductStatus,
  Profile,
  PublicationChannel,
} from "../types/product";

function localDateTimeValue() {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return now.toISOString().slice(0, 16);
}

export function PublicationConfirmSheet({
  channel,
  product,
  profile,
  onClose,
  onSaved,
}: {
  channel: PublicationChannel;
  product: { id: string; sku: string; status: ProductStatus };
  profile: Profile;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const definition = publicationChannels.find((item) => item.id === channel)!;
  const [occurredAt, setOccurredAt] = useState(localDateTimeValue);
  const [externalUrl, setExternalUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionId = useMemo(() => crypto.randomUUID(), []);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await saveProductPublication({
        product,
        profile,
        channel,
        status: "published",
        externalUrl,
        occurredAt: new Date(occurredAt).toISOString(),
        actionId,
      });
      await onSaved();
      onClose();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "บันทึกสถานะไม่สำเร็จ กรุณาลองใหม่",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop publication-confirm-backdrop">
      <div
        className="modal-sheet publication-confirm-sheet"
        data-hub5-publication-confirm
      >
        <header className="modal-head">
          <div>
            <p className="eyebrow">STAFF-CONFIRMED</p>
            <h2>{definition.manualConfirmationLabel}</h2>
            <small>{product.sku} · บันทึกจากคำยืนยันของพนักงาน</small>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            disabled={busy}
          >
            <X />
          </button>
        </header>
        {product.status === "reserved" ? (
          <div className="channel-reserved-warning">
            สินค้าถูกจอง — โปรดตรวจสอบก่อนยืนยันว่าลงขาย
          </div>
        ) : null}
        <label className="field">
          <span>{channel === "line" ? "ส่งเมื่อ" : "โพสต์เมื่อ"}</span>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
          />
        </label>
        {definition.supportsExternalUrl ? (
          <label className="field">
            <span>ลิงก์ประกาศ (ไม่บังคับ)</span>
            <input
              type="url"
              inputMode="url"
              value={externalUrl}
              onChange={(event) => setExternalUrl(event.target.value)}
              placeholder="https://..."
            />
          </label>
        ) : null}
        <div className="publication-confirm-note">
          ระบบบันทึกสถานะที่พนักงานรายงาน ไม่ได้ตรวจสอบหรือโพสต์ไปยัง{" "}
          {definition.label} อัตโนมัติ
        </div>
        {error ? <div className="save-error">{error}</div> : null}
        <button
          type="button"
          className="primary-wide"
          onClick={() => void confirm()}
          disabled={busy || !occurredAt}
        >
          {busy ? (
            <>
              <LoaderCircle className="spin" />
              กำลังบันทึก...
            </>
          ) : (
            <>
              <CheckCircle2 />
              บันทึกว่า{channel === "line" ? "ส่งแล้ว" : "โพสต์แล้ว"}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
