import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  PlayCircle,
  RefreshCw,
  UserRound,
  XCircle,
} from "lucide-react";
import {
  cancelSalesChannelTask,
  claimSalesChannelTask,
  completeSalesChannelTask,
  countActiveSalesChannelTasks,
  isActiveTaskStatus,
  listSalesChannelTasks,
  removeSalesChannelTaskChannel,
  subscribeSalesChannelTasks,
} from "../lib/cleanupTasks";
import { publicationChannels } from "../lib/publications";
import type {
  ProductPublication,
  ProductSummary,
  Profile,
  SalesChannelTask,
  SalesChannelTaskStatus,
} from "../types/product";
import "../styles/cleanupTasks.css";

const statusText: Record<SalesChannelTaskStatus, string> = {
  OPEN: "ต้องปิดประกาศ",
  IN_PROGRESS: "กำลังดำเนินการ",
  COMPLETED: "เสร็จแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
};

function taskInstruction(task: SalesChannelTask) {
  if (task.taskType === "REMOVE_LISTING") return "ปิดประกาศภายนอก";
  if (task.taskType === "UPDATE_LISTING")
    return "อัปเดตเป็นขายแล้วหรือปิดโพสต์ตามนโยบายร้าน";
  return "ตรวจสอบว่าประกาศถูกปิดแล้ว";
}

function TaskCard({
  task,
  product,
  publication,
  profile,
  busy,
  onAction,
}: {
  task: SalesChannelTask;
  product?: ProductSummary;
  publication?: ProductPublication;
  profile: Profile;
  busy: boolean;
  onAction: (
    action: "claim" | "start" | "complete" | "cancel",
    task: SalesChannelTask,
  ) => void;
}) {
  const channel = publicationChannels.find((item) => item.id === task.channel);
  const mine = task.assignedTo === profile.id;
  const canControl =
    !task.assignedTo || mine || ["owner", "admin"].includes(profile.role);
  return (
    <article
      className={`cleanup-task-card priority-${task.priority.toLowerCase()} status-${task.status.toLowerCase()}`}
    >
      <div className="cleanup-task-head">
        <div>
          <span>{channel?.emoji}</span>
          <div>
            <strong>{channel?.label || task.channel}</strong>
            <small>{taskInstruction(task)}</small>
          </div>
        </div>
        <b>{statusText[task.status]}</b>
      </div>
      <div className="cleanup-task-product">
        <strong>{product?.title || "สินค้า"}</strong>
        <span>
          {product?.sku || task.productId} ·{" "}
          {task.priority === "HIGH" ? "สำคัญ" : "ปกติ"}
        </span>
      </div>
      <div className="cleanup-task-meta">
        <span>ผู้โพสต์: {publication?.publishedByName || "ไม่ระบุ"}</span>
        <span>
          โพสต์เมื่อ:{" "}
          {publication?.publishedAt
            ? new Date(publication.publishedAt).toLocaleString("th-TH")
            : "ไม่ระบุ"}
        </span>
        <span>ผู้รับงาน: {task.assignedToName || "ยังไม่มีผู้รับ"}</span>
      </div>
      <div className="cleanup-task-actions">
        {publication?.externalUrl ? (
          <a
            href={publication.externalUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLink /> เปิดประกาศ
          </a>
        ) : (
          <span className="cleanup-no-link">ไม่มีลิงก์ประกาศที่บันทึกไว้</span>
        )}
        {task.status === "OPEN" && !task.assignedTo && (
          <button disabled={busy} onClick={() => onAction("claim", task)}>
            <UserRound /> รับงานนี้
          </button>
        )}
        {task.status === "OPEN" && canControl && (
          <button disabled={busy} onClick={() => onAction("start", task)}>
            <PlayCircle /> เริ่มดำเนินการ
          </button>
        )}
        {isActiveTaskStatus(task.status) && canControl && (
          <button
            className="task-complete"
            disabled={busy}
            onClick={() => onAction("complete", task)}
          >
            {busy ? <LoaderCircle className="spin" /> : <CheckCircle2 />}{" "}
            ทำเครื่องหมายว่าจัดการแล้ว
          </button>
        )}
        {isActiveTaskStatus(task.status) &&
          ["owner", "admin"].includes(profile.role) && (
            <button
              className="task-cancel"
              disabled={busy}
              onClick={() => onAction("cancel", task)}
            >
              <XCircle /> ยกเลิกงาน
            </button>
          )}
      </div>
      {task.completedAt && (
        <small className="cleanup-task-audit">
          ยืนยันโดย {task.completedByName || "พนักงาน"} ·{" "}
          {new Date(task.completedAt).toLocaleString("th-TH")}
        </small>
      )}
      {task.cancellationReason && (
        <small className="cleanup-task-audit">
          เหตุผลยกเลิก: {task.cancellationReason}
        </small>
      )}
    </article>
  );
}

export function CleanupTaskQueue({
  profile,
  products,
  publications,
  onChanged,
}: {
  profile: Profile;
  products: ProductSummary[];
  publications: ProductPublication[];
  onChanged: () => Promise<void> | void;
}) {
  const [tasks, setTasks] = useState<SalesChannelTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("ACTIVE");
  const [channel, setChannel] = useState("all");
  const [owner, setOwner] = useState("all");
  const [priority, setPriority] = useState("all");
  const [query, setQuery] = useState("");

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      setTasks(await listSalesChannelTasks());
      setError(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    let timer: number | undefined;
    const subscription = subscribeSalesChannelTasks(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(true), 300);
    });
    return () => {
      window.clearTimeout(timer);
      if (subscription) void removeSalesChannelTaskChannel(subscription);
    };
  }, [profile.id]);

  const productById = useMemo(
    () => new Map(products.map((item) => [item.id, item])),
    [products],
  );
  const publicationById = useMemo(
    () => new Map(publications.map((item) => [item.id, item])),
    [publications],
  );
  const filtered = useMemo(
    () =>
      tasks.filter((task) => {
        if (
          status === "ACTIVE"
            ? !isActiveTaskStatus(task.status)
            : status !== "all" && task.status !== status
        )
          return false;
        if (channel !== "all" && task.channel !== channel) return false;
        if (owner === "mine" && task.assignedTo !== profile.id) return false;
        if (owner === "unassigned" && task.assignedTo) return false;
        if (priority !== "all" && task.priority !== priority) return false;
        const product = productById.get(task.productId);
        const q = query.trim().toLowerCase();
        return (
          !q ||
          [product?.sku || "", product?.title || "", task.channel].some(
            (value) => value.toLowerCase().includes(q),
          )
        );
      }),
    [tasks, status, channel, owner, priority, query, profile.id, productById],
  );
  const urgent = filtered.filter(
    (task) => task.priority === "HIGH" && isActiveTaskStatus(task.status),
  );
  const remaining = filtered.filter((task) => !urgent.includes(task));

  async function act(
    action: "claim" | "start" | "complete" | "cancel",
    task: SalesChannelTask,
  ) {
    if (busy) return;
    setError(null);
    if ((action === "start" || action === "complete") && !navigator.onLine) {
      setError("ต้องออนไลน์เพื่อยืนยันสถานะงาน");
      return;
    }
    if (action === "complete") {
      const channelName =
        publicationChannels.find((item) => item.id === task.channel)?.label ||
        task.channel;
      const text =
        task.taskType === "REMOVE_LISTING"
          ? `ยืนยันว่าคุณได้ปิดประกาศบน ${channelName} แล้ว`
          : `ยืนยันว่าคุณได้อัปเดตหรือปิดโพสต์บน ${channelName} แล้ว`;
      if (
        !window.confirm(
          text + "\n\nนี่คือคำยืนยันของพนักงาน ระบบไม่ได้ตรวจสอบจาก Facebook",
        )
      )
        return;
    }
    let reason = "";
    if (action === "cancel") {
      reason =
        window
          .prompt("ระบุเหตุผลที่ยกเลิกงาน (ประวัติจะยังคงอยู่)", "")
          ?.trim() || "";
      if (!reason) return;
    }
    setBusy(task.id);
    try {
      if (action === "claim") await claimSalesChannelTask(task.id, false);
      if (action === "start") await claimSalesChannelTask(task.id, true);
      if (action === "complete")
        await completeSalesChannelTask(task.id, crypto.randomUUID());
      if (action === "cancel") await cancelSalesChannelTask(task.id, reason);
      await Promise.all([refresh(true), onChanged()]);
    } catch (nextError) {
      setError(
        action === "complete"
          ? "บันทึกสถานะไม่สำเร็จ กรุณาลองอีกครั้ง"
          : nextError instanceof Error
            ? nextError.message
            : String(nextError),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="cleanup-task-queue" data-hub6-cleanup-task-queue>
      <header>
        <div>
          <strong>งานปิดประกาศ</strong>
          <small>
            สร้างจากสถานะ SOLD · พนักงานจัดการช่องทางภายนอกด้วยตนเอง
          </small>
        </div>
        <button onClick={() => void refresh()} aria-label="รีเฟรชงาน">
          <RefreshCw className={loading ? "spin" : ""} />
        </button>
      </header>
      <div className="cleanup-task-filters">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ค้นหาสินค้า / SKU"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="ACTIVE">งานค้าง</option>
          <option value="all">ทุกสถานะ</option>
          <option value="COMPLETED">เสร็จแล้ว</option>
          <option value="CANCELLED">ยกเลิกแล้ว</option>
        </select>
        <select
          value={channel}
          onChange={(event) => setChannel(event.target.value)}
        >
          <option value="all">ทุกช่องทาง</option>
          {publicationChannels
            .filter((item) => item.soldCleanupTaskType)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
        </select>
        <select
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
        >
          <option value="all">พนักงานทั้งหมด</option>
          <option value="mine">งานของฉัน</option>
          <option value="unassigned">ยังไม่รับงาน</option>
        </select>
        <select
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        >
          <option value="all">ทุก priority</option>
          <option value="HIGH">สำคัญ</option>
          <option value="NORMAL">ปกติ</option>
        </select>
      </div>
      {error && <div className="publish-error">{error}</div>}
      {loading && !tasks.length ? (
        <div className="publish-loading">
          <LoaderCircle className="spin" /> กำลังโหลดงาน
        </div>
      ) : (
        <>
          {!!urgent.length && (
            <div className="cleanup-task-section">
              <h3>
                <AlertTriangle /> ต้องทำทันที <b>{urgent.length}</b>
              </h3>
              {urgent.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  product={productById.get(task.productId)}
                  publication={publicationById.get(task.publicationId)}
                  profile={profile}
                  busy={busy === task.id}
                  onAction={act}
                />
              ))}
            </div>
          )}
          {!!remaining.length && (
            <div className="cleanup-task-section">
              <h3>
                งานทั้งหมด <b>{remaining.length}</b>
              </h3>
              {remaining.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  product={productById.get(task.productId)}
                  publication={publicationById.get(task.publicationId)}
                  profile={profile}
                  busy={busy === task.id}
                  onAction={act}
                />
              ))}
            </div>
          )}
          {!filtered.length && (
            <div className="cleanup-task-empty">
              <CheckCircle2 />
              <strong>ไม่มีงานปิดประกาศในตัวกรองนี้</strong>
              <span>
                ระบบจะสร้างงานเมื่อสินค้าขายแล้วและยังมีประกาศภายนอกที่ active
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function CleanupTaskCountCard({ onOpen }: { onOpen: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    void countActiveSalesChannelTasks()
      .then(setCount)
      .catch(() => setCount(null));
  }, []);
  return (
    <button className="cleanup-count-card" onClick={onOpen}>
      <AlertTriangle />
      <span>
        <strong>งานปิดประกาศ</strong>
        <small>
          {count === null
            ? "กำลังตรวจสอบงานค้าง"
            : `${count} งานค้าง · แตะเพื่อจัดการ`}
        </small>
      </span>
      <b>{count ?? "–"}</b>
    </button>
  );
}

export function ProductCleanupTaskNotice({
  productId,
}: {
  productId?: string;
}) {
  const [tasks, setTasks] = useState<SalesChannelTask[]>([]);
  useEffect(() => {
    if (productId)
      void listSalesChannelTasks(productId)
        .then((items) =>
          setTasks(items.filter((item) => isActiveTaskStatus(item.status))),
        )
        .catch(() => setTasks([]));
  }, [productId]);
  if (!tasks.length) return null;
  return (
    <div className="product-cleanup-task-notice">
      <AlertTriangle />
      <div>
        <strong>
          ขายแล้ว — มีประกาศภายนอกที่ต้องจัดการ {tasks.length} รายการ
        </strong>
        <small>
          {tasks
            .map(
              (task) =>
                publicationChannels.find((item) => item.id === task.channel)
                  ?.label,
            )
            .filter(Boolean)
            .join(", ")}
        </small>
      </div>
    </div>
  );
}
