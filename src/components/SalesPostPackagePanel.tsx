import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardCopy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  PackageCheck,
  X,
} from "lucide-react";
import type { ProductImageExportController } from "../hooks/useProductImageExport";
import { copyText } from "../lib/sales";
import { getSmartFields } from "../lib/productSchemas";
import {
  buildSalesPostPackage,
  validateSalesPostPackage,
  type SalesPostPackage,
  type SalesPostPreset,
} from "../lib/salesPostPackage";
import { loadSalesPostContext } from "../lib/salesPostContext";
import type { ProductDraft, Profile, PublicationChannel } from "../types/product";
import { ProductImageExportControls } from "./ProductImageExportActions";
import { PublicationConfirmSheet } from "./PublicationConfirmSheet";

const presetLabels: Array<{ id: SalesPostPreset; label: string }> = [
  { id: "GENERAL", label: "ทั่วไป" },
  { id: "MARKETPLACE", label: "Marketplace" },
  { id: "FACEBOOK_PAGE", label: "Facebook" },
  { id: "LINE", label: "LINE" },
];

export default function SalesPostPackagePanel({
  draft,
  profile,
  imageExport,
  onClose,
}: {
  draft: ProductDraft;
  profile: Profile;
  imageExport: ProductImageExportController;
  onClose: () => void;
}) {
  const [pkg, setPackage] = useState<SalesPostPackage | null>(null);
  const [preset, setPreset] = useState<SalesPostPreset>("GENERAL");
  const [caption, setCaption] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [confirmChannel, setConfirmChannel] = useState<PublicationChannel | null>(null);
  const fields = useMemo(
    () => getSmartFields(draft),
    [draft.category, draft.subtype],
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void loadSalesPostContext(draft, controller.signal).then((context) => {
      if (!active) return;
      setPackage(buildSalesPostPackage(draft, fields, context));
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [draft, fields]);

  useEffect(() => {
    if (pkg) setCaption(pkg.captions[preset]);
  }, [pkg, preset]);

  async function copy(value: string, success: string) {
    try {
      await copyText(value);
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function downloadPackage() {
    if (!pkg) return;
    setDownloading(true);
    setMessage(null);
    try {
      const { downloadSalesPostPackage } = await import(
        "../lib/salesPostPackageDownload"
      );
      await downloadSalesPostPackage(pkg, draft, imageExport.files);
      setMessage("ดาวน์โหลดชุดโพสต์แล้ว");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloading(false);
    }
  }

  const validation = pkg
    ? validateSalesPostPackage(pkg)
    : { ready: false, missing: [] };

  return (
    <div className="modal-backdrop sales-package-backdrop">
      <div className="modal-sheet sales-package-sheet" data-hub3-sales-package>
        <header className="sales-package-head">
          <div>
            <p className="eyebrow">SALES POST PACKAGE</p>
            <h2>ชุดโพสต์ขายพร้อมแล้ว</h2>
            <small>{draft.sku} · สร้างจากข้อมูลสินค้าปัจจุบัน</small>
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
        {!pkg ? (
          <div className="sales-package-loading">
            <LoaderCircle className="spin" />
            <span>กำลังเตรียมชุดโพสต์ขาย...</span>
          </div>
        ) : (
          <>
            <section
              className={`sales-readiness ${validation.ready ? "ready" : "blocked"}`}
            >
              <div>
                <PackageCheck />
                <span>
                  <strong>ความพร้อมโพสต์ขาย: {pkg.readinessScore}/10</strong>
                  <small>
                    {validation.ready
                      ? "ข้อมูลหลักพร้อมใช้งาน"
                      : `ขาด: ${validation.missing.join(", ")}`}
                  </small>
                </span>
              </div>
              {validation.ready ? <CheckCircle2 /> : null}
            </section>
            {!!pkg.warnings.length && (
              <div className="sales-package-warnings">
                {pkg.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            )}
            <section className="sales-package-section">
              <div className="sales-package-section-title">
                <ImageIcon />
                <div>
                  <strong>รูปสินค้า</strong>
                  <small>{pkg.imageCount} รูปจาก SKU ปัจจุบัน</small>
                </div>
              </div>
              <ProductImageExportControls
                draft={draft}
                imageExport={imageExport}
                compact
              />
            </section>
            <section className="sales-package-section">
              <div className="sales-package-section-title">
                <ClipboardCopy />
                <div>
                  <strong>ข้อความขาย</strong>
                  <small>แก้ไขชั่วคราวได้ โดยไม่เปลี่ยนข้อมูลสินค้า</small>
                </div>
              </div>
              <div className="sales-preset-tabs" role="tablist">
                {presetLabels.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={preset === item.id ? "active" : ""}
                    onClick={() => setPreset(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <textarea
                className="sales-caption-editor"
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                rows={15}
              />
              <button
                type="button"
                className="sales-package-primary"
                onClick={() => void copy(caption, "คัดลอกแล้ว")}
                disabled={!validation.ready}
              >
                <ClipboardCopy />
                คัดลอกข้อความขาย
              </button>
              {draft.remoteProductId && preset === "FACEBOOK_PAGE" && ["owner", "admin", "sales"].includes(profile.role) ? (
                <button type="button" className="sales-channel-confirm" onClick={() => setConfirmChannel("facebook")}>
                  <CheckCircle2 />ทำเครื่องหมายว่าโพสต์ Facebook Page แล้ว
                </button>
              ) : null}
              {draft.remoteProductId && preset === "LINE" && ["owner", "admin", "sales"].includes(profile.role) ? (
                <button type="button" className="sales-channel-confirm" onClick={() => setConfirmChannel("line")}>
                  <CheckCircle2 />ทำเครื่องหมายว่าส่ง LINE แล้ว
                </button>
              ) : null}
            </section>
            <section className="sales-package-actions">
              <button
                type="button"
                onClick={() =>
                  void copy(pkg.titleAndPrice, "คัดลอกชื่อและราคาแล้ว")
                }
              >
                <ClipboardCopy />
                คัดลอกชื่อ + ราคา
              </button>
              {pkg.canonicalShopUrl ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      void copy(pkg.canonicalShopUrl!, "คัดลอกลิงก์ SHOP แล้ว")
                    }
                  >
                    <Link2 />
                    คัดลอกลิงก์สินค้า
                  </button>
                  <a
                    href={pkg.canonicalShopUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink />
                    เปิดหน้าสินค้าใน SHOP
                  </a>
                </>
              ) : (
                <div className="shop-unpublished">ยังไม่ได้เผยแพร่ใน SHOP</div>
              )}
              <button
                type="button"
                onClick={() => void downloadPackage()}
                disabled={downloading || !validation.ready}
              >
                <Download />
                {downloading ? "กำลังสร้างชุดโพสต์..." : "ดาวน์โหลดชุดโพสต์"}
              </button>
            </section>
            {message && (
              <div className="sales-package-message" aria-live="polite">
                {message}
              </div>
            )}
            <p className="sales-package-note">
              Hub เตรียมข้อมูลให้เท่านั้น
              พนักงานต้องตรวจข้อความและโพสต์ด้วยตนเองในแต่ละช่องทาง
            </p>
            {confirmChannel && draft.remoteProductId ? (
              <PublicationConfirmSheet
                channel={confirmChannel}
                product={{ id: draft.remoteProductId, sku: draft.sku || "", status: draft.status }}
                profile={profile}
                onClose={() => setConfirmChannel(null)}
                onSaved={() => setMessage(confirmChannel === "line" ? "บันทึกว่าส่ง LINE แล้ว" : "บันทึกว่าโพสต์ Facebook Page แล้ว")}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
