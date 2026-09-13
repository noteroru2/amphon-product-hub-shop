import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type {
  SalesChannelTask,
  SalesChannelTaskStatus,
} from "../types/product";

function client() {
  if (!supabase) throw new Error("ยังไม่ได้ตั้งค่า Supabase");
  return supabase;
}

function mapTask(row: any): SalesChannelTask {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    publicationId: String(row.publication_id),
    channel: row.channel,
    taskType: row.task_type,
    status: row.status,
    priority: row.priority,
    assignedTo: row.assigned_to ?? undefined,
    assignedToName: row.assigned_to_name ?? undefined,
    claimedAt: row.claimed_at ?? undefined,
    createdAt: row.created_at,
    createdByName: String(row.created_by_name || "ระบบ"),
    completedAt: row.completed_at ?? undefined,
    completedByName: row.completed_by_name ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    cancelledByName: row.cancelled_by_name ?? undefined,
    cancellationReason: row.cancellation_reason ?? undefined,
    completionNote: row.completion_note ?? undefined,
    sourceEvent: row.source_event,
    updatedAt: row.updated_at,
  };
}

const columns =
  "id,product_id,publication_id,channel,task_type,status,priority,assigned_to,assigned_to_name,claimed_at,created_at,created_by_name,completed_at,completed_by_name,cancelled_at,cancelled_by_name,cancellation_reason,completion_note,source_event,updated_at";

export async function listSalesChannelTasks(
  productId?: string,
): Promise<SalesChannelTask[]> {
  let query = client()
    .from("sales_channel_tasks")
    .select(columns)
    .order("created_at", { ascending: false })
    .limit(500);
  if (productId) query = query.eq("product_id", productId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapTask);
}

export async function countActiveSalesChannelTasks(): Promise<number> {
  const { count, error } = await client()
    .from("sales_channel_tasks")
    .select("id", { count: "exact", head: true })
    .in("status", ["OPEN", "IN_PROGRESS"]);
  if (error) throw error;
  return count ?? 0;
}

async function taskRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await client().rpc(name, args).single();
  if (error) throw error;
  return mapTask(data);
}

export function claimSalesChannelTask(taskId: string, startNow = false) {
  return taskRpc("claim_sales_channel_task", {
    target_task_id: taskId,
    start_now: startNow,
  });
}

export function completeSalesChannelTask(
  taskId: string,
  actionId: string,
  note?: string,
) {
  return taskRpc("complete_sales_channel_task", {
    target_task_id: taskId,
    action_id: actionId,
    note: note?.trim() || null,
  });
}

export function cancelSalesChannelTask(taskId: string, reason: string) {
  return taskRpc("cancel_sales_channel_task", {
    target_task_id: taskId,
    reason,
  });
}

export function isActiveTaskStatus(status: SalesChannelTaskStatus) {
  return status === "OPEN" || status === "IN_PROGRESS";
}

export function subscribeSalesChannelTasks(
  onChange: () => void,
): RealtimeChannel | null {
  if (!supabase) return null;
  return supabase
    .channel("hub6-cleanup-tasks")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "sales_channel_tasks" },
      onChange,
    )
    .subscribe();
}

export async function removeSalesChannelTaskChannel(channel: RealtimeChannel) {
  if (supabase) await supabase.removeChannel(channel);
}
