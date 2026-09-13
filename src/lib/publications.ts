import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { logActivity } from "./backend";
import { validatePublicationExternalUrl } from "./publicationSecurity";
import type {
  ProductPublication,
  ProductStatus,
  ProductSummary,
  Profile,
  PublicationChannel,
  PublicationStatus,
  SalesChannelPublicationEvent,
} from "../types/product";

export interface PublicationChannelDefinition {
  id: PublicationChannel;
  label: string;
  shortLabel: string;
  emoji: string;
  description: string;
  supportsExternalUrl: boolean;
  persistentListing: boolean;
  soldCleanupTaskType: "REMOVE_LISTING" | "UPDATE_LISTING" | null;
  manualConfirmationLabel: string;
}

export const publicationChannels: PublicationChannelDefinition[] = [
  {
    id: "website",
    label: "AMPHON SHOP",
    shortLabel: "SHOP",
    emoji: "🌐",
    description: "สถานะจริงจาก Publish Center / SHOP",
    supportsExternalUrl: true,
    persistentListing: true,
    soldCleanupTaskType: null,
    manualConfirmationLabel: "เผยแพร่ขึ้นเว็บไซต์",
  },
  {
    id: "marketplace",
    label: "Facebook Marketplace",
    shortLabel: "MP",
    emoji: "🛍️",
    description: "พนักงานยืนยันสถานะประกาศด้วยตนเอง",
    supportsExternalUrl: true,
    persistentListing: true,
    soldCleanupTaskType: "REMOVE_LISTING",
    manualConfirmationLabel: "ทำเครื่องหมายว่าโพสต์ Marketplace แล้ว",
  },
  {
    id: "facebook",
    label: "Facebook Page",
    shortLabel: "FB",
    emoji: "🔵",
    description: "พนักงานยืนยันสถานะโพสต์ด้วยตนเอง",
    supportsExternalUrl: true,
    persistentListing: true,
    soldCleanupTaskType: "UPDATE_LISTING",
    manualConfirmationLabel: "ทำเครื่องหมายว่าโพสต์ Facebook Page แล้ว",
  },
  {
    id: "line",
    label: "LINE",
    shortLabel: "LINE",
    emoji: "🟢",
    description: "บันทึกการแชร์ล่าสุดจากพนักงาน",
    supportsExternalUrl: false,
    persistentListing: false,
    soldCleanupTaskType: null,
    manualConfirmationLabel: "ทำเครื่องหมายว่าส่ง LINE แล้ว",
  },
  {
    id: "winner_it",
    label: "WINNER IT",
    shortLabel: "WIN",
    emoji: "🟠",
    description: "พนักงานยืนยันสถานะเพจด้วยตนเอง",
    supportsExternalUrl: true,
    persistentListing: true,
    soldCleanupTaskType: "UPDATE_LISTING",
    manualConfirmationLabel: "ทำเครื่องหมายว่าโพสต์ WINNER IT แล้ว",
  },
];

const salesSiteBaseUrl = (
  import.meta.env.VITE_SALES_SITE_URL as string | undefined
)
  ?.trim()
  .replace(/\/$/, "");

export function websiteProductUrl(sku: string, listingSlug?: string | null) {
  if (!salesSiteBaseUrl) return "";
  if (listingSlug?.trim())
    return `${salesSiteBaseUrl}/p/${listingSlug.trim()}-${encodeURIComponent(sku.toLowerCase())}/`;
  // Compatibility route from SHOP-1. It 301 redirects to the stable canonical URL.
  return `${salesSiteBaseUrl}/product/${encodeURIComponent(sku)}`;
}

export function hasSalesSiteUrl() {
  return Boolean(salesSiteBaseUrl);
}

function client() {
  if (!supabase) throw new Error("ยังไม่ได้ตั้งค่า Supabase");
  return supabase;
}

function mapPublication(row: any): ProductPublication {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    channel: row.channel as PublicationChannel,
    status: row.status as PublicationStatus,
    externalUrl: row.external_url ?? undefined,
    listingRef: row.listing_ref ?? undefined,
    notes: row.notes ?? undefined,
    publishedAt: row.published_at ?? undefined,
    publishedBy: row.published_by ?? undefined,
    publishedByName: row.published_by_name ?? undefined,
    endedAt: row.ended_at ?? undefined,
    endedBy: row.ended_by ?? undefined,
    endedByName: row.ended_by_name ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    updatedByName: row.updated_by_name ?? undefined,
    updatedAt: row.updated_at,
  };
}

function mapPublicationEvent(row: any): SalesChannelPublicationEvent {
  return {
    id: String(row.id),
    publicationId: String(row.publication_id),
    productId: String(row.product_id),
    channel: row.channel as PublicationChannel,
    eventType: row.event_type,
    previousStatus: row.previous_status ?? undefined,
    newStatus: row.new_status,
    externalUrl: row.external_url ?? undefined,
    actorName: String(row.actor_name || "พนักงาน"),
    occurredAt: row.occurred_at,
  };
}

export async function listProductPublications(
  productIds?: string[],
): Promise<ProductPublication[]> {
  const db = client();
  let query = db
    .from("product_publications")
    .select(
      "id,product_id,channel,status,external_url,listing_ref,notes,published_at,published_by,published_by_name,ended_at,ended_by,ended_by_name,updated_by,updated_by_name,updated_at",
    )
    .order("updated_at", { ascending: false });
  if (productIds?.length) query = query.in("product_id", productIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapPublication);
}

export async function listPublicationHistory(
  productId: string,
): Promise<SalesChannelPublicationEvent[]> {
  const { data, error } = await client()
    .from("sales_channel_publication_events")
    .select(
      "id,publication_id,product_id,channel,event_type,previous_status,new_status,external_url,actor_name,occurred_at",
    )
    .eq("product_id", productId)
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map(mapPublicationEvent);
}

async function syncOverallProductStatus(
  product: Pick<ProductSummary, "id" | "status">,
  profile: Profile,
) {
  const db = client();
  const { count, error: countError } = await db
    .from("product_publications")
    .select("id", { count: "exact", head: true })
    .eq("product_id", product.id)
    .eq("status", "published");
  if (countError) throw countError;

  const activePublished = count ?? 0;
  let nextStatus: ProductStatus | null = null;
  if (activePublished > 0 && product.status === "ready_to_list")
    nextStatus = "published";
  if (activePublished === 0 && product.status === "published")
    nextStatus = "ready_to_list";
  if (!nextStatus) return;

  const { error } = await db
    .from("products")
    .update({ status: nextStatus, updated_by: profile.id })
    .eq("id", product.id);
  if (error) throw error;
  await logActivity(product.id, "status_changed", {
    from: product.status,
    to: nextStatus,
    source: "publish_center",
  });
}

export async function saveProductPublication(input: {
  product: Pick<ProductSummary, "id" | "sku" | "status">;
  profile: Profile;
  channel: PublicationChannel;
  status: PublicationStatus;
  externalUrl?: string;
  listingRef?: string;
  notes?: string;
  occurredAt?: string;
  actionId?: string;
}): Promise<ProductPublication> {
  const { product, profile, channel, status } = input;
  if (!["owner", "admin", "sales"].includes(profile.role))
    throw new Error("บัญชีนี้ไม่มีสิทธิ์จัดการการลงขาย");
  if (
    status === "published" &&
    !["ready_to_list", "published", "reserved"].includes(product.status)
  ) {
    throw new Error(`สินค้า ${product.sku} ยังไม่อยู่ในสถานะที่อนุญาตให้ลงขาย`);
  }

  const db = client();
  const { data: existing, error: existingError } = await db
    .from("product_publications")
    .select(
      "id,product_id,channel,status,external_url,listing_ref,notes,published_at,published_by,published_by_name,ended_at,ended_by,ended_by_name,updated_by,updated_by_name,updated_at",
    )
    .eq("product_id", product.id)
    .eq("channel", channel)
    .maybeSingle();
  if (existingError) throw existingError;

  const now = new Date().toISOString();
  const occurredAt = input.occurredAt
    ? new Date(input.occurredAt)
    : new Date(now);
  if (
    Number.isNaN(occurredAt.getTime()) ||
    occurredAt.getTime() > Date.now() + 5 * 60_000
  )
    throw new Error("วันเวลาที่โพสต์ไม่ถูกต้อง");
  const websiteUrl =
    channel === "website" ? websiteProductUrl(product.sku) : "";
  const externalUrl = validatePublicationExternalUrl(
    input.externalUrl || websiteUrl,
  );
  const wasPublished = existing?.status === "published";
  if (
    channel !== "line" &&
    wasPublished &&
    status === "published" &&
    (existing.external_url ?? null) === externalUrl
  ) {
    return mapPublication(existing);
  }
  const payload: Record<string, unknown> = {
    product_id: product.id,
    channel,
    status,
    external_url: externalUrl,
    listing_ref: input.listingRef?.trim() || null,
    notes: input.notes?.trim() || null,
    updated_by: profile.id,
    updated_by_name: profile.displayName,
    updated_at: now,
    last_action_id: input.actionId || crypto.randomUUID(),
  };

  if (status === "published") {
    payload.published_at =
      channel === "line" || !wasPublished
        ? occurredAt.toISOString()
        : (existing?.published_at ?? occurredAt.toISOString());
    payload.published_by =
      channel === "line" || !wasPublished
        ? profile.id
        : (existing?.published_by ?? profile.id);
    payload.published_by_name =
      channel === "line" || !wasPublished
        ? profile.displayName
        : (existing?.published_by_name ?? profile.displayName);
    payload.ended_at = null;
    payload.ended_by = null;
    payload.ended_by_name = null;
  } else if (status === "ended" || status === "expired") {
    payload.ended_at = occurredAt.toISOString();
    payload.ended_by = profile.id;
    payload.ended_by_name = profile.displayName;
  } else {
    payload.published_at = null;
    payload.published_by = null;
    payload.published_by_name = null;
    payload.ended_at = null;
    payload.ended_by = null;
    payload.ended_by_name = null;
  }

  const { data, error } = await db
    .from("product_publications")
    .upsert(payload, { onConflict: "product_id,channel" })
    .select(
      "id,product_id,channel,status,external_url,listing_ref,notes,published_at,published_by,published_by_name,ended_at,ended_by,ended_by_name,updated_by,updated_by_name,updated_at",
    )
    .single();
  if (error) throw error;

  await logActivity(product.id, "publication_changed", {
    channel,
    from: existing?.status ?? "not_published",
    to: status,
    external_url: externalUrl,
  });
  if (channel === "website") await syncOverallProductStatus(product, profile);
  return mapPublication(data);
}

export function subscribePublications(
  onChange: () => void,
): RealtimeChannel | null {
  if (!supabase) return null;
  return supabase
    .channel("publication-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "product_publications" },
      onChange,
    )
    .subscribe();
}

export async function removePublicationRealtimeChannel(
  channel: RealtimeChannel,
) {
  if (!supabase) return;
  await supabase.removeChannel(channel);
}
