import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  ListChecks,
  LoaderCircle,
  MapPin,
  ShoppingBag,
  TriangleAlert,
  X,
} from "lucide-react";
import type { ProductImageExportController } from "../hooks/useProductImageExport";
import { copyText } from "../lib/sales";
import { getSmartFields } from "../lib/productSchemas";
import {
  buildSalesPostPackage,
  type SalesPostPackage,
} from "../lib/salesPostPackage";
import { loadSalesPostContext } from "../lib/salesPostContext";
import {
  buildMarketplaceListingDraft,
  marketplaceDestinationUrl,
} from "../lib/marketplaceListing";
import type { ProductDraft } from "../types/product";
import { ProductImageExportControls } from "./ProductImageExportActions";
import "../styles/marketplaceAssistant.css";

export default function MarketplaceListingAssistant({
  draft,
  imageExport,
  onClose,
}: {
  draft: ProductDraft;
  imageExport: ProductImageExportController;
  onClose: () => void;
}) {
  const [salesPackage, setSalesPackage] = useState<SalesPostPackage | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const fields = useMemo(
    () => getSmartFields(draft),
    [draft.category, draft.subtype],
  );
  const imageReady =
    imageExport.status === "ready" || imageExport.status === "fallback";

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void loadSalesPostContext(draft, controller.signal).then((context) => {
      if (active)
        setSalesPackage(buildSalesPostPackage(draft, fields, context));
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [draft, fields]);

  const listing = useMemo(
    () =>
      salesPackage
        ? buildMarketplaceListingDraft(salesPackage, draft, imageReady)
        : null,
    [draft, imageReady, salesPackage],
  );
  const facebookUrl = marketplaceDestinationUrl(
    import.meta.env.VITE_FACEBOOK_MARKETPLACE_URL,
  );

  async function copy(value: string, label: string) {
    try {
      await copyText(value);
      setMessage(`คัดลอก${label}แล้ว`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="modal-backdrop marketplace-assistant-backdrop">
      <div
        className="modal-sheet marketplace-assistant-sheet"
        data-hub4-marketplace-assistant
      >
        <header className="sales-package-head">
          <div>
            <p className="eyebrow">MARKETPLACE LISTING ASSISTANT</p>
            <h2>ผู้ช่วยลง Marketplace</h2>
            <small>{draft.sku} · ช่วยเตรียมข้อมูลสำหรับกรอกด้วยตนเอง</small>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="ปิด"
          >
            <X />
          </button>
        </header>
        {!listing ? (
          <div className="sales-package-loading">
            <LoaderCircle className="spin" />
            <span>กำลังเตรียมข้อมูล Marketplace...</span>
          </div>
        ) : (
          <>
            <section
              className={`marketplace-readiness ${listing.readiness.toLowerCase()}`}
            >
              <div>
                {listing.readiness === "READY" ? (
                  <CheckCircle2 />
                ) : (
                  <TriangleAlert />
                )}
                <span>
                  <strong>{listing.readinessLabel}</strong>
                  <small>
                    {listing.imageCount} รูป · ชื่อ{" "}
                    {listing.titleCharacterCount} ตัวอักษร
                  </small>
                </span>
              </div>
            </section>
            {!!listing.warnings.length && (
              <div className="sales-package-warnings">
                {listing.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            )}

            <section className="marketplace-card marketplace-cover-card">
              <div className="sales-package-section-title">
                <ImageIcon />
                <div>
                  <strong>รูปสินค้า</strong>
                  <small>
                    {listing.imageCount} รูปพร้อมใช้ · รูปแรก/รูปหลักเป็นหน้าปก
                  </small>
                </div>
              </div>
              {listing.coverImageUrl ? (
                <div className="marketplace-cover">
                  <img src={listing.coverImageUrl} alt="รูปหน้าปกสินค้า" />
                  <span>รูปหน้าปก</span>
                </div>
              ) : null}
              <ProductImageExportControls
                draft={draft}
                imageExport={imageExport}
                compact
              />
            </section>

            <section className="marketplace-card marketplace-fields">
              <MarketplaceField
                label="ชื่อประกาศ"
                value={listing.title}
                meta={`${listing.titleCharacterCount} ตัวอักษร`}
                onCopy={() => void copy(listing.title, "ชื่อ")}
              />
              <MarketplaceField
                label="ราคา"
                value={listing.priceDisplay}
                meta={`ค่าที่คัดลอก: ${listing.priceCopyValue}`}
                onCopy={() => void copy(listing.priceCopyValue, "ราคา")}
              />
              <MarketplaceField
                label="หมวดหมู่แนะนำ"
                value={listing.categorySuggestion}
              />
              <MarketplaceField
                label="สภาพแนะนำ"
                value={listing.conditionSuggestion}
              />
            </section>

            <section className="marketplace-card">
              <div className="sales-package-section-title">
                <ClipboardCopy />
                <div>
                  <strong>รายละเอียด</strong>
                  <small>ใช้ Marketplace preset จาก HUB-3 โดยตรง</small>
                </div>
              </div>
              <pre className="marketplace-description">
                {listing.description}
              </pre>
              <button
                type="button"
                className="sales-package-primary"
                onClick={() => void copy(listing.description, "รายละเอียด")}
              >
                <ClipboardCopy />
                คัดลอกรายละเอียด
              </button>
            </section>

            {listing.locationText ? (
              <section className="marketplace-card marketplace-inline-info">
                <MapPin />
                <div>
                  <strong>ตำแหน่ง/การรับสินค้า</strong>
                  <span>{listing.locationText}</span>
                </div>
              </section>
            ) : null}
            <section className="marketplace-card">
              <div className="sales-package-section-title">
                <ListChecks />
                <div>
                  <strong>Checklist</strong>
                  <small>
                    PASS / WARNING / N/A สำหรับตรวจด้วยสายตาก่อนโพสต์
                  </small>
                </div>
              </div>
              <div className="marketplace-checklist">
                {listing.checklist.map((item) => (
                  <div key={item.id} className={item.status.toLowerCase()}>
                    <span>
                      {item.status === "PASS"
                        ? "✓"
                        : item.status === "WARNING"
                          ? "!"
                          : "–"}
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      {item.detail ? <small>{item.detail}</small> : null}
                    </div>
                    <b>{item.status}</b>
                  </div>
                ))}
              </div>
            </section>

            <section className="marketplace-actions">
              <button
                type="button"
                onClick={() =>
                  void copy(
                    `${listing.title} — ${listing.priceDisplay}`,
                    "ชื่อและราคา",
                  )
                }
              >
                <ClipboardCopy />
                คัดลอกชื่อ + ราคา
              </button>
              <button
                type="button"
                onClick={() => void copy(listing.copyAllText, "ข้อมูลทั้งหมด")}
              >
                <ClipboardCopy />
                คัดลอกทั้งหมด
              </button>
              {listing.shopUrl ? (
                <button
                  type="button"
                  onClick={() => void copy(listing.shopUrl!, "ลิงก์สินค้า")}
                >
                  <Link2 />
                  คัดลอกลิงก์สินค้า
                </button>
              ) : (
                <div className="shop-unpublished">ยังไม่ได้เผยแพร่ใน SHOP</div>
              )}
              <a
                className={listing.readiness === "BLOCKED" ? "disabled" : ""}
                href={facebookUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(event) => {
                  if (listing.readiness === "BLOCKED") event.preventDefault();
                }}
              >
                <ExternalLink />
                เปิด Facebook Marketplace
              </a>
            </section>
            {message ? (
              <div className="sales-package-message" aria-live="polite">
                {message}
              </div>
            ) : null}
            <p className="sales-package-note">
              <ShoppingBag size={13} /> Hub ไม่ล็อกอิน ไม่กรอกฟอร์ม
              และไม่กดเผยแพร่ Facebook ให้ พนักงานต้องตรวจและโพสต์ด้วยตนเอง
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function MarketplaceField({
  label,
  value,
  meta,
  onCopy,
}: {
  label: string;
  value: string;
  meta?: string;
  onCopy?: () => void;
}) {
  return (
    <div className="marketplace-field">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {meta ? <small>{meta}</small> : null}
      </div>
      {onCopy ? (
        <button type="button" onClick={onCopy}>
          <ClipboardCopy />
          คัดลอก
        </button>
      ) : null}
    </div>
  );
}
