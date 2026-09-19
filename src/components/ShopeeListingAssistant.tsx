import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  Image as ImageIcon,
  ListChecks,
  LoaderCircle,
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
  buildShopeeManualListingDraft,
  shopeeSellerDestinationUrl,
} from "../lib/shopeeManualListing";
import {
  DEFAULT_SHOPEE_MANUAL_MARKUP_PERCENT,
  SHOPEE_MANUAL_MARKUP_OPTIONS,
  type ShopeeManualMarkupPercent,
} from "../lib/shopeePricing";
import type { ProductDraft } from "../types/product";
import { ProductImageExportControls } from "./ProductImageExportActions";
import "../styles/shopeeAssistant.css";

export default function ShopeeListingAssistant({
  draft,
  imageExport,
  onClose,
}: {
  draft: ProductDraft;
  imageExport: ProductImageExportController;
  onClose: () => void;
}) {
  const [salesPackage, setSalesPackage] = useState<SalesPostPackage | null>(null);
  const [markup, setMarkup] = useState<ShopeeManualMarkupPercent>(
    DEFAULT_SHOPEE_MANUAL_MARKUP_PERCENT,
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
      if (active) setSalesPackage(buildSalesPostPackage(draft, fields, context));
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [draft, fields]);

  const listing = useMemo(
    () =>
      salesPackage
        ? buildShopeeManualListingDraft(salesPackage, draft, markup, imageReady)
        : null,
    [draft, imageReady, markup, salesPackage],
  );

  const sellerUrl = shopeeSellerDestinationUrl(
    import.meta.env.VITE_SHOPEE_SELLER_URL,
  );

  async function copy(value: string, label: string) {
    try {
      await copyText(value);
      setMessage("คัดลอก" + label + "แล้ว");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="modal-backdrop shopee-assistant-backdrop">
      <div className="modal-sheet shopee-assistant-sheet" data-shopee-assisted-listing>
        <header className="sales-package-head">
          <div>
            <p className="eyebrow">SHOPEE LISTING ASSISTANT</p>
            <h2>ผู้ช่วยลง Shopee</h2>
            <small>{draft.sku} · เตรียมข้อมูลให้พนักงานกรอก Seller Centre</small>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="ปิด">
            <X />
          </button>
        </header>

        {!listing ? (
          <div className="sales-package-loading">
            <LoaderCircle className="spin" />
            <span>กำลังเตรียมข้อมูล Shopee...</span>
          </div>
        ) : (
          <>
            <section className={"shopee-readiness " + listing.readiness.toLowerCase()}>
              <div>
                {listing.readiness === "READY" ? <CheckCircle2 /> : <TriangleAlert />}
                <span>
                  <strong>{listing.readinessLabel}</strong>
                  <small>
                    {listing.imageCount} รูป · SKU {listing.sku || "ยังไม่มี"}
                  </small>
                </span>
              </div>
            </section>

            <section className="shopee-price-card">
              <div className="shopee-price-heading">
                <div>
                  <span>ราคาปกติหน้า Hub</span>
                  <strong>{listing.basePriceDisplay}</strong>
                </div>
                <div className="shopee-price-arrow">→</div>
                <div>
                  <span>ราคาโพสต์ Shopee</span>
                  <strong>{listing.shopeePriceDisplay}</strong>
                </div>
              </div>
              <div className="shopee-markup-tabs" role="tablist" aria-label="เลือกเปอร์เซ็นต์บวกราคา Shopee">
                {SHOPEE_MANUAL_MARKUP_OPTIONS.map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={markup === value ? "active" : ""}
                    onClick={() => setMarkup(value)}
                  >
                    +{value}%
                  </button>
                ))}
              </div>
              <small>{listing.priceFormulaText}</small>
              <button
                type="button"
                className="shopee-copy-price"
                onClick={() => void copy(listing.shopeePriceCopyValue, "ราคา Shopee")}
              >
                <ClipboardCopy />
                คัดลอกราคา {listing.shopeePriceDisplay}
              </button>
              <p>
                ราคา Shopee เป็นราคาช่วยกรอกเท่านั้น ไม่แก้ราคาปกติใน Hub
                และไม่ได้คำนวณค่าธรรมเนียม/โปรโมชันของ Shopee อัตโนมัติ
              </p>
            </section>

            {!!listing.warnings.length && (
              <div className="sales-package-warnings">
                {listing.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            )}

            <section className="shopee-card">
              <div className="sales-package-section-title">
                <ImageIcon />
                <div>
                  <strong>รูปสินค้า</strong>
                  <small>{listing.imageCount} รูป · รูปหลักใช้เป็นภาพแรก</small>
                </div>
              </div>
              {listing.coverImageUrl ? (
                <div className="shopee-cover">
                  <img src={listing.coverImageUrl} alt="รูปหลักสำหรับ Shopee" />
                  <span>รูปหลัก</span>
                </div>
              ) : null}
              <ProductImageExportControls draft={draft} imageExport={imageExport} compact />
            </section>

            <section className="shopee-card shopee-fields">
              <ShopeeField
                label="ชื่อสินค้า"
                value={listing.title}
                onCopy={() => void copy(listing.title, "ชื่อสินค้า")}
              />
              <ShopeeField
                label="ราคา Shopee"
                value={listing.shopeePriceDisplay}
                meta={
                  "บวกจาก Hub " +
                  listing.markupPercent +
                  "% · เพิ่ม " +
                  new Intl.NumberFormat("th-TH").format(listing.markupAmount) +
                  " บาท"
                }
                onCopy={() => void copy(listing.shopeePriceCopyValue, "ราคา")}
              />
              <ShopeeField
                label="Seller SKU"
                value={listing.sku}
                onCopy={() => void copy(listing.sku, "SKU")}
              />
              <ShopeeField
                label="สต๊อก"
                value={String(listing.stock)}
                meta="สินค้า 1 ชิ้น: ตั้ง 1 เฉพาะเมื่อพร้อมขาย"
                onCopy={() => void copy(String(listing.stock), "สต๊อก")}
              />
              <ShopeeField label="หมวดหมู่แนะนำ" value={listing.categorySuggestion} />
              <ShopeeField label="สภาพ" value={listing.conditionSuggestion} />
            </section>

            <section className="shopee-card">
              <div className="sales-package-section-title">
                <ClipboardCopy />
                <div>
                  <strong>รายละเอียดสินค้า</strong>
                  <small>ไม่มีต้นทุน Serial หรือโน้ตภายใน และไม่ใส่ลิงก์เว็บภายนอก</small>
                </div>
              </div>
              <pre className="shopee-description">{listing.description}</pre>
              <button
                type="button"
                className="sales-package-primary shopee-primary"
                onClick={() => void copy(listing.description, "รายละเอียด")}
              >
                <ClipboardCopy />
                คัดลอกรายละเอียด
              </button>
            </section>

            <section className="shopee-card">
              <div className="sales-package-section-title">
                <ListChecks />
                <div>
                  <strong>Checklist ก่อนกดเผยแพร่</strong>
                  <small>น้ำหนัก/ขนาดพัสดุต้องตรวจจากสินค้าจริง</small>
                </div>
              </div>
              <div className="shopee-checklist">
                {listing.checklist.map((item) => (
                  <div key={item.id} className={item.status.toLowerCase()}>
                    <span>{item.status === "PASS" ? "✓" : item.status === "WARNING" ? "!" : "–"}</span>
                    <div>
                      <strong>{item.label}</strong>
                      {item.detail ? <small>{item.detail}</small> : null}
                    </div>
                    <b>{item.status}</b>
                  </div>
                ))}
              </div>
            </section>

            <section className="shopee-actions">
              <button type="button" onClick={() => void copy(listing.copyAllText, "ข้อมูลทั้งหมด")}>
                <ClipboardCopy />
                คัดลอกข้อมูลทั้งหมด
              </button>
              <a
                className={listing.readiness === "BLOCKED" ? "disabled" : ""}
                href={sellerUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(event) => {
                  if (listing.readiness === "BLOCKED") event.preventDefault();
                }}
              >
                <ExternalLink />
                เปิด Shopee Seller Centre
              </a>
            </section>

            {message ? (
              <div className="sales-package-message" aria-live="polite">{message}</div>
            ) : null}

            <p className="sales-package-note shopee-note">
              <ShoppingBag size={13} />
              Hub ช่วยเตรียมข้อมูลและคำนวณราคา +18–20% เท่านั้น
              พนักงานยังต้องตรวจหมวด น้ำหนัก ขนาด ขนส่ง และกดเผยแพร่เอง
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ShopeeField({
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
    <div className="shopee-field">
      <div>
        <span>{label}</span>
        <strong>{value || "—"}</strong>
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
