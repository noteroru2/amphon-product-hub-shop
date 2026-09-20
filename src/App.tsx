import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Camera,
  ClipboardCopy,
  Download,
  FileText,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Home,
  LoaderCircle,
  LogOut,
  Package,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
  UserPlus,
  Users,
  KeyRound,
  ShieldCheck,
  Power,
  Copy,
  CheckCircle2,
  WifiOff,
  X,
  QrCode,
  ScanLine,
  Printer,
  ShoppingCart,
  ShoppingBag,
  Pencil,
  CalendarDays,
  ImageDown,
} from "lucide-react";
import { db } from "./lib/db";
import { compressImage } from "./lib/image";
import { isBackendConfigured, supabase } from "./lib/supabase";
import { buildSpecText, copyText } from "./lib/sales";
import {
  buildContentForChannel,
  buildShopeeContentParts,
  contentTemplates,
  type ContentChannel,
} from "./lib/contentTemplates";
import {
  downloadDataUrl,
  findProductByScannedValue,
  generateProductCodeImages,
  type ProductCodeImages,
} from "./lib/qr";
import { PublishCenter } from "./components/PublishCenter";
import { ProductImageExportControls } from "./components/ProductImageExportActions";
import { useProductImageExport } from "./hooks/useProductImageExport";
import { OrderManagement } from "./components/OrderManagement";
import {
  getCategoryDefinition,
  getCompleteness,
  getImageRoles,
  getSmartFields,
  productSchemas,
  type SmartFieldDefinition,
} from "./lib/productSchemas";
import {
  allowedStatuses,
  createEmployee,
  deleteProduct,
  draftFromProduct,
  findDuplicateIdentifier,
  listEmployeeActivity,
  listEmployees,
  listProductActivity,
  listProducts,
  loadProfile,
  quickChangeProductStatus,
  removeRealtimeChannel,
  resetEmployeePassword,
  saveProduct,
  subscribeInventory,
  updateEmployee,
} from "./lib/backend";

const SalesPostPackagePanel = lazy(
  () => import("./components/SalesPostPackagePanel"),
);
const MarketplaceListingAssistant = lazy(
  () => import("./components/MarketplaceListingAssistant"),
);
const ShopeeListingAssistant = lazy(
  () => import("./components/ShopeeListingAssistant"),
);
import type {
  DuplicateIdentifierMatch,
  EmployeeActivity,
  EmployeeSummary,
  ProductActivity,
  ProductCategory,
  ProductDraft,
  ProductImageDraft,
  ProductStatus,
  ProductSummary,
  Profile,
  UploadQueueItem,
} from "./types/product";

type Tab =
  | "home"
  | "products"
  | "publish"
  | "orders"
  | "add"
  | "scanner"
  | "profile"
  | "employees";
type StatusFilter = "all" | "ready_to_list" | "reserved";

const categories = productSchemas.map(({ key, label, icon }) => ({
  key,
  label,
  icon,
}));

const emptyDraft = (ownerUserId?: string): ProductDraft => ({
  localId: crypto.randomUUID(),
  ownerUserId,
  specs: {},
  status: "draft",
  images: [],
  deletedRemoteImages: [],
  currentStep: 1,
  updatedAt: Date.now(),
});

function hydrateDraft(draft: ProductDraft): ProductDraft {
  return {
    ...draft,
    images: draft.images.map((image) => ({
      ...image,
      previewUrl:
        image.blob && !image.remoteImageId
          ? URL.createObjectURL(image.blob)
          : image.publicUrl || image.previewUrl,
    })),
  };
}

function baht(value: number) {
  return new Intl.NumberFormat("th-TH").format(value) + " บาท";
}

function productSubtitle(product: ProductSummary) {
  const specs = product.specs || {};
  const preferred = ["cpu", "ram", "ssd", "gpu", "storage", "color", "battery"]
    .map((key) => specs[key])
    .filter(Boolean)
    .slice(0, 4);
  return preferred.length
    ? preferred.join(" · ")
    : [product.brand, product.model].filter(Boolean).join(" · ");
}

function initials(name: string) {
  const clean = name.trim();
  if (!clean) return "AT";
  return clean.slice(0, 2).toUpperCase();
}

function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [online, setOnline] = useState(navigator.onLine);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isBackendConfigured);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [localDrafts, setLocalDrafts] = useState<ProductDraft[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicateMatch, setDuplicateMatch] =
    useState<DuplicateIdentifierMatch | null>(null);
  const [duplicateChecking, setDuplicateChecking] = useState(false);
  const [activity, setActivity] = useState<ProductActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const saveLock = useRef(false);
  const deepLinkHandled = useRef(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth
      .getSession()
      .then(
        ({
          data,
          error,
        }: {
          data: { session: Session | null };
          error: { message: string } | null;
        }) => {
          if (!active) return;
          if (error) setBackendError(error.message);
          setSession(data.session);
          setAuthReady(true);
        },
      );
    const { data } = supabase.auth.onAuthStateChange(
      (_event: string, nextSession: Session | null) => {
        setSession(nextSession);
        setAuthReady(true);
        if (!nextSession) {
          setProfile(null);
          setProducts([]);
          setLocalDrafts([]);
        }
      },
    );
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  async function refreshInventory(currentProfile = profile) {
    if (!currentProfile) return;
    setLoadingProducts(true);
    try {
      const next = await listProducts(currentProfile.role);
      setProducts(next);
      setBackendError(null);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingProducts(false);
    }
  }

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const nextProfile = await loadProfile(session.user.id);
        if (cancelled) return;
        setProfile(nextProfile);
        if (!nextProfile.active) {
          setBackendError("บัญชีนี้ถูกปิดการใช้งาน");
          return;
        }
        const [nextProducts, deviceDrafts] = await Promise.all([
          listProducts(nextProfile.role),
          db.drafts.toArray(),
        ]);
        if (cancelled) return;
        setProducts(nextProducts);
        const typedDrafts = deviceDrafts as ProductDraft[];
        setLocalDrafts(
          typedDrafts
            .filter((item) => item.ownerUserId === nextProfile.id)
            .sort((a, b) => b.updatedAt - a.updatedAt),
        );
        setBackendError(null);
      } catch (error) {
        if (!cancelled)
          setBackendError(
            error instanceof Error ? error.message : String(error),
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session || !profile?.active) return;
    let refreshTimer: number | undefined;
    const channel = subscribeInventory(() => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(
        () => void refreshInventory(profile),
        450,
      );
    });
    return () => {
      window.clearTimeout(refreshTimer);
      if (channel) void removeRealtimeChannel(channel);
    };
    // profile identity/role is enough to rebuild the channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, profile?.id, profile?.role, profile?.active]);

  useEffect(() => {
    if (tab !== "add") return;
    const t = setTimeout(async () => {
      const next = { ...draft, updatedAt: Date.now() };
      await db.drafts.put(next);
      setSavedAt(next.updatedAt);
      setLocalDrafts((current) =>
        [next, ...current.filter((item) => item.localId !== next.localId)].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        ),
      );
    }, 350);
    return () => clearTimeout(t);
  }, [draft, tab]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (tab !== "add" || !profile || !online) {
      setDuplicateMatch(null);
      setDuplicateChecking(false);
      return;
    }
    const identifier = draft.serialNumber?.trim() ?? "";
    if (identifier.length < 5) {
      setDuplicateMatch(null);
      setDuplicateChecking(false);
      return;
    }
    let cancelled = false;
    setDuplicateChecking(true);
    const timer = window.setTimeout(() => {
      void findDuplicateIdentifier(identifier, draft.remoteProductId)
        .then((match) => {
          if (!cancelled) setDuplicateMatch(match);
        })
        .catch(() => {
          if (!cancelled) setDuplicateMatch(null);
        })
        .finally(() => {
          if (!cancelled) setDuplicateChecking(false);
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draft.serialNumber, draft.remoteProductId, online, profile?.id, tab]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchStatus =
        statusFilter === "all" || product.status === statusFilter;
      if (!matchStatus) return false;
      if (!q) return true;
      return [
        product.title,
        product.sku,
        product.serialNumber || "",
        product.brand || "",
        product.model || "",
        productSubtitle(product),
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [products, query, statusFilter]);

  const openAdd = () => {
    setDraft(emptyDraft(profile?.id));
    setSavedAt(null);
    setUploadQueue([]);
    setDuplicateMatch(null);
    setActivity([]);
    setActivityLoading(false);
    setBackendError(null);
    setTab("add");
  };

  const openEdit = (product: ProductSummary) => {
    setDraft(draftFromProduct(product, profile?.id));
    setSavedAt(null);
    setUploadQueue([]);
    setDuplicateMatch(null);
    setActivity([]);
    setActivityLoading(false);
    setBackendError(null);
    setTab("add");
    if (profile && ["owner", "admin"].includes(profile.role)) {
      setActivityLoading(true);
      void listProductActivity(product.id)
        .then(setActivity)
        .catch(() => setActivity([]))
        .finally(() => setActivityLoading(false));
    }
  };

  useEffect(() => {
    if (deepLinkHandled.current || !profile || products.length === 0) return;
    const sku = new URLSearchParams(window.location.search).get("sku");
    if (!sku) {
      deepLinkHandled.current = true;
      return;
    }
    const product = findProductByScannedValue(products, sku);
    deepLinkHandled.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    if (product) {
      openEdit(product);
      setNotice(`เปิด ${product.sku} จาก QR แล้ว`);
    } else {
      setNotice(`ไม่พบสินค้า ${sku}`);
      setTab("scanner");
    }
    // Run once after inventory is available for an authenticated employee.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, products.length]);

  const resumeDraft = (savedDraft: ProductDraft) => {
    setDraft(hydrateDraft(savedDraft));
    setSavedAt(savedDraft.updatedAt);
    setUploadQueue([]);
    setDuplicateMatch(null);
    setActivity([]);
    setActivityLoading(false);
    setBackendError(null);
    setTab("add");
  };

  const update = (patch: Partial<ProductDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    const items: ProductImageDraft[] = [];
    for (const file of Array.from(files).slice(0, 20 - draft.images.length)) {
      const blob = await compressImage(file);
      items.push({
        id: crypto.randomUUID(),
        name: file.name,
        blob,
        previewUrl: URL.createObjectURL(blob),
        isCover: draft.images.length === 0 && items.length === 0,
        imageRole:
          draft.images.length === 0 && items.length === 0 ? "cover" : "other",
        order: draft.images.length + items.length,
      });
    }
    update({ images: [...draft.images, ...items] });
  }

  function removeImage(imageId: string) {
    setDraft((current) => {
      const target = current.images.find((image) => image.id === imageId);
      if (!target) return current;
      if (target.previewUrl?.startsWith("blob:"))
        URL.revokeObjectURL(target.previewUrl);
      let images = current.images
        .filter((image) => image.id !== imageId)
        .map((image, index) => ({ ...image, order: index }));
      if (target.isCover && images.length)
        images = images.map((image, index) => ({
          ...image,
          isCover: index === 0,
        }));
      const deletedRemoteImages =
        target.remoteImageId && target.objectKey
          ? [
              ...(current.deletedRemoteImages ?? []),
              { id: target.remoteImageId, objectKey: target.objectKey },
            ]
          : current.deletedRemoteImages;
      return { ...current, images, deletedRemoteImages, updatedAt: Date.now() };
    });
  }

  function setCover(imageId: string) {
    update({
      images: draft.images.map((image) => ({
        ...image,
        isCover: image.id === imageId,
        imageRole:
          image.id === imageId
            ? "cover"
            : image.isCover && image.imageRole === "cover"
              ? "other"
              : image.imageRole,
      })),
    });
  }

  function setImageRole(imageId: string, imageRole: string) {
    update({
      images: draft.images.map((image) =>
        image.id === imageId ? { ...image, imageRole } : image,
      ),
    });
  }

  async function persistRemoteCreated(productId: string, sku: string) {
    setDraft((current) => {
      const next = {
        ...current,
        remoteProductId: productId,
        sku,
        originalStatus: current.originalStatus ?? "draft",
        updatedAt: Date.now(),
      };
      void db.drafts.put(next);
      return next;
    });
  }

  async function persistUploadedImage(
    imageId: string,
    remote: { remoteImageId: string; objectKey: string; publicUrl?: string },
  ) {
    setDraft((current) => {
      const target = current.images.find((image) => image.id === imageId);
      if (target?.previewUrl?.startsWith("blob:"))
        URL.revokeObjectURL(target.previewUrl);
      const next = {
        ...current,
        images: current.images.map((image) =>
          image.id === imageId
            ? {
                ...image,
                blob: undefined,
                remoteImageId: remote.remoteImageId,
                objectKey: remote.objectKey,
                publicUrl: remote.publicUrl,
                previewUrl: remote.publicUrl || image.previewUrl,
              }
            : image,
        ),
        updatedAt: Date.now(),
      };
      void db.drafts.put(next);
      return next;
    });
  }

  async function saveCurrentDraft() {
    if (!profile || saving || saveLock.current) return;
    if (!online) {
      setBackendError(
        "ตอนนี้ออฟไลน์ ร่างยังอยู่ในเครื่อง แต่ต้องต่ออินเทอร์เน็ตก่อนบันทึกขึ้นระบบกลาง",
      );
      return;
    }
    if (duplicateMatch) {
      setBackendError(
        `Serial / IMEI ซ้ำกับ ${duplicateMatch.sku} — ${duplicateMatch.title} กรุณาตรวจสอบก่อนบันทึก`,
      );
      return;
    }

    const originalStatus = draft.originalStatus;
    if (
      originalStatus &&
      originalStatus !== draft.status &&
      ["sold", "returned", "cancelled"].includes(draft.status)
    ) {
      const labels: Record<string, string> = {
        sold: "ขายแล้ว",
        returned: "คืนสินค้า",
        cancelled: "ยกเลิก",
      };
      if (
        !window.confirm(
          `ยืนยันเปลี่ยนสถานะ ${draft.sku || "สินค้านี้"} เป็น “${labels[draft.status]}” หรือไม่?`,
        )
      )
        return;
    }

    saveLock.current = true;
    setSaving(true);
    setBackendError(null);
    setUploadQueue(
      draft.images
        .filter((image) => image.blob && !image.remoteImageId)
        .map((image) => ({
          imageId: image.id,
          filename: image.name,
          state: "waiting",
        })),
    );
    try {
      const saved = await saveProduct(draft, profile, {
        onRemoteCreated: persistRemoteCreated,
        onUploadStart: (imageId) =>
          setUploadQueue((queue) =>
            queue.map((item) =>
              item.imageId === imageId
                ? { ...item, state: "uploading", error: undefined }
                : item,
            ),
          ),
        onUploadDone: async (imageId, remote) => {
          await persistUploadedImage(imageId, remote);
          setUploadQueue((queue) =>
            queue.map((item) =>
              item.imageId === imageId
                ? { ...item, state: "done", error: undefined }
                : item,
            ),
          );
        },
        onUploadError: (imageId, message) =>
          setUploadQueue((queue) =>
            queue.map((item) =>
              item.imageId === imageId
                ? { ...item, state: "error", error: message }
                : item,
            ),
          ),
      });
      await db.drafts.delete(draft.localId);
      setLocalDrafts((current) =>
        current.filter((item) => item.localId !== draft.localId),
      );
      setProducts((current) => [
        saved,
        ...current.filter((product) => product.id !== saved.id),
      ]);
      setNotice(`บันทึก ${saved.sku} เรียบร้อย`);
      setTab("products");
      setDraft(emptyDraft(profile.id));
      setUploadQueue([]);
      setDuplicateMatch(null);
      void refreshInventory(profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBackendError(
        message.includes("DUPLICATE_ACTIVE_IDENTIFIER")
          ? "Serial / IMEI นี้มีอยู่ในสต๊อกแล้ว กรุณาค้นหาและตรวจสอบสินค้ารายการเดิม"
          : message,
      );
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function removeCurrentProduct() {
    if (
      !profile ||
      !draft.remoteProductId ||
      !["owner", "admin"].includes(profile.role)
    )
      return;
    const product = products.find((item) => item.id === draft.remoteProductId);
    if (!product) return;
    if (
      !window.confirm(
        `ลบ ${product.sku} — ${product.title} ออกจากระบบถาวรหรือไม่?`,
      )
    )
      return;
    setSaving(true);
    setBackendError(null);
    try {
      await deleteProduct(product);
      await db.drafts.delete(draft.localId);
      setLocalDrafts((current) =>
        current.filter((item) => item.localId !== draft.localId),
      );
      setProducts((current) =>
        current.filter((item) => item.id !== product.id),
      );
      setNotice(`ลบ ${product.sku} แล้ว`);
      setTab("products");
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function quickStatusCurrent(nextStatus: ProductStatus) {
    if (!profile || !draft.remoteProductId || saving) return;
    const product = products.find((item) => item.id === draft.remoteProductId);
    if (!product) return;
    const actionLabel =
      nextStatus === "reserved"
        ? "จองสินค้า"
        : nextStatus === "sold"
          ? "ขายสินค้า"
          : `เปลี่ยนเป็น ${statusText(nextStatus)}`;
    if (
      !window.confirm(
        `ยืนยัน${actionLabel} ${product.sku} — ${product.title} หรือไม่?`,
      )
    )
      return;
    setSaving(true);
    setBackendError(null);
    try {
      const saved = await quickChangeProductStatus(
        product.id,
        nextStatus,
        profile,
      );
      setProducts((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
      setDraft(draftFromProduct(saved, profile.id));
      setNotice(`${saved.sku} → ${statusText(nextStatus)} แล้ว`);
      if (["owner", "admin"].includes(profile.role)) {
        void listProductActivity(saved.id)
          .then(setActivity)
          .catch(() => setActivity([]));
      }
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  if (!isBackendConfigured) return <SetupRequired />;
  if (!authReady) return <LoadingScreen label="กำลังตรวจสอบการเข้าสู่ระบบ" />;
  if (!session) return <LoginScreen />;
  if (session.user.user_metadata?.must_change_password === true)
    return <ForcePasswordChangeScreen session={session} />;
  if (!profile && !backendError)
    return <LoadingScreen label="กำลังโหลดสิทธิ์พนักงาน" />;

  return (
    <div className="app-shell">
      {!online && (
        <div className="offline">
          <WifiOff size={16} /> ออฟไลน์ — ร่างยังบันทึกในเครื่องได้
        </div>
      )}
      {notice && <div className="toast">{notice}</div>}
      <main className="phone-frame">
        {backendError && tab !== "add" && (
          <InlineError
            message={backendError}
            onRetry={() => void refreshInventory(profile)}
          />
        )}
        {tab === "home" && profile && (
          <HomeScreen
            profile={profile}
            products={products}
            drafts={localDrafts}
            loading={loadingProducts}
            onAdd={openAdd}
            onResume={resumeDraft}
            onProducts={() => setTab("products")}
            onPublish={() => setTab("publish")}
            onOrders={() => setTab("orders")}
            onEdit={openEdit}
          />
        )}
        {tab === "products" && (
          <ProductsScreen
            query={query}
            setQuery={setQuery}
            products={filtered}
            loading={loadingProducts}
            filter={statusFilter}
            setFilter={setStatusFilter}
            onEdit={openEdit}
            onRefresh={() => void refreshInventory(profile)}
            onScan={() => setTab("scanner")}
            onPublish={() => setTab("publish")}
          />
        )}
        {tab === "publish" && profile && (
          <PublishCenter
            profile={profile}
            products={products}
            onBack={() => setTab("home")}
            onEdit={openEdit}
            onProductsRefresh={() => refreshInventory(profile)}
          />
        )}
        {tab === "orders" &&
          profile &&
          ["owner", "admin", "sales"].includes(profile.role) && (
            <OrderManagement profile={profile} onBack={() => setTab("home")} />
          )}
        {tab === "scanner" && (
          <ScannerScreen products={products} onOpen={openEdit} />
        )}
        {tab === "add" && profile && (
          <AddProduct
            draft={draft}
            profile={profile}
            update={update}
            addImages={addImages}
            removeImage={removeImage}
            setCover={setCover}
            setImageRole={setImageRole}
            savedAt={savedAt}
            saving={saving}
            uploadQueue={uploadQueue}
            error={backendError}
            duplicateMatch={duplicateMatch}
            duplicateChecking={duplicateChecking}
            activity={activity}
            activityLoading={activityLoading}
            onSave={() => void saveCurrentDraft()}
            onDelete={() => void removeCurrentProduct()}
            onQuickStatus={(status) => void quickStatusCurrent(status)}
            onClose={() => setTab("home")}
          />
        )}
        {tab === "profile" && profile && (
          <ProfileScreen
            profile={profile}
            onEmployees={() => setTab("employees")}
            onSignOut={() => void supabase?.auth.signOut()}
          />
        )}
        {tab === "employees" &&
          profile &&
          ["owner", "admin"].includes(profile.role) && (
            <EmployeeManagementScreen
              profile={profile}
              onBack={() => setTab("profile")}
            />
          )}
      </main>
      {tab !== "add" && tab !== "employees" && (
        <BottomNav tab={tab} setTab={setTab} onAdd={openAdd} />
      )}
    </div>
  );
}

function SetupRequired() {
  return (
    <div className="center-screen">
      <div className="auth-card">
        <p className="eyebrow">AMPHON PRODUCT HUB</p>
        <h1>ยังไม่ได้เชื่อม Backend</h1>
        <p>
          คัดลอก <code>.env.example</code> เป็น <code>.env</code> แล้วใส่
          Supabase URL, Publishable Key และ URL ของ R2 Worker จากนั้นรันใหม่
        </p>
        <div className="setup-code">
          VITE_SUPABASE_URL=...
          <br />
          VITE_SUPABASE_PUBLISHABLE_KEY=...
          <br />
          VITE_R2_UPLOAD_API=...
        </div>
      </div>
    </div>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="center-screen">
      <div className="loading-block">
        <LoaderCircle className="spin" />
        <strong>{label}</strong>
      </div>
    </div>
  );
}

function LoginScreen() {
  const allowSignup =
    String(import.meta.env.VITE_ALLOW_SIGNUP).toLowerCase() === "true";
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: displayName.trim() || email.split("@")[0] },
          },
        });
        if (error) throw error;
        if (!data.session)
          setMessage("สร้างบัญชีแล้ว กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen auth-bg">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-mark">AT</div>
        <p className="eyebrow">AMPHON TRADING</p>
        <h1>
          {mode === "login" ? "เข้าสู่ Product Hub" : "สร้างบัญชีพนักงาน"}
        </h1>
        <p>ระบบสินค้าและรูปภาพกลางสำหรับมือถือ</p>
        {mode === "signup" && (
          <Field
            label="ชื่อพนักงาน"
            value={displayName}
            onChange={setDisplayName}
            placeholder="เช่น โน๊ต"
          />
        )}
        <Field
          label="อีเมล"
          value={email}
          onChange={setEmail}
          placeholder="name@example.com"
          inputMode="email"
        />
        <label className="field">
          <span>รหัสผ่าน</span>
          <input
            type="password"
            value={password}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setPassword(event.target.value)
            }
            placeholder="อย่างน้อย 6 ตัวอักษร"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
          />
        </label>
        {message && <div className="auth-message">{message}</div>}
        <button
          className="primary-wide"
          disabled={busy || !email || password.length < 6}
        >
          {busy ? (
            <>
              <LoaderCircle className="spin" size={18} /> กำลังดำเนินการ
            </>
          ) : mode === "login" ? (
            "เข้าสู่ระบบ"
          ) : (
            "สร้างบัญชี"
          )}
        </button>
        {allowSignup && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setMessage(null);
            }}
          >
            {mode === "login"
              ? "สร้างบัญชีสำหรับตั้งค่าครั้งแรก"
              : "มีบัญชีแล้ว — เข้าสู่ระบบ"}
          </button>
        )}
      </form>
    </div>
  );
}

function ForcePasswordChangeScreen({ session }: { session: Session }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || busy) return;
    if (password.length < 10)
      return setMessage("รหัสผ่านใหม่ต้องอย่างน้อย 10 ตัวอักษร");
    if (password !== confirm) return setMessage("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
    setBusy(true);
    setMessage(null);
    try {
      const metadata = {
        ...(session.user.user_metadata || {}),
        must_change_password: false,
      };
      const { error } = await supabase.auth.updateUser({
        password,
        data: metadata,
      });
      if (error) throw error;
      await supabase.auth.refreshSession();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="center-screen auth-bg">
      <form className="auth-card" onSubmit={save}>
        <div className="brand-mark">AT</div>
        <p className="eyebrow">SECURITY</p>
        <h1>ตั้งรหัสผ่านใหม่</h1>
        <p>
          บัญชีนี้กำลังใช้รหัสผ่านชั่วคราว กรุณาตั้งรหัสส่วนตัวก่อนใช้งาน
          Product Hub
        </p>
        <label className="field">
          <span>รหัสผ่านใหม่</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label className="field">
          <span>ยืนยันรหัสผ่าน</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {message && <div className="auth-message">{message}</div>}
        <button
          className="primary-wide"
          disabled={busy || password.length < 10 || confirm.length < 10}
        >
          {busy ? (
            <>
              <LoaderCircle className="spin" size={18} /> กำลังบันทึก
            </>
          ) : (
            "ตั้งรหัสผ่านและเข้าใช้งาน"
          )}
        </button>
      </form>
    </div>
  );
}
function InlineError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="inline-error">
      <span>{message}</span>
      <button onClick={onRetry}>
        <RefreshCw size={15} /> ลองใหม่
      </button>
    </div>
  );
}

function HomeScreen({
  profile,
  products,
  drafts,
  loading,
  onAdd,
  onResume,
  onProducts,
  onPublish,
  onOrders,
  onEdit,
}: {
  profile: Profile;
  products: ProductSummary[];
  drafts: ProductDraft[];
  loading: boolean;
  onAdd: () => void;
  onResume: (draft: ProductDraft) => void;
  onProducts: () => void;
  onPublish: () => void;
  onOrders: () => void;
  onEdit: (product: ProductSummary) => void;
}) {
  const publishedCount = products.filter(
    (product) => product.status === "published",
  ).length;
  return (
    <section className="screen page-pad">
      <header className="topbar">
        <div>
          <p className="eyebrow">AMPHON TRADING</p>
          <h1>Product Hub</h1>
        </div>
        <div className="avatar">{initials(profile.displayName)}</div>
      </header>
      <div className="hello-line">
        สวัสดี {profile.displayName} · {roleLabel(profile.role)}
      </div>
      <button className="search-launch" onClick={onProducts}>
        <Search size={19} /> ค้นหา รุ่น / SN / SKU
      </button>
      {drafts.length > 0 && (
        <DraftResumeCard
          draft={drafts[0]}
          count={drafts.length}
          onResume={() => onResume(drafts[0])}
        />
      )}
      <button className="primary-add" onClick={onAdd}>
        <CirclePlus size={24} /> เพิ่มสินค้าใหม่
      </button>
      <button className="publish-center-launch" onClick={onPublish}>
        <div>
          <FileText size={21} />
          <span>
            <strong>Shop / เว็บไซต์</strong>
            <small>
              จัดการสินค้าที่ขึ้นเว็บ ราคา SEO และหน้า AMPHON SHOP
            </small>
          </span>
        </div>
        <ChevronRight />
      </button>
      {["owner", "admin", "sales"].includes(profile.role) && (
        <button
          className="publish-center-launch order-center-launch"
          onClick={onOrders}
        >
          <div>
            <ShoppingBag size={21} />
            <span>
              <strong>Online Orders</strong>
              <small>
                ตรวจยอด แพ็กสินค้า Tracking และปิดคำสั่งซื้อจาก AMPHON SHOP
              </small>
            </span>
          </div>
          <ChevronRight />
        </button>
      )}
      <div className="stats-grid">
        <Stat
          label="รอรูปภาพ"
          value={String(
            products.filter((product) => product.status === "draft").length,
          )}
          tone="rose"
        />
        <Stat
          label="รอข้อมูลลงขาย"
          value={String(
            products.filter((product) => product.status === "photo_ready")
              .length,
          )}
          tone="amber"
        />
        <Stat
          label="พร้อมลงขาย"
          value={String(
            products.filter((product) => product.status === "ready_to_list")
              .length,
          )}
          tone="green"
        />
        <Stat
          label="จองแล้ว"
          value={String(
            products.filter((product) => product.status === "reserved").length,
          )}
          tone="blue"
        />
        <Stat label="กำลังขาย" value={String(publishedCount)} tone="dark" />
      </div>
      <div className="section-head">
        <h2>สินค้าล่าสุด</h2>
        <button onClick={onProducts}>ดูทั้งหมด</button>
      </div>
      {loading && !products.length ? (
        <ListSkeleton />
      ) : (
        <div className="product-list">
          {products.slice(0, 6).map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onClick={() => onEdit(product)}
            />
          ))}
        </div>
      )}
      {!loading && !products.length && <EmptyInventory onAdd={onAdd} />}
    </section>
  );
}

function DraftResumeCard({
  draft,
  count,
  onResume,
}: {
  draft: ProductDraft;
  count: number;
  onResume: () => void;
}) {
  const title =
    draft.title ||
    [draft.brand, draft.model].filter(Boolean).join(" ") ||
    "สินค้าที่ยังกรอกไม่เสร็จ";
  return (
    <button className="draft-resume" onClick={onResume}>
      <div>
        <small>มีร่างค้าง {count} รายการ</small>
        <strong>{title}</strong>
        <span>ทำต่อจากขั้นที่ {draft.currentStep}</span>
      </div>
      <ChevronRight />
    </button>
  );
}

function ProductsScreen({
  query,
  setQuery,
  products,
  loading,
  filter,
  setFilter,
  onEdit,
  onRefresh,
  onScan,
  onPublish,
}: {
  query: string;
  setQuery: (value: string) => void;
  products: ProductSummary[];
  loading: boolean;
  filter: StatusFilter;
  setFilter: (filter: StatusFilter) => void;
  onEdit: (product: ProductSummary) => void;
  onRefresh: () => void;
  onScan: () => void;
  onPublish: () => void;
}) {
  return (
    <section className="screen page-pad">
      <header className="topbar">
        <div>
          <p className="eyebrow">INVENTORY</p>
          <h1>สินค้า</h1>
        </div>
        <div className="topbar-actions">
          <button
            className="refresh-button publish-launch-icon"
            onClick={onPublish}
            aria-label="จัดการ Shop / เว็บไซต์"
          >
            <FileText />
          </button>
          <button
            className="refresh-button scan-launch-icon"
            onClick={onScan}
            aria-label="สแกน QR / Barcode"
          >
            <ScanLine />
          </button>
          <button
            className="refresh-button"
            onClick={onRefresh}
            aria-label="รีเฟรช"
          >
            <RefreshCw className={loading ? "spin" : ""} />
          </button>
        </div>
      </header>
      <label className="searchbox">
        <Search size={18} />
        <input
          value={query}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setQuery(event.target.value)
          }
          placeholder="ค้นหา รุ่น / SN / SKU"
        />
      </label>
      <div className="chip-row">
        <FilterChip
          label="ทั้งหมด"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <FilterChip
          label="พร้อมขาย"
          active={filter === "ready_to_list"}
          onClick={() => setFilter("ready_to_list")}
        />
        <FilterChip
          label="จองแล้ว"
          active={filter === "reserved"}
          onClick={() => setFilter("reserved")}
        />
      </div>
      <div className="inventory-count">พบ {products.length} รายการ</div>
      <div className="product-list">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            onClick={() => onEdit(product)}
          />
        ))}
      </div>
      {!loading && !products.length && (
        <div className="empty-state">
          <Package />
          <strong>ไม่พบสินค้า</strong>
          <span>ลองเปลี่ยนคำค้นหาหรือตัวกรอง</span>
        </div>
      )}
    </section>
  );
}

function ScannerScreen({
  products,
  onOpen,
}: {
  products: ProductSummary[];
  onOpen: (product: ProductSummary) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const resolvedRef = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  function stopScanner() {
    try {
      controlsRef.current?.stop();
    } catch {
      /* camera may already be stopped */
    }
    controlsRef.current = null;
    setScanning(false);
  }

  function resolveRaw(raw: string) {
    const product = findProductByScannedValue(products, raw);
    if (!product) {
      setMessage(`ไม่พบสินค้า: ${raw}`);
      resolvedRef.current = false;
      return false;
    }
    resolvedRef.current = true;
    stopScanner();
    onOpen(product);
    return true;
  }

  useEffect(
    () => () => {
      try {
        controlsRef.current?.stop();
      } catch {
        /* ignore cleanup errors */
      }
    },
    [],
  );

  async function startCamera() {
    setMessage(null);
    resolvedRef.current = false;
    if (!window.isSecureContext && location.hostname !== "localhost") {
      setMessage(
        "Live Scanner ต้องเปิดผ่าน HTTPS บนมือถือ — ระหว่างทดสอบ LAN ให้ใช้ “ถ่าย/เลือกรูปโค้ด” ด้านล่าง",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage(
        "เบราว์เซอร์นี้ไม่รองรับกล้อง Live Scanner กรุณาใช้การสแกนจากรูป",
      );
      return;
    }
    try {
      stopScanner();
      setScanning(true);
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } },
        videoRef.current ?? undefined,
        (
          result: any,
          _error: unknown,
          callbackControls: { stop: () => void },
        ) => {
          if (!result || resolvedRef.current) return;
          const raw =
            typeof result.getText === "function"
              ? result.getText()
              : String(result.text ?? "");
          const product = findProductByScannedValue(products, raw);
          if (!product) {
            setMessage(`อ่านได้ “${raw}” แต่ไม่พบในสต๊อก`);
            return;
          }
          resolvedRef.current = true;
          callbackControls.stop();
          controlsRef.current = null;
          setScanning(false);
          onOpen(product);
        },
      );
      controlsRef.current = controls;
    } catch (error) {
      setScanning(false);
      setMessage(
        error instanceof Error
          ? `เปิดกล้องไม่ได้: ${error.message}`
          : "เปิดกล้องไม่ได้",
      );
    }
  }

  async function scanImage(file?: File) {
    if (!file) return;
    setMessage("กำลังอ่าน QR / Barcode จากรูป...");
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const url = URL.createObjectURL(file);
      try {
        const result = await reader.decodeFromImageUrl(url);
        const raw = result.getText();
        if (!resolveRaw(raw)) setMessage(`อ่านได้ “${raw}” แต่ไม่พบในสต๊อก`);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `อ่านโค้ดจากรูปไม่สำเร็จ: ${error.message}`
          : "อ่านโค้ดจากรูปไม่สำเร็จ",
      );
    }
  }

  const q = manual.trim().toLowerCase();
  const suggestions = q
    ? products
        .filter((product) =>
          [product.sku, product.serialNumber || "", product.title].some(
            (value) => value.toLowerCase().includes(q),
          ),
        )
        .slice(0, 5)
    : [];

  return (
    <section className="screen page-pad scanner-screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">SCAN & FIND</p>
          <h1>สแกนสินค้า</h1>
        </div>
        <span className="scanner-count">{products.length} SKU</span>
      </header>
      <div className="scanner-card">
        <div className="scanner-video-wrap">
          <video ref={videoRef} className="scanner-video" muted playsInline />
          <div className="scan-frame">
            <span />
            <span />
            <span />
            <span />
          </div>
          {!scanning && (
            <div className="scanner-placeholder">
              <ScanLine />
              <strong>QR / Barcode Scanner</strong>
              <small>รองรับ QR, Code128, EAN และ Barcode ทั่วไป</small>
            </div>
          )}
        </div>
        <button
          className="primary-wide scanner-primary"
          type="button"
          onClick={() => void startCamera()}
          disabled={scanning}
        >
          {scanning ? (
            <>
              <LoaderCircle className="spin" size={18} /> กำลังสแกน...
            </>
          ) : (
            <>
              <Camera size={19} /> เปิดกล้องสแกน
            </>
          )}
        </button>
        {scanning && (
          <button
            className="secondary-wide"
            type="button"
            onClick={stopScanner}
          >
            หยุดกล้อง
          </button>
        )}
        <label className="secondary-wide scan-image-button">
          <ImageDown size={18} /> ถ่าย/เลือกรูปโค้ด
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              const file = event.target.files?.[0];
              void scanImage(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {message && <div className="scanner-message">{message}</div>}
      </div>

      <div className="manual-scan-card">
        <div>
          <strong>ค้นหาด้วย SKU / Serial</strong>
          <small>ใช้เมื่อฉลากชำรุดหรือกล้องสแกนไม่ได้</small>
        </div>
        <label className="searchbox">
          <Search size={18} />
          <input
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="AT-NB-2609-000123 / Serial"
          />
        </label>
        {suggestions.length > 0 && (
          <div className="scan-suggestions">
            {suggestions.map((product) => (
              <button key={product.id} onClick={() => onOpen(product)}>
                <div>
                  <strong>{product.sku}</strong>
                  <span>{product.title}</span>
                </div>
                <Status status={product.status} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="scanner-tip">
        <QrCode />
        <div>
          <strong>ฉลาก AMPHON</strong>
          <span>
            QR จะเปิดสินค้าตรงรายการ ส่วน Code128 เก็บค่า SKU
            เพื่อให้สแกนด้วยเครื่องอ่าน Barcode ได้
          </span>
        </div>
      </div>
    </section>
  );
}

function AddProduct({
  draft,
  profile,
  update,
  addImages,
  removeImage,
  setCover,
  setImageRole,
  savedAt,
  saving,
  uploadQueue,
  error,
  duplicateMatch,
  duplicateChecking,
  activity,
  activityLoading,
  onSave,
  onDelete,
  onQuickStatus,
  onClose,
}: {
  draft: ProductDraft;
  profile: Profile;
  update: (patch: Partial<ProductDraft>) => void;
  addImages: (files: FileList | null) => void;
  removeImage: (imageId: string) => void;
  setCover: (imageId: string) => void;
  setImageRole: (imageId: string, imageRole: string) => void;
  savedAt: number | null;
  saving: boolean;
  uploadQueue: UploadQueueItem[];
  error: string | null;
  duplicateMatch: DuplicateIdentifierMatch | null;
  duplicateChecking: boolean;
  activity: ProductActivity[];
  activityLoading: boolean;
  onSave: () => void;
  onDelete: () => void;
  onQuickStatus: (status: ProductStatus) => void;
  onClose: () => void;
}) {
  const step = draft.currentStep;
  const next = () => update({ currentStep: Math.min(4, step + 1) });
  const back = () =>
    step === 1 ? onClose() : update({ currentStep: step - 1 });
  const editing = Boolean(draft.remoteProductId);
  const canDelete = editing && ["owner", "admin"].includes(profile.role);
  const categoryDefinition = getCategoryDefinition(draft.category);
  const categoryReady = Boolean(
    draft.category && (!categoryDefinition?.subtypes.length || draft.subtype),
  );
  const hasUploadErrors = uploadQueue.some((item) => item.state === "error");
  return (
    <section className="screen add-screen">
      <header className="add-header">
        <button className="icon-btn" onClick={back} disabled={saving}>
          <ChevronLeft />
        </button>
        <div className="add-title">
          <strong>
            {editing ? `แก้ไข ${draft.sku || "สินค้า"}` : "เพิ่มสินค้า"}
          </strong>
          <small>
            {savedAt ? "✓ บันทึกร่างอัตโนมัติ" : "ร่างถูกเก็บในเครื่อง"}
          </small>
        </div>
        <button className="icon-btn" onClick={onClose} disabled={saving}>
          <X />
        </button>
      </header>
      <div className="stepper">
        {[1, 2, 3, 4].map((number) => (
          <span key={number} className={number <= step ? "done" : ""} />
        ))}
      </div>
      <div className="form-body">
        {error && <div className="save-error">{error}</div>}
        {uploadQueue.length > 0 && <UploadQueue queue={uploadQueue} />}
        {step === 1 && <CategoryStep draft={draft} update={update} />}
        {step === 2 && (
          <DetailStep
            draft={draft}
            update={update}
            duplicateMatch={duplicateMatch}
            duplicateChecking={duplicateChecking}
          />
        )}
        {step === 3 && (
          <PhotoStep
            draft={draft}
            addImages={addImages}
            removeImage={removeImage}
            setCover={setCover}
            setImageRole={setImageRole}
          />
        )}
        {step === 4 && (
          <ReviewStep
            draft={draft}
            profile={profile}
            update={update}
            showCost={["owner", "admin"].includes(profile.role)}
            canDelete={canDelete}
            onDelete={onDelete}
            onQuickStatus={onQuickStatus}
            saving={saving}
            activity={activity}
            activityLoading={activityLoading}
          />
        )}
      </div>
      <div className="sticky-action">
        {step < 4 ? (
          <button
            className="primary-wide"
            onClick={next}
            disabled={
              saving ||
              (step === 1 && !categoryReady) ||
              (step === 2 && Boolean(duplicateMatch))
            }
          >
            ต่อไป <ChevronRight size={20} />
          </button>
        ) : (
          <button
            className="primary-wide"
            onClick={onSave}
            disabled={saving || Boolean(duplicateMatch)}
          >
            {saving ? (
              <>
                <LoaderCircle className="spin" size={19} /> กำลังบันทึก
              </>
            ) : hasUploadErrors ? (
              <>
                <RefreshCw size={18} /> ลองอัปโหลดอีกครั้ง
              </>
            ) : editing ? (
              "บันทึกการแก้ไข"
            ) : (
              "บันทึกสินค้า"
            )}
          </button>
        )}
      </div>
    </section>
  );
}

function UploadQueue({ queue }: { queue: UploadQueueItem[] }) {
  const done = queue.filter((item) => item.state === "done").length;
  return (
    <div className="upload-panel">
      <div className="upload-head">
        <strong>อัปโหลดรูป</strong>
        <span>
          {done}/{queue.length}
        </span>
      </div>
      {queue.map((item) => (
        <div className="upload-row" key={item.imageId}>
          <span className={`upload-dot ${item.state}`} />
          <div>
            <b>{item.filename}</b>
            <small>
              {item.state === "waiting"
                ? "รออัปโหลด"
                : item.state === "uploading"
                  ? "กำลังอัปโหลด..."
                  : item.state === "done"
                    ? "สำเร็จ"
                    : item.error || "เกิดข้อผิดพลาด"}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}

function CategoryStep({
  draft,
  update,
}: {
  draft: ProductDraft;
  update: (patch: Partial<ProductDraft>) => void;
}) {
  const definition = getCategoryDefinition(draft.category);
  function selectCategory(category: ProductCategory) {
    const nextDefinition = getCategoryDefinition(category);
    const automaticSubtype =
      nextDefinition?.subtypes.length === 1
        ? nextDefinition.subtypes[0].value
        : undefined;
    update({
      category,
      subtype: automaticSubtype,
      specs: {},
      title: undefined,
    });
  }
  return (
    <>
      <h2 className="form-title">สินค้าประเภทไหน?</h2>
      <p className="form-hint">
        เลือกหมวดและประเภทย่อย ระบบจะสร้างแบบฟอร์มเฉพาะสินค้านั้น
      </p>
      <div className="category-grid">
        {categories.map((category) => (
          <button
            type="button"
            key={category.key}
            onClick={() => selectCategory(category.key)}
            className={
              draft.category === category.key ? "category selected" : "category"
            }
          >
            <span>{category.icon}</span>
            <b>{category.label}</b>
          </button>
        ))}
      </div>
      {definition && definition.subtypes.length > 1 && (
        <div className="subtype-section">
          <strong>
            ประเภทย่อย <span className="required-dot">จำเป็น</span>
          </strong>
          <div className="subtype-grid">
            {definition.subtypes.map((subtype) => (
              <button
                type="button"
                key={subtype.value}
                className={
                  draft.subtype === subtype.value ? "subtype active" : "subtype"
                }
                onClick={() => update({ subtype: subtype.value, specs: {} })}
              >
                {subtype.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function DetailStep({
  draft,
  update,
  duplicateMatch,
  duplicateChecking,
}: {
  draft: ProductDraft;
  update: (patch: Partial<ProductDraft>) => void;
  duplicateMatch: DuplicateIdentifierMatch | null;
  duplicateChecking: boolean;
}) {
  const fields = getSmartFields(draft);
  const setSpec = (key: string, value: string) =>
    update({ specs: { ...draft.specs, [key]: value } });
  const groups = [
    {
      key: "spec",
      label: "สเปกหลัก",
      fields: fields.filter(
        (field) => !field.section || field.section === "spec",
      ),
    },
    {
      key: "condition",
      label: "สภาพ / ผลตรวจ",
      fields: fields.filter((field) => field.section === "condition"),
    },
    {
      key: "accessory",
      label: "อุปกรณ์ที่ให้",
      fields: fields.filter((field) => field.section === "accessory"),
    },
  ].filter((group) => group.fields.length);
  return (
    <div className="form-stack">
      <div>
        <h2 className="form-title">รายละเอียดสินค้า</h2>
        <p className="form-hint">
          ช่องสีแดงคือข้อมูลสำคัญที่ต้องครบก่อนตั้งสถานะพร้อมลงขาย
        </p>
      </div>
      <div className="smart-section">
        <div className="smart-section-title">
          <strong>ข้อมูลหลัก</strong>
          <small>ใช้ค้นหาและสร้างชื่อสินค้า</small>
        </div>
        <SmartRootField
          label="แบรนด์"
          importance="required"
          value={draft.brand ?? ""}
          onChange={(value) => update({ brand: value })}
          placeholder="เช่น ASUS / Apple / Sony"
        />
        <SmartRootField
          label="รุ่น"
          importance="required"
          value={draft.model ?? ""}
          onChange={(value) => update({ model: value })}
          placeholder="เช่น TUF Gaming A17 / iPhone 15 Pro"
        />
        <SmartRootField
          label="Serial Number / IMEI"
          importance="optional"
          value={draft.serialNumber ?? ""}
          onChange={(value) => update({ serialNumber: value })}
          placeholder="สแกนหรือพิมพ์หมายเลขเครื่อง"
        />
        {duplicateChecking && (
          <div className="identifier-check checking">
            <LoaderCircle className="spin" size={14} /> กำลังตรวจ Serial / IMEI
            ซ้ำ...
          </div>
        )}
        {duplicateMatch && (
          <div className="identifier-check duplicate">
            <strong>⚠️ พบหมายเลขซ้ำในสต๊อก</strong>
            <span>
              {duplicateMatch.sku} — {duplicateMatch.title}
            </span>
            <small>
              สถานะ: {statusText(duplicateMatch.status)} ·
              กรุณาตรวจสอบสินค้ารายการเดิมก่อนสร้างใหม่
            </small>
          </div>
        )}
        {!duplicateChecking &&
          !duplicateMatch &&
          (draft.serialNumber?.trim().length ?? 0) >= 5 && (
            <div className="identifier-check clear">
              ✓ ยังไม่พบ Serial / IMEI นี้ในสต๊อกที่กำลังใช้งาน
            </div>
          )}
      </div>
      {groups.map((group) => (
        <div className="smart-section" key={group.key}>
          <div className="smart-section-title">
            <strong>{group.label}</strong>
            <small>
              {group.key === "spec"
                ? "ระบบนำข้อมูลชุดนี้ไปเขียนสเปกและคอนเทนต์ขาย"
                : group.key === "condition"
                  ? "ช่วยให้ประกาศสภาพได้ตรงและลดการตกหล่น"
                  : "ระบุของที่ลูกค้าจะได้รับจริง"}
            </small>
          </div>
          {group.fields.map((field) => (
            <SmartSpecField
              key={`${field.key}-${field.importance}`}
              field={field}
              value={draft.specs[field.key] ?? ""}
              onChange={(value) => setSpec(field.key, value)}
            />
          ))}
        </div>
      ))}
      <div className="smart-section">
        <div className="smart-section-title">
          <strong>ตำหนิและหมายเหตุ</strong>
          <small>
            ระบุตามสภาพจริง หากไม่มีตำหนิสามารถระบุ “ไม่มีตำหนิเด่น”
          </small>
        </div>
        <SmartRootField
          label="ตำหนิ"
          importance="recommended"
          value={draft.defects ?? ""}
          onChange={(value) => update({ defects: value })}
          placeholder="เช่น มีรอยมุมขวาเล็กน้อย"
          multiline
        />
        <SmartRootField
          label="หมายเหตุภายใน/เพิ่มเติม"
          importance="optional"
          value={draft.notes ?? ""}
          onChange={(value) => update({ notes: value })}
          placeholder="ข้อมูลเพิ่มเติม"
          multiline
        />
      </div>
    </div>
  );
}

function SmartSpecField({
  field,
  value,
  onChange,
}: {
  field: SmartFieldDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={`field smart-field importance-${field.importance}`}>
      <span>
        {field.label}
        <ImportanceBadge importance={field.importance} />
      </span>
      {field.type === "textarea" ? (
        <textarea
          value={value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            onChange(event.target.value)
          }
          placeholder={field.placeholder}
          rows={3}
        />
      ) : field.type === "select" ? (
        <select
          value={value}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
            onChange(event.target.value)
          }
        >
          <option value="">เลือก...</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={value}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            onChange(event.target.value)
          }
          placeholder={field.placeholder}
          inputMode={field.inputMode ?? "text"}
        />
      )}
    </label>
  );
}

function SmartRootField({
  label,
  importance,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  importance: "required" | "recommended" | "optional";
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <label className={`field smart-field importance-${importance}`}>
      <span>
        {label}
        <ImportanceBadge importance={importance} />
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            onChange(event.target.value)
          }
          placeholder={placeholder}
          rows={3}
        />
      ) : (
        <input
          value={value}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            onChange(event.target.value)
          }
          placeholder={placeholder}
        />
      )}
    </label>
  );
}

function ImportanceBadge({
  importance,
}: {
  importance: "required" | "recommended" | "optional";
}) {
  const labels = {
    required: "จำเป็น",
    recommended: "แนะนำ",
    optional: "เสริม",
  };
  return (
    <small className={`importance-badge ${importance}`}>
      {labels[importance]}
    </small>
  );
}

function PhotoStep({
  draft,
  addImages,
  removeImage,
  setCover,
  setImageRole,
}: {
  draft: ProductDraft;
  addImages: (files: FileList | null) => void;
  removeImage: (imageId: string) => void;
  setCover: (imageId: string) => void;
  setImageRole: (imageId: string, imageRole: string) => void;
}) {
  const imageRoles = getImageRoles(draft.category);
  return (
    <>
      <h2 className="form-title">รูปสินค้า</h2>
      <p className="form-hint">
        ระบุประเภทของแต่ละรูปไว้ด้วย เพื่อให้เว็บขายของรู้ว่ารูปไหนคือหน้าจอ
        ตำหนิ Serial หรืออุปกรณ์
      </p>
      <label className="camera-button">
        <Camera size={24} />
        <span>
          <b>ถ่าย / เลือกรูป</b>
          <small>รองรับสูงสุด 20 รูปต่อสินค้า</small>
        </span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            addImages(event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <div className="photo-grid smart-photo-grid">
        {draft.images.map((image, index) => (
          <div className="photo-item" key={image.id}>
            <div className="photo-tile">
              {image.previewUrl ? (
                <img
                  src={image.previewUrl}
                  alt=""
                  onClick={() => setCover(image.id)}
                />
              ) : (
                <div className="photo-placeholder">IMG</div>
              )}
              {image.isCover && <span className="cover-badge">รูปหลัก</span>}
              <small>{index + 1}</small>
              <button
                type="button"
                className="photo-remove"
                onClick={() => removeImage(image.id)}
                aria-label="ลบรูป"
              >
                <X size={14} />
              </button>
            </div>
            <select
              className="photo-role-select"
              value={image.imageRole ?? (image.isCover ? "cover" : "other")}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                setImageRole(image.id, event.target.value)
              }
            >
              {imageRoles.map((role) => (
                <option value={role.value} key={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {draft.images.length > 0 && (
        <p className="photo-tip">
          แตะที่รูปเพื่อกำหนดเป็นรูปหลัก · เลือกประเภทภาพใต้แต่ละรูป
        </p>
      )}
    </>
  );
}

function CompletenessCard({ draft }: { draft: ProductDraft }) {
  const completeness = getCompleteness(draft);
  const tone = completeness.ready
    ? "complete"
    : completeness.score >= 60
      ? "progress"
      : "incomplete";
  return (
    <section className={`completeness-card ${tone}`}>
      <div className="completeness-head">
        <div>
          <strong>ข้อมูลพร้อมลงขาย</strong>
          <small>
            {completeness.completedRequired}/{completeness.totalRequired}{" "}
            รายการจำเป็นครบ
          </small>
        </div>
        <b>{completeness.score}%</b>
      </div>
      <div className="completeness-bar">
        <span style={{ width: `${completeness.score}%` }} />
      </div>
      {completeness.missingRequired.length > 0 ? (
        <div className="missing-list">
          <strong>ต้องกรอกเพิ่ม</strong>
          <p>
            {completeness.missingRequired.slice(0, 6).join(" · ")}
            {completeness.missingRequired.length > 6 ? " …" : ""}
          </p>
        </div>
      ) : (
        <div className="ready-message">
          ✓ ข้อมูลจำเป็นครบแล้ว{" "}
          {completeness.ready
            ? "พร้อมลงขาย"
            : "เพิ่มข้อมูลแนะนำอีกเล็กน้อยเพื่อให้ถึง 80%"}
        </div>
      )}
      {completeness.missingRecommended.length > 0 && (
        <small className="recommended-missing">
          แนะนำเพิ่ม: {completeness.missingRecommended.slice(0, 4).join(" · ")}
        </small>
      )}
    </section>
  );
}

const statusOptions: Array<{ value: ProductStatus; label: string }> = [
  { value: "draft", label: "ร่าง" },
  { value: "photo_ready", label: "รูปพร้อม" },
  { value: "ready_to_list", label: "พร้อมลงขาย" },
  { value: "published", label: "เผยแพร่แล้ว" },
  { value: "reserved", label: "จองแล้ว" },
  { value: "sold", label: "ขายแล้ว" },
  { value: "repair", label: "ซ่อม/ตรวจเช็ก" },
  { value: "consignment", label: "ฝากขาย" },
  { value: "returned", label: "คืนสินค้า" },
  { value: "cancelled", label: "ยกเลิก" },
];

function ReviewStep({
  draft,
  profile,
  update,
  showCost,
  canDelete,
  onDelete,
  onQuickStatus,
  saving,
  activity,
  activityLoading,
}: {
  draft: ProductDraft;
  profile: Profile;
  update: (patch: Partial<ProductDraft>) => void;
  showCost: boolean;
  canDelete: boolean;
  onDelete: () => void;
  onQuickStatus: (status: ProductStatus) => void;
  saving: boolean;
  activity: ProductActivity[];
  activityLoading: boolean;
}) {
  const suggestedTitle = [draft.brand, draft.model].filter(Boolean).join(" ");
  const completeness = getCompleteness(draft);
  const allowed = allowedStatuses(draft.originalStatus, profile.role);
  const pendingUploads = draft.images.filter(
    (image) => image.blob && !image.remoteImageId,
  ).length;
  return (
    <div className="form-stack">
      <h2 className="form-title">ราคาและตรวจสอบ</h2>
      <CompletenessCard draft={draft} />
      {draft.remoteProductId && (
        <div className="workflow-guard">
          <div>
            <strong>Workflow Guard</strong>
            <small>
              สถานะปัจจุบัน: {statusText(draft.originalStatus || draft.status)}
            </small>
          </div>
          <span>ป้องกันเปลี่ยนสถานะผิดลำดับ</span>
        </div>
      )}
      {pendingUploads > 0 && (
        <div className="pending-upload-warning">
          <strong>มีรูปใหม่รออัปโหลด {pendingUploads} รูป</strong>
          <span>
            อย่าปิดหน้านี้ระหว่างกดบันทึก
            หากเน็ตหลุดระบบจะจำรูปที่สำเร็จและให้ลองต่อเฉพาะรูปที่ค้าง
          </span>
        </div>
      )}
      <div className="review-card">
        <div>
          <small>สินค้า</small>
          <strong>{suggestedTitle || "ยังไม่ได้ระบุรุ่น"}</strong>
        </div>
        <div>
          <small>รูป</small>
          <strong>{draft.images.length} รูป</strong>
        </div>
        {draft.sku && (
          <div>
            <small>SKU</small>
            <strong>{draft.sku}</strong>
          </div>
        )}
      </div>
      {draft.remoteProductId && (
        <ProductWorkflowTools
          draft={draft}
          profile={profile}
          update={update}
          onQuickStatus={onQuickStatus}
          saving={saving}
        />
      )}
      {draft.remoteProductId && (
        <SalesToolkit draft={draft} profile={profile} />
      )}
      <Field
        label="ชื่อที่ใช้ขาย"
        value={draft.title ?? suggestedTitle}
        onChange={(value) => update({ title: value })}
        placeholder="ชื่อสินค้า"
      />
      <Field
        label="ราคาขาย"
        value={draft.price ? String(draft.price) : ""}
        onChange={(value) =>
          update({ price: Number(value.replace(/\D/g, "")) || undefined })
        }
        placeholder="42900"
        inputMode="numeric"
      />
      {showCost && (
        <Field
          label="ต้นทุน (Owner/Admin เท่านั้น)"
          value={draft.cost ? String(draft.cost) : ""}
          onChange={(value) =>
            update({ cost: Number(value.replace(/\D/g, "")) || undefined })
          }
          placeholder="35000"
          inputMode="numeric"
        />
      )}
      <Field
        label="สภาพ %"
        value={draft.conditionPercent ? String(draft.conditionPercent) : ""}
        onChange={(value) =>
          update({
            conditionPercent: Math.min(100, Number(value) || 0) || undefined,
          })
        }
        placeholder="90"
        inputMode="numeric"
      />
      <label className="field">
        <span>ประกันถึง</span>
        <input
          type="date"
          value={draft.warrantyUntil ?? ""}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            update({ warrantyUntil: event.target.value })
          }
        />
      </label>
      <label className="field">
        <span>สถานะหลังบันทึก</span>
        <select
          value={draft.status}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
            update({ status: event.target.value as ProductStatus })
          }
        >
          {statusOptions.map((option) => {
            const blockedByWorkflow = !allowed.includes(option.value);
            const blockedByCompleteness =
              ["ready_to_list", "published"].includes(option.value) &&
              !completeness.ready;
            return (
              <option
                value={option.value}
                key={option.value}
                disabled={blockedByWorkflow || blockedByCompleteness}
              >
                {option.label}
                {blockedByWorkflow
                  ? " (ยังเปลี่ยนมาสถานะนี้ไม่ได้)"
                  : blockedByCompleteness
                    ? " (ข้อมูลยังไม่ครบ)"
                    : ""}
              </option>
            );
          })}
        </select>
      </label>
      {draft.remoteProductId && ["owner", "admin"].includes(profile.role) && (
        <ActivityTimeline activity={activity} loading={activityLoading} />
      )}
      {canDelete && (
        <button
          type="button"
          className="danger-button"
          onClick={onDelete}
          disabled={saving}
        >
          <Trash2 size={18} /> ลบสินค้านี้
        </button>
      )}
    </div>
  );
}

function ProductWorkflowTools({
  draft,
  profile,
  update,
  onQuickStatus,
  saving,
}: {
  draft: ProductDraft;
  profile: Profile;
  update: (patch: Partial<ProductDraft>) => void;
  onQuickStatus: (status: ProductStatus) => void;
  saving: boolean;
}) {
  const allowed = allowedStatuses(
    draft.originalStatus || draft.status,
    profile.role,
  );
  const canReserve =
    allowed.includes("reserved") && draft.status !== "reserved";
  const canSell = allowed.includes("sold") && draft.status !== "sold";
  const warranty = draft.warrantyUntil
    ? new Date(`${draft.warrantyUntil}T00:00:00`).toLocaleDateString("th-TH", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "ไม่ได้ระบุ";
  return (
    <section className="product-workflow-tools">
      <div className="workflow-tool-head">
        <div>
          <span className="toolkit-icon">
            <QrCode size={18} />
          </span>
          <div>
            <strong>QR / Barcode Workflow</strong>
            <small>สแกน → เปิดสินค้า → ทำรายการได้ตรงเครื่อง</small>
          </div>
        </div>
        <Status status={draft.status} />
      </div>
      <div className="quick-info-grid">
        <div>
          <span>SKU</span>
          <strong>{draft.sku || "-"}</strong>
        </div>
        <div>
          <span>ประกันถึง</span>
          <strong>{warranty}</strong>
        </div>
      </div>
      <div className="quick-action-grid">
        <button type="button" onClick={() => update({ currentStep: 2 })}>
          <Pencil />
          <span>แก้ข้อมูล</span>
        </button>
        <button
          type="button"
          disabled={saving || !canReserve}
          onClick={() => onQuickStatus("reserved")}
        >
          <CalendarDays />
          <span>{draft.status === "reserved" ? "จองแล้ว" : "จองสินค้า"}</span>
        </button>
        <button
          type="button"
          className="sell-action"
          disabled={saving || !canSell}
          onClick={() => onQuickStatus("sold")}
        >
          <ShoppingCart />
          <span>{draft.status === "sold" ? "ขายแล้ว" : "ขายแล้ว"}</span>
        </button>
      </div>
      {draft.sku && <ProductCodeCard draft={draft} />}
    </section>
  );
}

function ProductCodeCard({ draft }: { draft: ProductDraft }) {
  const [codes, setCodes] = useState<ProductCodeImages | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  useEffect(() => {
    if (!draft.sku) return;
    let cancelled = false;
    void generateProductCodeImages(draft.sku)
      .then((next) => {
        if (!cancelled) setCodes(next);
      })
      .catch((error) => {
        if (!cancelled)
          setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [draft.sku]);

  return (
    <div className="product-code-card">
      <div className="product-code-preview">
        {codes ? (
          <img src={codes.qrDataUrl} alt={`QR ${draft.sku}`} />
        ) : (
          <LoaderCircle className="spin" />
        )}
        <div>
          <strong>{draft.sku}</strong>
          <span>QR เปิดรายการนี้โดยตรง</span>
          <small>Code128 ใช้กับเครื่องอ่าน Barcode / กล้องสแกน</small>
        </div>
      </div>
      <div className="code-actions">
        <button
          type="button"
          disabled={!codes}
          onClick={() => setLabelOpen(true)}
        >
          <Printer />
          <span>พิมพ์ฉลาก</span>
        </button>
        <button
          type="button"
          disabled={!codes}
          onClick={() =>
            codes && downloadDataUrl(codes.qrDataUrl, `${draft.sku}-qr.png`)
          }
        >
          <Download />
          <span>QR PNG</span>
        </button>
        <button
          type="button"
          disabled={!codes}
          onClick={() =>
            codes &&
            downloadDataUrl(codes.barcodeDataUrl, `${draft.sku}-barcode.png`)
          }
        >
          <ImageDown />
          <span>Barcode</span>
        </button>
        <button
          type="button"
          disabled={!codes}
          onClick={async () => {
            if (!codes) return;
            await copyText(codes.deepLink);
            setMessage("✓ ก๊อปลิงก์สินค้าแล้ว");
          }}
        >
          <Copy />
          <span>ก๊อปลิงก์</span>
        </button>
      </div>
      {message && <div className="toolkit-message">{message}</div>}
      {labelOpen && codes && (
        <ProductLabelModal
          draft={draft}
          codes={codes}
          onClose={() => setLabelOpen(false)}
        />
      )}
    </div>
  );
}

function ProductLabelModal({
  draft,
  codes,
  onClose,
}: {
  draft: ProductDraft;
  codes: ProductCodeImages;
  onClose: () => void;
}) {
  const [size, setSize] = useState<"70x40" | "50x30">("70x40");
  const title =
    draft.title ||
    [draft.brand, draft.model].filter(Boolean).join(" ") ||
    "สินค้า AMPHON";
  const price = draft.price ? baht(draft.price) : "";

  function escapeHtml(value: string) {
    return value.replace(
      /[&<>'"]/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[char] || char,
    );
  }

  function printLabel() {
    const popup = window.open("", "_blank", "width=720,height=620");
    if (!popup) return;
    const [width, height] = size.split("x");
    popup.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(draft.sku || "AMPHON")}</title><style>@page{size:${width}mm ${height}mm;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}.label{width:${width}mm;height:${height}mm;padding:2.2mm;display:grid;grid-template-columns:28% 1fr;gap:2mm;overflow:hidden}.qr{width:100%;aspect-ratio:1;object-fit:contain}.info{min-width:0;display:flex;flex-direction:column;justify-content:center}.brand{font-size:7pt;font-weight:800;letter-spacing:.08em}.title{font-size:${size === "70x40" ? "8.5" : "7"}pt;font-weight:700;line-height:1.12;margin:1mm 0;max-height:10mm;overflow:hidden}.sku{font-size:${size === "70x40" ? "9" : "7.5"}pt;font-weight:800}.price{font-size:${size === "70x40" ? "10" : "8"}pt;font-weight:800;margin-top:.5mm}.barcode{width:100%;height:${size === "70x40" ? "9" : "6"}mm;object-fit:fill;margin-top:1mm}</style></head><body><div class="label"><img class="qr" src="${codes.qrDataUrl}"><div class="info"><div class="brand">AMPHON TRADING</div><div class="title">${escapeHtml(title)}</div><div class="sku">${escapeHtml(draft.sku || "")}</div>${price ? `<div class="price">${escapeHtml(price)}</div>` : ""}<img class="barcode" src="${codes.barcodeDataUrl}"></div></div><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500)}</script></body></html>`,
    );
    popup.document.close();
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-sheet label-sheet">
        <div className="modal-head">
          <div>
            <p className="eyebrow">PRODUCT LABEL</p>
            <h2>พิมพ์ฉลากสินค้า</h2>
            <small>{draft.sku}</small>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        <label className="field">
          <span>ขนาดสติกเกอร์</span>
          <select
            value={size}
            onChange={(event) =>
              setSize(event.target.value as "70x40" | "50x30")
            }
          >
            <option value="70x40">70 × 40 mm — แนะนำ</option>
            <option value="50x30">50 × 30 mm — ขนาดเล็ก</option>
          </select>
        </label>
        <div className={`label-preview label-${size}`}>
          <img className="label-qr" src={codes.qrDataUrl} />
          <div>
            <span>AMPHON TRADING</span>
            <strong>{title}</strong>
            <b>{draft.sku}</b>
            {price && <em>{price}</em>}
            <img className="label-barcode" src={codes.barcodeDataUrl} />
          </div>
        </div>
        <div className="guard-note">
          <QrCode /> QR เปิด Product Hub ตรงสินค้านี้ ส่วน Barcode ด้านล่างเก็บ
          SKU เดียวกัน
        </div>
        <button className="primary-wide" onClick={printLabel}>
          <Printer size={18} /> พิมพ์ / บันทึกเป็น PDF
        </button>
        <button className="secondary-wide" onClick={onClose}>
          ปิด
        </button>
      </div>
    </div>
  );
}

function ActivityTimeline({
  activity,
  loading,
}: {
  activity: ProductActivity[];
  loading: boolean;
}) {
  if (loading)
    return (
      <section className="activity-card">
        <strong>ประวัติการทำรายการ</strong>
        <div className="activity-loading">
          <LoaderCircle className="spin" size={15} /> กำลังโหลด...
        </div>
      </section>
    );
  return (
    <section className="activity-card">
      <div className="activity-title">
        <strong>ประวัติการทำรายการ</strong>
        <small>Owner/Admin เท่านั้น</small>
      </div>
      {activity.length === 0 ? (
        <p className="activity-empty">ยังไม่มีประวัติ</p>
      ) : (
        <div className="activity-list">
          {activity.slice(0, 12).map((item) => (
            <div className="activity-row" key={item.id}>
              <span className="activity-dot" />
              <div>
                <strong>{activityActionText(item)}</strong>
                <small>
                  {item.actorName || "ระบบ"} ·{" "}
                  {new Date(item.createdAt).toLocaleString("th-TH", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function activityActionText(item: ProductActivity) {
  const meta = item.metadata || {};
  switch (item.action) {
    case "product_created":
      return "สร้างสินค้า";
    case "product_updated":
      return "แก้ไขข้อมูลสินค้า";
    case "product_saved":
      return `บันทึกสินค้า · ${statusText(String(meta.status || ""))}`;
    case "status_changed":
      return `เปลี่ยนสถานะ ${statusText(String(meta.from || ""))} → ${statusText(String(meta.to || ""))}`;
    case "identifier_changed":
      return "แก้ไข Serial / IMEI";
    case "images_uploaded":
      return `อัปโหลดรูป ${Number(meta.count || 0)} รูป`;
    case "images_deleted":
      return `ลบรูป ${Number(meta.count || 0)} รูป`;
    case "image_upload_incomplete":
      return "อัปโหลดรูปไม่ครบ — รอ Retry";
    case "quick_status_action":
      return `Quick Action → ${statusText(String(meta.status || ""))}`;
    case "product_deleted":
      return "ลบสินค้า";
    default:
      return item.action;
  }
}

function SalesToolkit({
  draft,
  profile,
}: {
  draft: ProductDraft;
  profile: Profile;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [salesPackageOpen, setSalesPackageOpen] = useState(false);
  const [marketplaceAssistantOpen, setMarketplaceAssistantOpen] =
    useState(false);
  const [shopeeAssistantOpen, setShopeeAssistantOpen] = useState(false);
  const [channel, setChannel] = useState<ContentChannel>("facebook");
  const imageExport = useProductImageExport(draft);
  const specs = useMemo(() => buildSpecText(draft), [draft]);
  const content = useMemo(
    () => buildContentForChannel(draft, channel),
    [draft, channel],
  );
  const activeTemplate =
    contentTemplates.find((template) => template.id === channel) ??
    contentTemplates[0];
  const shopeeParts = useMemo(() => buildShopeeContentParts(draft), [draft]);
  const remoteImageCount = draft.images.filter(
    (image) => image.publicUrl,
  ).length;

  async function copy(value: string, label: string) {
    try {
      await copyText(value);
      setMessage(`✓ ${label}แล้ว`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <>
      <section className="sales-toolkit">
        <div className="sales-toolkit-head">
          <div>
            <span className="toolkit-icon">
              <FileText size={18} />
            </span>
            <div>
              <strong>Sales Toolkit</strong>
              <small>เลือกช่องทางแล้วก๊อปไปลงขายได้ทันที</small>
            </div>
          </div>
          <span className="image-count">{remoteImageCount} รูป</span>
        </div>
        <button
          type="button"
          className="sales-package-launch"
          onClick={() => setSalesPackageOpen(true)}
        >
          <ShoppingBag size={20} />
          <span>
            <strong>เตรียมโพสต์ขาย</strong>
            <small>รูป ข้อความ ราคา สเปก และลิงก์ SHOP ในชุดเดียว</small>
          </span>
          <ChevronRight />
        </button>
        <button
          type="button"
          className="marketplace-assistant-launch"
          onClick={() => setMarketplaceAssistantOpen(true)}
        >
          <ShoppingCart size={20} />
          <span>
            <strong>ผู้ช่วยลง Marketplace</strong>
            <small>
              ชื่อ ราคา หมวดหมู่ รายละเอียด และ checklist พร้อมคัดลอก
            </small>
          </span>
          <ChevronRight />
        </button>
        <button
          type="button"
          className="shopee-assistant-launch"
          onClick={() => setShopeeAssistantOpen(true)}
        >
          <ShoppingBag size={20} />
          <span>
            <strong>ผู้ช่วยลง Shopee</strong>
            <small>
              ราคา Shopee +18% ตายตัว · ชื่อ SKU สต๊อก รายละเอียด และ checklist
            </small>
          </span>
          <ChevronRight />
        </button>
        <ProductImageExportControls draft={draft} imageExport={imageExport} />
        <div className="toolkit-actions">
          <button type="button" onClick={() => void copy(specs, "ก๊อปสเปก")}>
            <ClipboardCopy size={18} />
            <span>ก๊อปสเปก</span>
          </button>
          <button
            type="button"
            className="content-copy-button"
            onClick={() =>
              void copy(content, `ก๊อป ${activeTemplate.shortLabel}`)
            }
          >
            <ClipboardCopy size={18} />
            <span>ก๊อป {activeTemplate.shortLabel}</span>
          </button>
        </div>
        {message && <div className="toolkit-message">{message}</div>}
        <div className="content-template-panel">
          <div className="content-template-head">
            <strong>Content Template</strong>
            <small>{activeTemplate.description}</small>
          </div>
          <div
            className="template-tabs"
            role="tablist"
            aria-label="เลือกช่องทางคอนเทนต์"
          >
            {contentTemplates.map((template) => (
              <button
                type="button"
                key={template.id}
                className={channel === template.id ? "active" : ""}
                onClick={() => setChannel(template.id)}
              >
                {template.shortLabel}
              </button>
            ))}
          </div>
          {channel === "shopee" ? (
            <div className="content-preview-box shopee-content-preview">
              <div className="content-preview-label">
                <span>Shopee · หัวข้อ / ราคา / เนื้อหาหลัก · +18%</span>
                <button
                  type="button"
                  onClick={() => void copy(shopeeParts.all, "ก๊อป Shopee ทั้งหมด")}
                >
                  <ClipboardCopy size={15} /> ก๊อปทั้งหมด
                </button>
              </div>
              <div className="shopee-content-part">
                <div>
                  <span>หัวข้อ</span>
                  <button
                    type="button"
                    onClick={() => void copy(shopeeParts.title, "ก๊อปหัวข้อ Shopee")}
                  >
                    <ClipboardCopy size={14} /> ก๊อป
                  </button>
                </div>
                <pre>{shopeeParts.title}</pre>
              </div>
              <div className="shopee-content-part shopee-price-part">
                <div>
                  <span>ราคา</span>
                  <button
                    type="button"
                    onClick={() => void copy(String(shopeeParts.priceValue), "ก๊อปราคา Shopee")}
                    disabled={!shopeeParts.priceValue}
                  >
                    <ClipboardCopy size={14} /> ก๊อป
                  </button>
                </div>
                <pre>{shopeeParts.price}</pre>
                <small>คำนวณจากราคา Hub +18% และปัดขึ้นหลักสิบ</small>
              </div>
              <div className="shopee-content-part">
                <div>
                  <span>เนื้อหาหลัก</span>
                  <button
                    type="button"
                    onClick={() => void copy(shopeeParts.body, "ก๊อปเนื้อหา Shopee")}
                  >
                    <ClipboardCopy size={14} /> ก๊อป
                  </button>
                </div>
                <pre>{shopeeParts.body}</pre>
              </div>
            </div>
          ) : (
            <div className="content-preview-box">
              <div className="content-preview-label">
                <span>{activeTemplate.label}</span>
                <button
                  type="button"
                  onClick={() =>
                    void copy(content, `ก๊อป ${activeTemplate.shortLabel}`)
                  }
                >
                  <ClipboardCopy size={15} /> ก๊อป
                </button>
              </div>
              <pre>{content}</pre>
            </div>
          )}
        </div>
        <p className="toolkit-note">
          ZIP จะมีรูปทั้งหมด + spec.txt + Content สำหรับ Facebook, Marketplace,
          Shopee, WINNER IT และข้อความกลาง โดยไม่มีข้อมูลต้นทุน
        </p>
        {salesPackageOpen && (
          <Suspense
            fallback={
              <div className="sales-package-loading">
                <LoaderCircle className="spin" />
                กำลังเปิดชุดโพสต์ขาย...
              </div>
            }
          >
            <SalesPostPackagePanel
              draft={draft}
              imageExport={imageExport}
              onClose={() => setSalesPackageOpen(false)}
            />
          </Suspense>
        )}
        {marketplaceAssistantOpen && (
          <Suspense
            fallback={
              <div className="sales-package-loading">
                <LoaderCircle className="spin" />
                กำลังเปิดผู้ช่วย Marketplace...
              </div>
            }
          >
            <MarketplaceListingAssistant
              draft={draft}
              imageExport={imageExport}
              onClose={() => setMarketplaceAssistantOpen(false)}
            />
          </Suspense>
        )}
        {shopeeAssistantOpen && (
          <Suspense
            fallback={
              <div className="sales-package-loading">
                <LoaderCircle className="spin" />
                กำลังเปิดผู้ช่วย Shopee...
              </div>
            }
          >
            <ShopeeListingAssistant
              draft={draft}
              imageExport={imageExport}
              onClose={() => setShopeeAssistantOpen(false)}
            />
          </Suspense>
        )}
      </section>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            onChange(event.target.value)
          }
          placeholder={placeholder}
          rows={3}
        />
      ) : (
        <input
          value={value}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            onChange(event.target.value)
          }
          placeholder={placeholder}
          inputMode={inputMode}
        />
      )}
    </label>
  );
}

function ProductCard({
  product,
  onClick,
}: {
  product: ProductSummary;
  onClick: () => void;
}) {
  const cover =
    product.images.find((image) => image.isCover) || product.images[0];
  return (
    <button className="product-card" onClick={onClick}>
      {cover?.publicUrl ? (
        <img
          className="product-thumb image"
          src={cover.publicUrl}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className="product-thumb">{categoryIcon(product.category)}</div>
      )}
      <div className="product-copy">
        <div className="product-top">
          <h3>{product.title}</h3>
          <Status status={product.status} />
        </div>
        <p>{productSubtitle(product) || "ยังไม่มีรายละเอียดสเปก"}</p>
        <div className="product-meta">
          <strong>{baht(product.price)}</strong>
          <span>{product.sku}</span>
        </div>
      </div>
    </button>
  );
}

function categoryIcon(category: ProductCategory) {
  return getCategoryDefinition(category)?.icon ?? "📦";
}

function statusText(status: string) {
  const map: Record<string, string> = {
    draft: "ร่าง",
    photo_ready: "รูปพร้อม",
    ready_to_list: "พร้อมลงขาย",
    published: "เผยแพร่แล้ว",
    reserved: "จองแล้ว",
    sold: "ขายแล้ว",
    repair: "ซ่อม/ตรวจเช็ก",
    consignment: "ฝากขาย",
    returned: "คืนสินค้า",
    cancelled: "ยกเลิก",
  };
  return map[status] ?? status;
}

function Status({ status }: { status: string }) {
  return (
    <span className={`status status-${status}`}>{statusText(status)}</span>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className={`stat ${tone}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={active ? "chip active" : "chip"} onClick={onClick}>
      {label}
    </button>
  );
}

function EmptyInventory({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty-state">
      <Package />
      <strong>ยังไม่มีสินค้าในระบบ</strong>
      <span>เพิ่มรายการแรกจากมือถือได้เลย</span>
      <button onClick={onAdd}>+ เพิ่มสินค้า</button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="product-list">
      {[1, 2, 3].map((value) => (
        <div className="product-card skeleton-card" key={value}>
          <div className="product-thumb skeleton" />
          <div className="product-copy">
            <div className="skeleton line wide" />
            <div className="skeleton line" />
            <div className="skeleton line short" />
          </div>
        </div>
      ))}
    </div>
  );
}

function roleLabel(role: Profile["role"]) {
  return {
    owner: "Owner",
    admin: "Admin",
    sales: "Sales",
    technician: "Technician",
  }[role];
}

function EmployeeManagementScreen({
  profile,
  onBack,
}: {
  profile: Profile;
  onBack: () => void;
}) {
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [activity, setActivity] = useState<EmployeeActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<EmployeeSummary | null>(null);
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [e, a] = await Promise.all([
        listEmployees(),
        listEmployeeActivity(),
      ]);
      setEmployees(e);
      setActivity(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const filtered = employees.filter((e) =>
    [e.displayName, e.email, roleLabel(e.role)].some((v) =>
      v.toLowerCase().includes(query.toLowerCase()),
    ),
  );
  const activeCount = employees.filter((e) => e.active).length;
  return (
    <section className="screen page-pad employee-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack}>
          <ChevronLeft />
        </button>
        <div className="employee-title">
          <p className="eyebrow">TEAM</p>
          <h1>พนักงาน</h1>
        </div>
        <button className="refresh-button" onClick={() => void refresh()}>
          <RefreshCw className={loading ? "spin" : ""} />
        </button>
      </header>
      {error && <InlineError message={error} onRetry={() => void refresh()} />}
      <div className="employee-summary">
        <div>
          <Users />
          <span>พนักงานทั้งหมด</span>
          <b>{employees.length}</b>
        </div>
        <div>
          <CheckCircle2 />
          <span>ใช้งานอยู่</span>
          <b>{activeCount}</b>
        </div>
      </div>
      <button className="primary-add" onClick={() => setCreateOpen(true)}>
        <UserPlus /> เพิ่มพนักงาน
      </button>
      <label className="searchbox">
        <Search size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาชื่อ / อีเมล / Role"
        />
      </label>
      {loading && !employees.length ? (
        <ListSkeleton />
      ) : (
        <div className="employee-list">
          {filtered.map((e) => (
            <button
              className="employee-card"
              key={e.id}
              onClick={() => setSelected(e)}
            >
              <div className="profile-avatar">{initials(e.displayName)}</div>
              <div>
                <strong>{e.displayName}</strong>
                <small>{e.email}</small>
                <span>
                  {roleLabel(e.role)} · {e.active ? "ใช้งานอยู่" : "ปิดใช้งาน"}
                </span>
              </div>
              <ChevronRight />
            </button>
          ))}
        </div>
      )}
      <section className="activity-card employee-audit">
        <div className="activity-title">
          <strong>ประวัติจัดการพนักงาน</strong>
          <small>ล่าสุด {activity.length} รายการ</small>
        </div>
        {activity.slice(0, 10).map((a) => (
          <div className="activity-row" key={a.id}>
            <span className="activity-dot" />
            <div>
              <strong>{employeeActionText(a)}</strong>
              <small>
                {a.actorName} ·{" "}
                {new Date(a.createdAt).toLocaleString("th-TH", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </small>
            </div>
          </div>
        ))}
      </section>
      {createOpen && (
        <CreateEmployeeModal
          profile={profile}
          busy={busy}
          onClose={() => setCreateOpen(false)}
          onCreate={async (input) => {
            setBusy(true);
            try {
              const result = await createEmployee(input);
              setCredentials({
                email: result.employee.email,
                password: result.temporaryPassword,
              });
              setCreateOpen(false);
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}{" "}
      {selected && (
        <EditEmployeeModal
          actor={profile}
          employee={selected}
          busy={busy}
          onClose={() => setSelected(null)}
          onSave={async (patch) => {
            setBusy(true);
            try {
              await updateEmployee(selected.id, patch);
              setSelected(null);
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
          onReset={async () => {
            if (
              !window.confirm(
                `รีเซ็ตรหัสผ่านของ ${selected.displayName} หรือไม่?`,
              )
            )
              return;
            setBusy(true);
            try {
              const password = await resetEmployeePassword(selected.id);
              setCredentials({ email: selected.email, password });
              setSelected(null);
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}{" "}
      {credentials && (
        <CredentialModal
          email={credentials.email}
          password={credentials.password}
          onClose={() => setCredentials(null)}
        />
      )}
    </section>
  );
}

function CreateEmployeeModal({
  profile,
  busy,
  onClose,
  onCreate,
}: {
  profile: Profile;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: {
    email: string;
    displayName: string;
    role: Profile["role"];
  }) => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Profile["role"]>("sales");
  const roles: Profile["role"][] =
    profile.role === "owner"
      ? ["sales", "technician", "admin", "owner"]
      : ["sales", "technician"];
  return (
    <div className="modal-backdrop">
      <div className="modal-sheet">
        <div className="modal-head">
          <div>
            <p className="eyebrow">NEW EMPLOYEE</p>
            <h2>เพิ่มพนักงาน</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="form-stack">
          <Field
            label="ชื่อพนักงาน"
            value={displayName}
            onChange={setDisplayName}
            placeholder="เช่น นัท"
          />
          <Field
            label="อีเมล"
            value={email}
            onChange={setEmail}
            placeholder="name@example.com"
            inputMode="email"
          />
          <label className="field">
            <span>Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Profile["role"])}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <div className="guard-note">
            <ShieldCheck />{" "}
            ระบบจะสร้างรหัสผ่านชั่วคราวและบังคับให้พนักงานตั้งรหัสใหม่ตอน Login
            ครั้งแรก
          </div>
          <button
            className="primary-wide"
            disabled={busy || !displayName.trim() || !email.includes("@")}
            onClick={() =>
              onCreate({
                email: email.trim(),
                displayName: displayName.trim(),
                role,
              })
            }
          >
            {busy ? "กำลังสร้าง..." : "สร้างบัญชีพนักงาน"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditEmployeeModal({
  actor,
  employee,
  busy,
  onClose,
  onSave,
  onReset,
}: {
  actor: Profile;
  employee: EmployeeSummary;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: {
    displayName?: string;
    role?: Profile["role"];
    active?: boolean;
  }) => void;
  onReset: () => void;
}) {
  const [name, setName] = useState(employee.displayName);
  const [role, setRole] = useState(employee.role);
  const [active, setActive] = useState(employee.active);
  const privileged = ["owner", "admin"].includes(employee.role);
  const canManageAccess =
    actor.id !== employee.id && !(actor.role === "admin" && privileged);
  const roles: Profile["role"][] =
    actor.role === "owner"
      ? ["sales", "technician", "admin", "owner"]
      : ["sales", "technician"];
  return (
    <div className="modal-backdrop">
      <div className="modal-sheet">
        <div className="modal-head">
          <div>
            <p className="eyebrow">EMPLOYEE</p>
            <h2>{employee.displayName}</h2>
            <small>{employee.email}</small>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="form-stack">
          <Field
            label="ชื่อพนักงาน"
            value={name}
            onChange={setName}
            placeholder="ชื่อพนักงาน"
          />
          <label className="field">
            <span>Role</span>
            <select
              value={role}
              disabled={!canManageAccess}
              onChange={(e) => setRole(e.target.value as Profile["role"])}
            >
              {roles.includes(role) || !canManageAccess ? (
                <option value={role}>{roleLabel(role)}</option>
              ) : null}
              {roles
                .filter((r) => r !== role)
                .map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
            </select>
          </label>
          <label className="toggle-row">
            <span>
              <Power /> เปิดใช้งานบัญชี
            </span>
            <input
              type="checkbox"
              checked={active}
              disabled={!canManageAccess}
              onChange={(e) => setActive(e.target.checked)}
            />
          </label>
          {!canManageAccess && (
            <div className="guard-note">
              <ShieldCheck /> เพื่อความปลอดภัย
              บัญชีนี้ไม่สามารถเปลี่ยนสิทธิ์จากผู้ใช้ปัจจุบันได้
            </div>
          )}
          <button
            className="primary-wide"
            disabled={busy}
            onClick={() =>
              onSave({
                displayName: name.trim(),
                ...(canManageAccess ? { role, active } : {}),
              })
            }
          >
            {busy ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
          </button>
          <button
            className="secondary-wide"
            disabled={busy || (actor.role === "admin" && privileged)}
            onClick={onReset}
          >
            <KeyRound /> รีเซ็ตรหัสผ่าน
          </button>
        </div>
      </div>
    </div>
  );
}

function CredentialModal({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="modal-backdrop">
      <div className="modal-sheet credential-sheet">
        <div className="modal-head">
          <div>
            <p className="eyebrow">TEMPORARY LOGIN</p>
            <h2>รหัสผ่านชั่วคราว</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        <p className="credential-warning">
          ส่งข้อมูลนี้ให้พนักงานโดยตรง รหัสผ่านจะแสดงในหน้านี้ครั้งเดียว
          และระบบจะบังคับเปลี่ยนเมื่อ Login
        </p>
        <div className="credential-box">
          <small>อีเมล</small>
          <strong>{email}</strong>
          <small>รหัสผ่านชั่วคราว</small>
          <code>{password}</code>
        </div>
        <button
          className="primary-wide"
          onClick={async () => {
            await copyText(`Email: ${email}\nPassword: ${password}`);
            setCopied(true);
          }}
        >
          <Copy /> {copied ? "ก๊อปแล้ว" : "ก๊อปข้อมูลเข้าสู่ระบบ"}
        </button>
        <button className="secondary-wide" onClick={onClose}>
          ปิด
        </button>
      </div>
    </div>
  );
}

function employeeActionText(item: EmployeeActivity) {
  if (item.action === "employee_created")
    return `สร้างบัญชี ${item.targetName || ""}`;
  if (item.action === "employee_password_reset")
    return `รีเซ็ตรหัสผ่าน ${item.targetName || ""}`;
  if (item.action === "employee_updated")
    return `แก้ไขบัญชี ${item.targetName || ""}`;
  return item.action;
}

function ProfileScreen({
  profile,
  onEmployees,
  onSignOut,
}: {
  profile: Profile;
  onEmployees: () => void;
  onSignOut: () => void;
}) {
  const [passwordOpen, setPasswordOpen] = useState(false);
  return (
    <section className="screen page-pad">
      <header className="topbar">
        <div>
          <p className="eyebrow">ACCOUNT</p>
          <h1>ฉัน</h1>
        </div>
      </header>
      <div className="profile-card">
        <div className="profile-avatar">{initials(profile.displayName)}</div>
        <div>
          <strong>{profile.displayName}</strong>
          <p>{roleLabel(profile.role)} · AMPHON TRADING</p>
        </div>
      </div>
      <div className="settings-list">
        {["owner", "admin"].includes(profile.role) && (
          <button onClick={onEmployees}>
            <span>
              <Users size={18} /> จัดการพนักงาน
            </span>
            <ChevronRight />
          </button>
        )}
        <button onClick={() => setPasswordOpen(true)}>
          <span>
            <KeyRound size={18} /> เปลี่ยนรหัสผ่าน
          </span>
          <ChevronRight />
        </button>
        <button disabled>
          <span>
            ตั้งค่าหมวดสินค้า <small className="soon">Batch ถัดไป</small>
          </span>
          <ChevronRight />
        </button>
        <button disabled>
          <span>
            การเชื่อมต่อระบบ <small className="soon">Batch ถัดไป</small>
          </span>
          <ChevronRight />
        </button>
        <button className="logout-row" onClick={onSignOut}>
          <span>
            <LogOut size={18} /> ออกจากระบบ
          </span>
          <ChevronRight />
        </button>
      </div>
      {passwordOpen && (
        <SelfPasswordModal onClose={() => setPasswordOpen(false)} />
      )}
    </section>
  );
}

function SelfPasswordModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function save() {
    if (!supabase) return;
    if (password.length < 10) return setMessage("อย่างน้อย 10 ตัวอักษร");
    if (password !== confirm) return setMessage("รหัสผ่านไม่ตรงกัน");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMessage("✓ เปลี่ยนรหัสผ่านแล้ว");
      setTimeout(onClose, 700);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <div className="modal-sheet">
        <div className="modal-head">
          <h2>เปลี่ยนรหัสผ่าน</h2>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="form-stack">
          <label className="field">
            <span>รหัสผ่านใหม่</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="field">
            <span>ยืนยันรหัสผ่าน</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {message && <div className="auth-message">{message}</div>}
          <button
            className="primary-wide"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "กำลังบันทึก..." : "เปลี่ยนรหัสผ่าน"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BottomNav({
  tab,
  setTab,
  onAdd,
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  onAdd: () => void;
}) {
  return (
    <nav className="bottom-nav">
      <button
        className={tab === "home" ? "active" : ""}
        onClick={() => setTab("home")}
      >
        <Home />
        <span>หน้าแรก</span>
      </button>
      <button
        className={
          tab === "products" || tab === "publish" || tab === "orders"
            ? "active"
            : ""
        }
        onClick={() => setTab("products")}
      >
        <Package />
        <span>สินค้า</span>
      </button>
      <button className="fab" onClick={onAdd}>
        <CirclePlus />
        <span>เพิ่ม</span>
      </button>
      <button
        className={tab === "scanner" ? "active" : ""}
        onClick={() => setTab("scanner")}
      >
        <ScanLine />
        <span>สแกน</span>
      </button>
      <button
        className={tab === "profile" ? "active" : ""}
        onClick={() => setTab("profile")}
      >
        <UserRound />
        <span>ฉัน</span>
      </button>
    </nav>
  );
}

export default App;
