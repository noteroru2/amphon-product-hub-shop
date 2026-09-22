import { supabase } from "./supabase";

const DEFAULT_AI_BUYER_API = "https://amphon-ai-buyer.noteroru2.workers.dev";
const AI_BUYER_API = String(
  import.meta.env.VITE_AI_BUYER_API || DEFAULT_AI_BUYER_API,
).replace(/\/$/, "");

export type AiBuyerRolloutMode = {
  category: string;
  mode: "SHADOW" | "APPROVAL" | "AUTO";
  max_negotiation_rounds: number;
  active: boolean;
  updated_at?: string;
};

export type AiBuyerOpenAISpend = {
  status: "live" | "not_configured" | "unavailable";
  scope: "organization";
  currency: string;
  timezone: string;
  today: number | null;
  last7Days: number | null;
  monthToDate: number | null;
  requestsMonthToDate: number | null;
  tokensMonthToDate: {
    input: number | null;
    cachedInput: number | null;
    output: number | null;
    total: number | null;
  };
  byModel: Array<{
    model: string;
    requests: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  daily: Array<{ date: string; amount: number }>;
  updatedAt: string;
  error: string | null;
};

async function accessToken() {
  if (!supabase) throw new Error("Supabase ยังไม่พร้อมใช้งาน");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("กรุณาเข้าสู่ระบบใหม่");
  return token;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await accessToken();
  const response = await fetch(AI_BUYER_API + path, {
    ...init,
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = { error: raw || "INVALID_RESPONSE" };
  }
  if (!response.ok || body?.ok === false) {
    if (response.status === 403) throw new Error("หน้านี้เปิดให้เฉพาะ Owner / Admin");
    if (response.status === 401) throw new Error("Session หมดอายุ กรุณาเข้าสู่ระบบใหม่");
    throw new Error(body?.error || `AI_BUYER_${response.status}`);
  }
  return body as T;
}

export type AiBuyerDashboardCase = {
  id: string;
  title: string;
  category?: string | null;
  state: string;
  controlMode: string;
  confidence: {
    identity?: number | null;
    spec?: number | null;
    condition?: number | null;
    pricingReadiness?: number | null;
  };
  acceptedPrice?: number | null;
  acceptedAt?: string | null;
  customer?: {
    displayName?: string | null;
    pictureUrl?: string | null;
    phone?: string | null;
  } | null;
  pricing?: {
    id: string;
    source?: string | null;
    estimatedResale?: number | null;
    openingOffer?: number | null;
    targetBuy?: number | null;
    hardMax?: number | null;
    currentAuthorizedOffer?: number | null;
    confidence?: number | null;
    rationale?: unknown;
    createdAt?: string | null;
  } | null;
  offer?: {
    id: string;
    amount?: number | null;
    status: string;
    round: number;
    deliveredAt?: string | null;
    createdAt?: string | null;
  } | null;
  task?: {
    id: string;
    type?: string | null;
    status?: string | null;
    priority?: string | null;
  } | null;
  imageCount: number;
  lastMessage?: {
    type: string;
    text?: string | null;
    createdAt?: string | null;
  } | null;
  finalOutcome?: {
    id: string;
    label: string;
    finalAgreedPrice?: number | null;
    purchasePrice?: number | null;
    reasonCode?: string | null;
    note?: string | null;
    outcomeAt?: string | null;
    verified: boolean;
  } | null;
  deal?: {
    ledgerLines: number;
    purchaseTotal?: number | null;
    totalCost?: number | null;
    saleTotal?: number | null;
    grossProfit?: number | null;
    soldLines: number;
    inStockLines: number;
    firstAcquiredAt?: string | null;
    lastSoldAt?: string | null;
  } | null;
  needsFinalLabel?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type AiBuyerDashboardData = {
  ok: true;
  viewer: { displayName: string; role: "owner" | "admin" };
  summary: {
    total: number;
    priced: number;
    humanReview: number;
    actionRequired: number;
    accepted: number;
    purchased?: number;
    sold?: number;
    grossProfit?: number;
    needsFinalLabel?: number;
  };
  openai?: AiBuyerOpenAISpend;
  modes?: AiBuyerRolloutMode[];
  cases: AiBuyerDashboardCase[];
  generatedAt: string;
};

export type AiBuyerCaseDetail = {
  ok: true;
  case: {
    id: string;
    conversation_id: string;
    customer_id: string;
    state: string;
    category?: string | null;
    title?: string | null;
    control_mode: string;
    identity_confidence?: number | null;
    spec_completeness?: number | null;
    condition_completeness?: number | null;
    pricing_readiness?: number | null;
    accepted_price?: number | null;
    accepted_at?: string | null;
    metadata?: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  };
  customer?: {
    id: string;
    display_name?: string | null;
    picture_url?: string | null;
    phone?: string | null;
  } | null;
  messages: Array<{
    id: string;
    direction: "INBOUND" | "OUTBOUND" | "SYSTEM";
    message_type: string;
    text_content?: string | null;
    metadata?: Record<string, unknown>;
    line_timestamp?: string | null;
    created_at: string;
  }>;
  pricing: Array<{
    id: string;
    price_source: string;
    estimated_resale?: number | null;
    opening_offer: number;
    target_buy: number;
    hard_max: number;
    current_authorized_offer: number;
    pricing_confidence: number;
    adjustments?: unknown;
    rationale?: unknown;
    created_at: string;
  }>;
  finalOutcome?: {
    id: string;
    final_label: string;
    final_agreed_price?: number | null;
    purchase_price?: number | null;
    reason_code?: string | null;
    note?: string | null;
    outcome_at?: string | null;
    verified: boolean;
  } | null;
  ledger: AiBuyerLedgerLine[];
  dealSummary?: AiBuyerDealSummary | null;
  images: Array<{
    id: string;
    object_key?: string | null;
    analysis_status?: string | null;
    created_at: string;
  }>;
  observations: unknown[];
};

export type AiBuyerLedgerLine = {
  id: string;
  case_id: string;
  line_no: number;
  product_id?: string | null;
  item_title?: string | null;
  category?: string | null;
  model?: string | null;
  sku?: string | null;
  status: string;
  purchase_price?: number | null;
  acquired_at?: string | null;
  repair_cost: number;
  parts_cost: number;
  transport_cost: number;
  warranty_cost: number;
  channel_fee: number;
  other_cost: number;
  sale_price?: number | null;
  sale_channel?: string | null;
  sold_at?: string | null;
  sale_price_source: string;
  sale_price_verified: boolean;
  total_cost: number;
  gross_profit?: number | null;
  note?: string | null;
};

export type AiBuyerDealSummary = {
  case_id: string;
  final_label?: string | null;
  final_agreed_price?: number | null;
  outcome_purchase_price?: number | null;
  ledger_lines: number;
  purchase_total?: number | null;
  repair_total?: number | null;
  parts_total?: number | null;
  transport_total?: number | null;
  warranty_total?: number | null;
  channel_fee_total?: number | null;
  other_cost_total?: number | null;
  total_cost?: number | null;
  sale_total?: number | null;
  gross_profit?: number | null;
  first_acquired_at?: string | null;
  last_sold_at?: string | null;
  sold_lines: number;
  in_stock_lines: number;
};

export async function loadAiBuyerDashboard(limit = 150) {
  return request<AiBuyerDashboardData>(
    `/v1/hub/admin/dashboard?limit=${Math.max(10, Math.min(200, limit))}`,
  );
}

export async function loadAiBuyerCase(caseId: string) {
  return request<AiBuyerCaseDetail>(
    `/v1/hub/admin/case?caseId=${encodeURIComponent(caseId)}`,
  );
}

export async function sendAiBuyerManualReply(input: {
  caseId: string;
  text: string;
  offerAmount?: number | null;
}) {
  return request<{
    ok: true;
    sent: boolean;
    actionId: string;
    lineMessageId?: string | null;
    offerAmount?: number | null;
  }>("/v1/hub/admin/manual-reply", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      idempotencyKey: crypto.randomUUID(),
    }),
  });
}

export async function saveAiBuyerFinalOutcome(input: {
  caseId: string;
  finalLabel: string;
  finalAgreedPrice?: number | null;
  purchasePrice?: number | null;
  reasonCode?: string | null;
  note?: string | null;
}) {
  return request<{
    ok: true;
    outcome: unknown;
    deal?: AiBuyerDealSummary | null;
  }>("/v1/hub/admin/final-outcome", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function saveAiBuyerLedgerLine(input: {
  id?: string;
  caseId: string;
  lineNo: number;
  productId?: string | null;
  itemTitle?: string | null;
  category?: string | null;
  model?: string | null;
  sku?: string | null;
  status?: string;
  purchasePrice?: number | null;
  acquiredAt?: string | null;
  repairCost?: number;
  partsCost?: number;
  transportCost?: number;
  warrantyCost?: number;
  channelFee?: number;
  otherCost?: number;
  salePrice?: number | null;
  saleChannel?: string | null;
  soldAt?: string | null;
  salePriceVerified?: boolean;
  note?: string | null;
}) {
  return request<{
    ok: true;
    line: AiBuyerLedgerLine;
    summary?: AiBuyerDealSummary | null;
  }>("/v1/hub/admin/deal-ledger", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
