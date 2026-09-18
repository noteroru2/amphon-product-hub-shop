import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ClipboardCopy,
  ExternalLink,
  FileText,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { draftFromProduct } from "../lib/backend";
import { copyText } from "../lib/sales";
import { ProductImageExportActions } from "./ProductImageExportActions";
import {
  canonicalShopUrl,
  getCommerceProduct,
  getCommerceStoreSettings,
  prepareCommerceProduct,
} from "../lib/commerce";
import {
  listAutoPublishQueue,
  removeAutoPublishRealtimeChannel,
  subscribeAutoPublishQueue,
  type AutoPublishQueueItem,
} from "../lib/autoPublish";
import { MerchantSettingsModal, ProductCommerceEditor } from "./CommerceAdmin";
import {
  listProductPublications,
  publicationChannels,
  removePublicationRealtimeChannel,
  saveProductPublication,
  subscribePublications,
  websiteProductUrl,
  hasSalesSiteUrl,
} from "../lib/publications";
import type {
  CommerceProductConfig,
  ProductPublication,
  ProductSummary,
  Profile,
  PublicationChannel,
  PublicationStatus,
} from "../types/product";

type PublishFilter = "todo" | "complete" | "cleanup" | "all";

const visiblePublicationChannels = publicationChannels.filter(
  (channel) => channel.id === "website",
);

function publicationKey(productId: string, channel: PublicationChannel) {
  return `${productId}:${channel}`;
}

function publishedCount(productId: string, publications: ProductPublication[]) {
  return publications.filter(
    (item) =>
      item.productId === productId &&
      item.channel === "website" &&
      item.status === "published",
  ).length;
}

function activeListingCount(
  productId: string,
  publications: ProductPublication[],
) {
  return publications.filter(
    (item) =>
      item.productId === productId &&
      item.channel === "website" &&
      item.status === "published",
  ).length;
}

function channelRecord(
  productId: string,
  channel: PublicationChannel,
  publications: ProductPublication[],
) {
  return publications.find(
    (item) => item.productId === productId && item.channel === channel,
  );
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function money(value: number) {
  return `${new Intl.NumberFormat("th-TH").format(value)} บาท`;
}

function statusLabel(
  status: ProductPublication["status"],
  channel?: PublicationChannel,
) {
  if (status === "published") return channel === "line" ? "ส่งแล้ว" : "ลงแล้ว";
  if (status === "ended") return "ปิดประกาศแล้ว";
  if (status === "expired") return "หมดอายุแล้ว";
  return "ยังไม่ลง";
}

function productStatusLabel(status: ProductSummary["status"]) {
  const labels: Record<ProductSummary["status"], string> = {
    draft: "ร่าง",
    photo_ready: "มีรูปแล้ว",
    ready_to_list: "พร้อมลงขาย",
    published: "กำลังลงขาย",
    reserved: "จองแล้ว",
    sold: "ขายแล้ว",
    repair: "ซ่อม",
    consignment: "ฝากขาย",
    returned: "คืนสินค้า",
    cancelled: "ยกเลิก",
  };
  return labels[status];
}

function publicationState(
  product: ProductSummary,
  publications: ProductPublication[],
) {
  const count = publishedCount(product.id, publications);
  const activeListings = activeListingCount(product.id, publications);
  if (product.status === "sold" && activeListings > 0)
    return "cleanup" as const;
  if (product.status === "sold") return "complete" as const;
  if (count === 0) return "todo" as const;
  if (count === visiblePublicationChannels.length) return "complete" as const;
  return "todo" as const;
}

export function PublishCenter({
  profile,
  products,
  onBack,
  onEdit,
  onProductsRefresh,
}: {
  profile: Profile;
  products: ProductSummary[];
  onBack: () => void;
  onEdit: (product: ProductSummary) => void;
  onProductsRefresh: () => Promise<void> | void;
}) {
  const [publications, setPublications] = useState<ProductPublication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PublishFilter>("todo");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bulkPublishing, setBulkPublishing] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [autoPublishQueue, setAutoPublishQueue] = useState<AutoPublishQueueItem[]>([]);
  const [autoPublishEnabled, setAutoPublishEnabled] = useState(true);
  const [autoPublishDelaySeconds, setAutoPublishDelaySeconds] = useState(180);
  const canManage = ["owner", "admin", "sales"].includes(profile.role);

  const eligible = useMemo(() => {
    const soldWithLiveListing = new Set(
      publications
        .filter(
          (item) =>
            item.status === "published" &&
            item.channel === "website",
        )
        .map((item) => item.productId),
    );
    return products.filter(
      (product) =>
        ["ready_to_list", "published", "reserved"].includes(product.status) ||
        (product.status === "sold" && soldWithLiveListing.has(product.id)),
    );
  }, [products, publications]);

  const bulkReady = useMemo(
    () =>
      eligible.filter(
        (product) =>
          product.status === "ready_to_list" &&
          channelRecord(product.id, "website", publications)?.status !==
            "published",
      ),
    [eligible, publications],
  );

  async function refresh(silent = false) {
    if (!silent) setRefreshing(true);
    try {
      const next = await listProductPublications(
        products.map((product) => product.id),
      );
      setPublications(next);

      try {
        setAutoPublishQueue(
          await listAutoPublishQueue(products.map((product) => product.id)),
        );
      } catch {
        // Backward-compatible while the auto-publish migration is rolling out.
        setAutoPublishQueue([]);
      }

      try {
        const settings = await getCommerceStoreSettings();
        setAutoPublishEnabled(settings.autoPublish?.enabled ?? true);
        setAutoPublishDelaySeconds(settings.autoPublish?.delaySeconds ?? 180);
      } catch {
        // Keep safe defaults; publication status itself is still authoritative.
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function publishAllReady() {
    if (!canManage || bulkPublishing || bulkReady.length === 0) return;
    const total = bulkReady.length;
    if (
      !window.confirm(
        `ยืนยันลงสินค้าที่พร้อมแล้วทั้งหมด ${total} รายการขึ้น AMPHON SHOP หรือไม่?`,
      )
    )
      return;

    setBulkPublishing(true);
    setBulkMessage(null);
    setError(null);
    let succeeded = 0;
    const failures: string[] = [];

    try {
      for (const product of bulkReady) {
        try {
          const commerce = await prepareCommerceProduct(product.id);
          const externalUrl =
            canonicalShopUrl(commerce) ||
            websiteProductUrl(product.sku, commerce.slug);
          if (!externalUrl)
            throw new Error("ยังไม่ได้ตั้งค่า URL ของ AMPHON SHOP");

          await saveProductPublication({
            product,
            profile,
            channel: "website",
            status: "published",
            externalUrl,
            listingRef: product.sku,
          });
          succeeded += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failures.push(`${product.sku}: ${message}`);
        }
      }

      await refresh(true);
      await onProductsRefresh();
      setBulkMessage(`ลงเว็บสำเร็จ ${succeeded}/${total} รายการ`);
      if (failures.length) {
        const preview = failures.slice(0, 3).join(" · ");
        const remaining =
          failures.length > 3 ? ` · และอีก ${failures.length - 3} รายการ` : "";
        setError(
          `มี ${failures.length} รายการที่ลงเว็บไม่สำเร็จ: ${preview}${remaining}`,
        );
      }
    } finally {
      setBulkPublishing(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [products.length]);

  useEffect(() => {
    let timer: number | undefined;
    const scheduleRefresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(true), 350);
    };
    const channel = subscribePublications(scheduleRefresh);
    const autoPublishChannel = subscribeAutoPublishQueue(scheduleRefresh);
    return () => {
      window.clearTimeout(timer);
      if (channel) void removePublicationRealtimeChannel(channel);
      if (autoPublishChannel)
        void removeAutoPublishRealtimeChannel(autoPublishChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const counts = useMemo(() => {
    const result = { todo: 0, complete: 0, cleanup: 0 };
    for (const product of eligible)
      result[publicationState(product, publications)] += 1;
    return result;
  }, [eligible, publications]);

  const autoPublishByProduct = useMemo(
    () => new Map(autoPublishQueue.map((item) => [item.productId, item])),
    [autoPublishQueue],
  );

  const autoPublishCounts = useMemo(
    () => ({
      waiting: autoPublishQueue.filter(
        (item) => item.status === "pending" || item.status === "processing",
      ).length,
      failed: autoPublishQueue.filter((item) => item.status === "failed").length,
    }),
    [autoPublishQueue],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return eligible.filter((product) => {
      const state = publicationState(product, publications);
      if (filter !== "all" && state !== filter) return false;
      if (!q) return true;
      return [
        product.sku,
        product.title,
        product.serialNumber || "",
        product.brand || "",
        product.model || "",
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [eligible, publications, query, filter]);

  const selected = selectedId
    ? (products.find((product) => product.id === selectedId) ?? null)
    : null;

  return (
    <section className="screen page-pad publish-center-screen">
      <header className="topbar">
        <div className="publish-title-row">
          <button className="icon-btn" onClick={onBack}>
            <ChevronLeft />
          </button>
          <div>
            <p className="eyebrow">AMPHON SHOP</p>
            <h1>สินค้าในเว็บไซต์</h1>
          </div>
        </div>
        <div className="publish-header-actions">
          {["owner", "admin"].includes(profile.role) && (
            <button
              className="refresh-button"
              onClick={() => setSettingsOpen(true)}
              aria-label="ตั้งค่า Shop"
            >
              <Settings2 />
            </button>
          )}
          <button
            className="refresh-button"
            onClick={() => void refresh()}
            aria-label="รีเฟรช"
          >
            <RefreshCw className={refreshing ? "spin" : ""} />
          </button>
        </div>
      </header>

      <div className="publish-summary-grid">
        <button
          className={filter === "todo" ? "active" : ""}
          onClick={() => setFilter("todo")}
        >
          <span>รอขึ้นเว็บ</span>
          <b>{counts.todo}</b>
        </button>
        <button
          className={filter === "complete" ? "active" : ""}
          onClick={() => setFilter("complete")}
        >
          <span>ขึ้นเว็บแล้ว</span>
          <b>{counts.complete}</b>
        </button>
        <button
          className={`cleanup ${filter === "cleanup" ? "active" : ""}`}
          onClick={() => setFilter("cleanup")}
        >
          <span>ต้องถอนจากเว็บ</span>
          <b>{counts.cleanup}</b>
        </button>
      </div>

      <div
        className={`auto-publish-banner ${
          autoPublishEnabled ? "enabled" : "disabled"
        }`}
      >
        <div className="auto-publish-copy">
          <strong>
            {autoPublishEnabled
              ? "Auto Publish เปิดอยู่"
              : "Auto Publish ปิดอยู่"}
          </strong>
          <span>
            {autoPublishEnabled
              ? `เมื่อรูป + สเปก + ข้อมูลขายครบ ระบบจะขึ้น AMPHON SHOP อัตโนมัติหลัง ${Math.round(
                  autoPublishDelaySeconds / 60,
                )} นาที`
              : "ระบบจะไม่ลงสินค้าใหม่อัตโนมัติ ใช้ปุ่มลงทั้งหมดด้านล่างแทน"}
          </span>
        </div>
        <div className="auto-publish-stats">
          <span>
            รออัตโนมัติ <b>{autoPublishCounts.waiting}</b>
          </span>
          <span className={autoPublishCounts.failed ? "has-error" : ""}>
            มีปัญหา <b>{autoPublishCounts.failed}</b>
          </span>
        </div>
      </div>

      {canManage && (
        <div className="publish-bulk-panel">
          <button
            className="publish-bulk-button"
            type="button"
            disabled={bulkPublishing || bulkReady.length === 0}
            onClick={() => void publishAllReady()}
          >
            {bulkPublishing ? (
              <LoaderCircle className="spin" />
            ) : (
              <CheckCircle2 />
            )}
            <span>
              <strong>
                {bulkPublishing
                  ? "กำลังลงสินค้าที่พร้อมแล้ว..."
                  : `ลงสินค้าที่พร้อมแล้วทั้งหมด (${bulkReady.length})`}
              </strong>
              <small>
                เฉพาะสินค้าสถานะ “พร้อมลงขาย” ที่ยังไม่ขึ้น AMPHON SHOP
              </small>
            </span>
          </button>
          {bulkMessage && (
            <div className="publish-bulk-message">{bulkMessage}</div>
          )}
        </div>
      )}

      <label className="searchbox publish-search">
        <Search size={18} />
        <input
          value={query}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setQuery(event.target.value)
          }
          placeholder="ค้นหา SKU / รุ่น / Serial"
        />
      </label>
      <div className="publish-filter-line">
        <span>พบ {visible.length} รายการ</span>
        <button onClick={() => setFilter(filter === "all" ? "todo" : "all")}>
          {filter === "all" ? "ดูงานที่ต้องทำ" : "ดูทั้งหมด"}
        </button>
      </div>

      {error && <div className="publish-error">{error}</div>}
      {loading ? (
        <div className="publish-loading">
          <LoaderCircle className="spin" />
          <span>กำลังโหลดสถานะเว็บไซต์</span>
        </div>
      ) : (
        <div className="publish-product-list">
          {visible.map((product) => {
            const count = publishedCount(product.id, publications);
            const state = publicationState(product, publications);
            const cover =
              product.images.find((image) => image.isCover) ||
              product.images[0];
            const autoPublish = autoPublishByProduct.get(product.id);
            return (
              <button
                key={product.id}
                className={`publish-product-card state-${state}`}
                onClick={() => setSelectedId(product.id)}
              >
                <div className="publish-product-main">
                  <div className="publish-thumb">
                    {cover?.publicUrl ? (
                      <img src={cover.publicUrl} alt="" />
                    ) : (
                      <span>IMG</span>
                    )}
                  </div>
                  <div className="publish-product-copy">
                    <strong>{product.title}</strong>
                    <small>
                      {product.sku} · {productStatusLabel(product.status)}
                    </small>
                    <b>
                      {product.price ? money(product.price) : "ยังไม่ตั้งราคา"}
                    </b>
                  </div>
                  <span className="publish-progress">
                    {count}/{visiblePublicationChannels.length}
                  </span>
                </div>
                <div className="publish-channel-dots">
                  {visiblePublicationChannels.map((channel) => {
                    const record = channelRecord(
                      product.id,
                      channel.id,
                      publications,
                    );
                    const status = record?.status ?? "not_published";
                    return (
                      <span
                        key={channel.id}
                        className={`channel-dot status-${status}`}
                        title={`${channel.label}: ${statusLabel(status, channel.id)}`}
                      >
                        {channel.shortLabel}
                      </span>
                    );
                  })}
                </div>
                {autoPublish &&
                  autoPublish.status !== "published" &&
                  autoPublish.status !== "cancelled" && (
                    <div
                      className={`auto-publish-row status-${autoPublish.status}`}
                    >
                      {autoPublish.status === "pending" &&
                        `รอ Auto Publish • หลัง ${formatDate(
                          autoPublish.publishAfter,
                        )}`}
                      {autoPublish.status === "processing" &&
                        "กำลังลงเว็บไซต์อัตโนมัติ..."}
                      {autoPublish.status === "failed" &&
                        `Auto Publish ไม่สำเร็จ • ${
                          autoPublish.lastError || "กดเข้าไปตรวจข้อมูลสินค้า"
                        }`}
                    </div>
                  )}
                {state === "cleanup" && (
                  <div className="cleanup-warning">
                    ขายแล้ว — หน้าเว็บยังเปิดอยู่{" "}
                    {activeListingCount(product.id, publications)} ช่องทาง
                  </div>
                )}
              </button>
            );
          })}
          {!visible.length && (
            <div className="publish-empty">
              <CheckCircle2 />
              <strong>
                {filter === "cleanup"
                  ? "ไม่มีประกาศค้างให้ปิด"
                  : "ไม่มีงานในกลุ่มนี้"}
              </strong>
              <span>สถานะการลงขายจะขึ้นที่นี่อัตโนมัติ</span>
            </div>
          )}
        </div>
      )}

      {settingsOpen && (
        <MerchantSettingsModal
          profile={profile}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {selected && (
        <PublishProductSheet
          profile={profile}
          product={selected}
          publications={publications.filter(
            (item) => item.productId === selected.id,
          )}
          onClose={() => setSelectedId(null)}
          onEdit={() => onEdit(selected)}
          onChanged={async () => {
            await refresh(true);
            await onProductsRefresh();
          }}
        />
      )}
    </section>
  );
}

function PublishProductSheet({
  profile,
  product,
  publications,
  onClose,
  onEdit,
  onChanged,
}: {
  profile: Profile;
  product: ProductSummary;
  publications: ProductPublication[];
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const draft = useMemo(
    () => draftFromProduct(product, profile.id),
    [product, profile.id],
  );
  const [busy, setBusy] = useState<PublicationChannel | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [commerceOpen, setCommerceOpen] = useState(false);
  const [commerceConfig, setCommerceConfig] =
    useState<CommerceProductConfig | null>(null);
  const [urls, setUrls] = useState<Record<PublicationChannel, string>>(
    () =>
      Object.fromEntries(
        publicationChannels.map((channel) => [
          channel.id,
          channelRecord(product.id, channel.id, publications)?.externalUrl ??
            (channel.id === "website"
              ? canonicalShopUrl(commerceConfig) ||
                websiteProductUrl(product.sku, commerceConfig?.slug)
              : ""),
        ]),
      ) as Record<PublicationChannel, string>,
  );
  const canManage = ["owner", "admin", "sales"].includes(profile.role);

  useEffect(() => {
    let cancelled = false;
    void getCommerceProduct(product.id)
      .then((next) => {
        if (!cancelled) setCommerceConfig(next);
      })
      .catch(() => {
        if (!cancelled) setCommerceConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  useEffect(() => {
    setUrls(
      Object.fromEntries(
        publicationChannels.map((channel) => [
          channel.id,
          channelRecord(product.id, channel.id, publications)?.externalUrl ??
            (channel.id === "website"
              ? canonicalShopUrl(commerceConfig) ||
                websiteProductUrl(product.sku, commerceConfig?.slug)
              : ""),
        ]),
      ) as Record<PublicationChannel, string>,
    );
  }, [product.id, product.sku, publications, commerceConfig?.slug]);

  async function copyChannel(channel: PublicationChannel) {
    try {
      if (channel === "website") {
        const url =
          canonicalShopUrl(commerceConfig) ||
          websiteProductUrl(product.sku, commerceConfig?.slug);
        if (!url) throw new Error("ยังไม่ได้ตั้งค่า VITE_SALES_SITE_URL");
        await copyText(url);
        setMessage("ก๊อป URL หน้าสินค้าแล้ว");
        return;
      }
      throw new Error("หน้านี้จัดการเฉพาะ AMPHON SHOP / Website");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function change(
    channel: PublicationChannel,
    status: PublicationStatus,
  ) {
    if (!canManage || busy) return;
    const meta = publicationChannels.find((item) => item.id === channel);
    const action =
      channel === "website"
        ? status === "published"
          ? "เผยแพร่สินค้าขึ้นเว็บไซต์"
          : status === "ended"
            ? "ถอนสินค้าจากเว็บไซต์"
            : status === "expired"
              ? "บันทึกว่าสถานะเว็บไซต์หมดอายุ"
              : "ล้างสถานะเว็บไซต์"
        : status === "published"
          ? `บันทึกว่า “ลง ${meta?.label} แล้ว”`
          : status === "ended"
            ? `ปิดประกาศ ${meta?.label}`
            : status === "expired"
              ? `บันทึกว่าประกาศ ${meta?.label} หมดอายุ`
              : `ล้างสถานะ ${meta?.label}`;
    if (
      status !== "published" &&
      !window.confirm(`ยืนยัน${action} สำหรับ ${product.sku} หรือไม่?`)
    )
      return;
    setBusy(channel);
    setMessage(null);
    try {
      let nextCommerce = commerceConfig;
      if (channel === "website" && status === "published") {
        nextCommerce = await prepareCommerceProduct(product.id);
        setCommerceConfig(nextCommerce);
      }
      await saveProductPublication({
        product,
        profile,
        channel,
        status,
        externalUrl:
          channel === "website"
            ? canonicalShopUrl(nextCommerce) ||
              websiteProductUrl(product.sku, nextCommerce?.slug)
            : urls[channel],
        listingRef: channel === "website" ? product.sku : undefined,
      });
      if (channel === "website") {
        try {
          setCommerceConfig(await getCommerceProduct(product.id));
        } catch {
          /* publication itself already succeeded */
        }
      }
      setMessage(`${action}เรียบร้อย`);
      await onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveLink(channel: PublicationChannel) {
    const current = channelRecord(product.id, channel, publications);
    if (!current) return;
    setBusy(channel);
    setMessage(null);
    try {
      await saveProductPublication({
        product,
        profile,
        channel,
        status: current.status,
        externalUrl: urls[channel],
      });
      setMessage("บันทึก URL แล้ว");
      await onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const activeCount = activeListingCount(product.id, publications);

  return (
    <div className="modal-backdrop publish-sheet-backdrop">
      <div className="modal-sheet publish-sheet">
        <div className="modal-head publish-sheet-head">
          <div>
            <p className="eyebrow">PUBLISH WORKFLOW</p>
            <h2>{product.title}</h2>
            <small>
              {product.sku} · {productStatusLabel(product.status)}
            </small>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="publish-sheet-overview">
          <div>
            <span>สถานะบนเว็บไซต์</span>
            <b>
              {activeCount}/
              {
                visiblePublicationChannels.filter(
                  (channel) => channel.persistentListing,
                ).length
              }
            </b>
          </div>
          <div>
            <span>ราคาขาย</span>
            <b>{product.price ? money(product.price) : "-"}</b>
          </div>
        </div>
        <ProductImageExportActions draft={draft} compact />
        <div className="publish-sheet-tools">
          <button onClick={onEdit}>
            <FileText size={17} />
            แก้สินค้า/คอนเทนต์
          </button>
        </div>
        {!hasSalesSiteUrl() && (
          <div className="publish-error">
            Website API พร้อมใช้งาน แต่ยังไม่ได้ตั้ง{" "}
            <code>VITE_SALES_SITE_URL</code> สำหรับลิงก์หน้าสินค้า
          </div>
        )}
        {product.status === "sold" && activeCount > 0 && (
          <div className="cleanup-banner">
            สินค้าขายแล้ว กรุณาถอนรายการออกจากเว็บไซต์
          </div>
        )}
        {message && <div className="publish-message">{message}</div>}

        <div className="channel-workflow-list">
          {visiblePublicationChannels.map((channel) => {
            const record = channelRecord(product.id, channel.id, publications);
            const status = record?.status ?? "not_published";
            const isBusy = busy === channel.id;
            return (
              <section
                className={`channel-workflow-card status-${status}`}
                key={channel.id}
              >
                <div className="channel-workflow-head">
                  <div className="channel-name">
                    <span>{channel.emoji}</span>
                    <div>
                      <strong>{channel.label}</strong>
                      <small>{channel.description}</small>
                    </div>
                  </div>
                  <span className={`publication-badge status-${status}`}>
                    {statusLabel(status, channel.id)}
                  </span>
                </div>
                {record?.publishedAt && (
                  <div className="publication-meta">
                    <span>
                      {channel.id === "line" ? "ส่งโดย" : "ลงโดย"}{" "}
                      {record.publishedByName || "พนักงาน"}
                    </span>
                    <span>{formatDate(record.publishedAt)}</span>
                  </div>
                )}
                {record?.endedAt &&
                  (status === "ended" || status === "expired") && (
                    <div className="publication-meta ended">
                      <span>
                        {status === "expired" ? "หมดอายุโดย" : "ปิดโดย"}{" "}
                        {record.endedByName || "พนักงาน"}
                      </span>
                      <span>{formatDate(record.endedAt)}</span>
                    </div>
                  )}
                {channel.id === "website" ? (
                  <div className="website-integration-box">
                    <div>
                      <strong>Store API Sync</strong>
                      <small>
                        ราคา รูป สเปก และสถานะดึงจาก Product Master โดยตรง
                      </small>
                    </div>
                    <code>
                      {canonicalShopUrl(commerceConfig) ||
                        websiteProductUrl(product.sku, commerceConfig?.slug) ||
                        "ระบบจะสร้าง Canonical URL เมื่อ Prepare Commerce"}
                    </code>
                    {canManage ? (
                      <button
                        className="commerce-config-button"
                        onClick={() => setCommerceOpen(true)}
                      >
                        <Settings2 size={16} />
                        ตั้งค่า SEO / Taxonomy / Merchant
                      </button>
                    ) : (
                      <div className="publish-readonly">
                        Technician ดู URL และสถานะได้ แต่แก้ Commerce metadata
                        ไม่ได้
                      </div>
                    )}
                  </div>
                ) : channel.supportsExternalUrl ? (
                  <div className="publication-url-row">
                    <input
                      value={urls[channel.id]}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setUrls((current) => ({
                          ...current,
                          [channel.id]: event.target.value,
                        }))
                      }
                      placeholder="URL ประกาศ (ใส่ภายหลังได้)"
                      inputMode="url"
                    />
                    {record &&
                      urls[channel.id] !== (record.externalUrl ?? "") && (
                        <button
                          onClick={() => void saveLink(channel.id)}
                          disabled={isBusy}
                        >
                          บันทึก
                        </button>
                      )}
                  </div>
                ) : (
                  <div className="publish-readonly">
                    LINE บันทึกเวลาและพนักงานผู้ยืนยัน
                    โดยไม่เก็บลิงก์หรือส่งข้อความอัตโนมัติ
                  </div>
                )}
                <div className="channel-action-row">
                  <button
                    className="channel-copy"
                    onClick={() => void copyChannel(channel.id)}
                  >
                    <ClipboardCopy size={16} />
                    {channel.id === "website"
                      ? "ก๊อป URL สินค้า"
                      : "ก๊อปคอนเทนต์"}
                  </button>
                  {(channel.id === "website"
                    ? canonicalShopUrl(commerceConfig) ||
                      websiteProductUrl(product.sku, commerceConfig?.slug)
                    : record?.externalUrl) && (
                    <button
                      className="channel-open"
                      onClick={() =>
                        window.open(
                          channel.id === "website"
                            ? canonicalShopUrl(commerceConfig) ||
                                websiteProductUrl(
                                  product.sku,
                                  commerceConfig?.slug,
                                )
                            : record?.externalUrl,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      <ExternalLink size={16} />
                      {channel.id === "website"
                        ? "เปิดหน้าสินค้า"
                        : "เปิดประกาศ"}
                    </button>
                  )}
                </div>
                {canManage ? (
                  <div className="publication-state-actions">
                    {status === "not_published" &&
                      product.status !== "sold" && (
                        <button
                          className="mark-published"
                          onClick={() => void change(channel.id, "published")}
                          disabled={busy !== null}
                        >
                          {isBusy ? (
                            <LoaderCircle className="spin" size={16} />
                          ) : (
                            <CheckCircle2 size={16} />
                          )}{" "}
                          {channel.id === "website"
                            ? "เผยแพร่ขึ้นเว็บไซต์"
                            : channel.id === "line"
                              ? "บันทึกว่าส่งแล้ว"
                              : "บันทึกว่าลงแล้ว"}
                        </button>
                      )}
                    {status === "published" && channel.persistentListing && (
                      <button
                        className={
                          product.status === "sold"
                            ? "mark-ended urgent"
                            : "mark-ended"
                        }
                        onClick={() => void change(channel.id, "ended")}
                        disabled={busy !== null}
                      >
                        {isBusy ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : null}
                        {channel.id === "website"
                          ? "ถอนจากเว็บไซต์"
                          : product.status === "sold"
                            ? "ปิดประกาศแล้ว"
                            : "ปิด/ยุติประกาศ"}
                      </button>
                    )}
                    {status === "published" &&
                      channel.id === "line" &&
                      product.status !== "sold" && (
                        <button
                          className="mark-published"
                          onClick={() => void change(channel.id, "published")}
                          disabled={busy !== null}
                        >
                          บันทึกว่าส่งอีกครั้ง
                        </button>
                      )}
                    {status === "published" &&
                      channel.persistentListing &&
                      channel.id !== "website" && (
                        <button
                          className="clear-publication"
                          onClick={() => void change(channel.id, "expired")}
                          disabled={busy !== null}
                        >
                          หมดอายุแล้ว
                        </button>
                      )}
                    {(status === "ended" || status === "expired") &&
                      product.status !== "sold" && (
                        <button
                          className="mark-published"
                          onClick={() => void change(channel.id, "published")}
                          disabled={busy !== null}
                        >
                          กลับมาลงอีกครั้ง
                        </button>
                      )}
                  </div>
                ) : (
                  <div className="publish-readonly">
                    Technician ดูสถานะได้ แต่เปลี่ยนสถานะการลงขายไม่ได้
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <p className="publish-sheet-note">
          หน้านี้ดูแลเฉพาะ AMPHON SHOP / Website เท่านั้น
          ส่วน Facebook, Marketplace และ LINE ใช้เครื่องมือเตรียมคอนเทนต์ในหน้าสินค้าโดยไม่ติดตามสถานะการโพสต์
        </p>
        {commerceOpen && (
          <ProductCommerceEditor
            profile={profile}
            product={product}
            onClose={() => setCommerceOpen(false)}
            onSaved={(next) => {
              setCommerceConfig(next);
              setUrls((current) => ({
                ...current,
                website:
                  canonicalShopUrl(next) ||
                  websiteProductUrl(product.sku, next.slug),
              }));
            }}
          />
        )}
      </div>
    </div>
  );
}
