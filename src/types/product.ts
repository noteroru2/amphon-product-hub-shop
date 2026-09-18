export type ProductCategory =
  | "notebook"
  | "pc"
  | "iphone"
  | "smartphone"
  | "tablet"
  | "camera"
  | "lens"
  | "monitor"
  | "component"
  | "gaming"
  | "accessory"
  | "other";
export type ProductStatus =
  | "draft"
  | "photo_ready"
  | "ready_to_list"
  | "published"
  | "reserved"
  | "sold"
  | "repair"
  | "consignment"
  | "returned"
  | "cancelled";
export type UserRole = "owner" | "admin" | "sales" | "technician";

export interface Profile {
  id: string;
  displayName: string;
  role: UserRole;
  active: boolean;
}

export interface DeletedRemoteImage {
  id: string;
  objectKey: string;
}

export interface ProductImageDraft {
  id: string;
  name: string;
  blob?: Blob;
  previewUrl?: string;
  isCover: boolean;
  order: number;
  remoteImageId?: string;
  objectKey?: string;
  publicUrl?: string;
  imageRole?: string;
}

export interface ProductDraft {
  localId: string;
  ownerUserId?: string;
  remoteProductId?: string;
  sku?: string;
  category?: ProductCategory;
  subtype?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  title?: string;
  price?: number;
  cost?: number;
  conditionPercent?: number;
  warrantyUntil?: string;
  defects?: string;
  notes?: string;
  specs: Record<string, string>;
  status: ProductStatus;
  originalStatus?: ProductStatus;
  images: ProductImageDraft[];
  deletedRemoteImages?: DeletedRemoteImage[];
  currentStep: number;
  updatedAt: number;
}

export interface ProductSummary {
  id: string;
  sku: string;
  category: ProductCategory;
  subtype?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  title: string;
  price: number;
  cost?: number;
  status: ProductStatus;
  conditionPercent?: number;
  warrantyUntil?: string;
  defects?: string;
  notes?: string;
  specs: Record<string, string>;
  images: Array<{
    id: string;
    objectKey: string;
    publicUrl?: string;
    sortOrder: number;
    isCover: boolean;
    imageRole?: string;
  }>;
  createdAt: string;
  updatedAt: string;
  soldAt?: string;
}

export type UploadState = "waiting" | "uploading" | "done" | "error";

export interface UploadQueueItem {
  imageId: string;
  filename: string;
  state: UploadState;
  error?: string;
}

export interface DuplicateIdentifierMatch {
  id: string;
  sku: string;
  title: string;
  status: ProductStatus;
  serialNumber: string;
}

export interface ProductActivity {
  id: number;
  action: string;
  actorId?: string;
  actorName?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface EmployeeSummary {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  createdAt?: string;
  lastSignInAt?: string;
}

export interface EmployeeActivity {
  id: number;
  action: string;
  actorId?: string;
  actorName?: string;
  targetUserId?: string;
  targetName?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type PublicationChannel =
  "facebook" | "marketplace" | "winner_it" | "website" | "line";
export type PublicationStatus =
  "not_published" | "published" | "ended" | "expired";

export interface ProductPublication {
  id: string;
  productId: string;
  channel: PublicationChannel;
  status: PublicationStatus;
  externalUrl?: string;
  listingRef?: string;
  notes?: string;
  publishedAt?: string;
  publishedBy?: string;
  publishedByName?: string;
  endedAt?: string;
  endedBy?: string;
  endedByName?: string;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt: string;
}

export type PublicationEventType =
  "posted" | "shared" | "updated" | "removed" | "expired" | "reset";

export interface SalesChannelPublicationEvent {
  id: string;
  publicationId: string;
  productId: string;
  channel: PublicationChannel;
  eventType: PublicationEventType;
  previousStatus?: PublicationStatus;
  newStatus: PublicationStatus;
  externalUrl?: string;
  actorName: string;
  occurredAt: string;
}

export type SalesChannelTaskType =
  "REMOVE_LISTING" | "UPDATE_LISTING" | "VERIFY_REMOVAL";
export type SalesChannelTaskStatus =
  "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type SalesChannelTaskPriority = "HIGH" | "NORMAL";

export interface SalesChannelTask {
  id: string;
  productId: string;
  publicationId: string;
  channel: PublicationChannel;
  taskType: SalesChannelTaskType;
  status: SalesChannelTaskStatus;
  priority: SalesChannelTaskPriority;
  assignedTo?: string;
  assignedToName?: string;
  claimedAt?: string;
  createdAt: string;
  createdByName: string;
  completedAt?: string;
  completedByName?: string;
  cancelledAt?: string;
  cancelledByName?: string;
  cancellationReason?: string;
  completionNote?: string;
  sourceEvent: "SOLD_TRANSITION" | "RECONCILIATION" | "PUBLICATION_UPDATED";
  updatedAt: string;
}

// SHOP-4 — Commerce / Merchant administration
export type CommerceIndexPolicy = "INDEX" | "NOINDEX" | "HOLD" | "RETIRED";
export type MerchantItemCondition = "NEW" | "USED" | "REFURBISHED";

export interface CommerceCategoryOption {
  id: string;
  key: string;
  name: string;
  slug: string;
}

export interface CommerceBrandOption {
  id: string;
  name: string;
  slug: string;
}

export interface CommerceSeriesOption {
  id: string;
  categoryId: string;
  brandId: string;
  name: string;
  slug: string;
}

export interface CommerceModelOption {
  id: string;
  categoryId: string;
  brandId: string;
  seriesId?: string;
  name: string;
  code?: string;
  slug: string;
}

export interface CommerceCatalog {
  categories: CommerceCategoryOption[];
  brands: CommerceBrandOption[];
  series: CommerceSeriesOption[];
  models: CommerceModelOption[];
}

export interface CommerceProductConfig {
  configured: boolean;
  productId: string;
  sku: string;
  title: string;
  listingId?: string;
  slug?: string;
  canonicalPath?: string;
  canonicalUrl?: string;
  categoryId?: string;
  brandId?: string;
  seriesId?: string;
  modelId?: string;
  categoryName?: string;
  brandName?: string;
  seriesName?: string;
  modelName?: string;
  seoTitle?: string;
  seoDescription?: string;
  indexPolicy: CommerceIndexPolicy;
  merchantEnabled: boolean;
  merchantItemCondition: MerchantItemCondition;
  googleProductCategory?: string;
  gtin?: string;
  mpn?: string;
  storeWarrantyDays?: number;
  storeWarrantyTerms?: string;
  websiteStatus?: PublicationStatus;
  dataReady: boolean;
  merchantActivationReady: boolean;
  blockers: string[];
  updatedAt?: string;
}

export interface CommerceTaxonomyCandidate {
  categoryId?: string;
  categoryKey?: string;
  categorySlug?: string;
  sourceBrand?: string;
  sourceModel?: string;
  historicalListingCount: number;
  currentStockCount: number;
  mappedBrandId?: string;
  mappedModelId?: string;
  lastSeenAt?: string;
}

export interface CommerceStoreSettings {
  merchantName: string;
  legalName?: string;
  siteUrl: string;
  currency: string;
  countryCode: string;
  purchaseEnabled: boolean;
  purchaseActivationLocked: boolean;
  autoPublish?: {
    enabled: boolean;
    delaySeconds: number;
  };
  checkout: {
    enabled: boolean;
    reservationMinutes: number;
    bankTransferEnabled: boolean;
    stripeEnabled: boolean;
    promptPayEnabled: boolean;
    payAtStoreEnabled: boolean;
    pickupEnabled: boolean;
    termsUrl?: string;
    turnstileEnabled: boolean;
    turnstileSiteKey?: string;
    bankName?: string;
    bankAccountName?: string;
    bankAccountNumber?: string;
  };
  shipping: {
    enabled: boolean;
    country: string;
    rate?: number;
    handlingMinDays?: number;
    handlingMaxDays?: number;
    transitMinDays?: number;
    transitMaxDays?: number;
    policyUrl?: string;
  };
  returns: {
    enabled: boolean;
    category?: "FINITE" | "NOT_PERMITTED" | "UNLIMITED";
    days?: number;
    method?: "MAIL" | "IN_STORE" | "MAIL_AND_IN_STORE";
    fees?: "FREE" | "CUSTOMER_RESPONSIBILITY";
    policyUrl?: string;
  };
  warrantyPolicyUrl?: string;
  warranty: { defaultDays: number; defaultTerms?: string };
  documents: {
    mode: "RECEIPT_ONLY" | "INVOICE_RECEIPT" | "VAT_TAX_INVOICE";
    sellerName?: string;
    taxId?: string;
    branchCode?: string;
    address?: string;
    email?: string;
    eTaxIntegrated?: boolean;
  };
  updatedAt?: string;
}

// SHOP-6 — Online orders + payment / fulfillment
export type CommerceOrderStatus =
  | "AWAITING_PAYMENT"
  | "PAYMENT_REVIEW"
  | "PROCESSING"
  | "SHIPPED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "REFUNDED";
export type CommercePaymentStatus =
  "UNPAID" | "REVIEW" | "PAID" | "REFUND_PENDING" | "REFUNDED";
export type CommerceFulfillmentStatus =
  | "UNFULFILLED"
  | "PACKING"
  | "SHIPPED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "PICKUP_READY"
  | "PICKED_UP"
  | "CANCELLED";

export interface CommerceOrderItem {
  productId?: string;
  sku: string;
  title: string;
  unitPrice: number;
  condition?: string;
  warrantyDays?: number;
  warrantyTerms?: string;
}

export interface CommerceOrder {
  id: string;
  orderNumber: string;
  orderStatus: CommerceOrderStatus;
  paymentStatus: CommercePaymentStatus;
  fulfillmentStatus: CommerceFulfillmentStatus;
  paymentMethod: "BANK_TRANSFER" | "PAY_AT_STORE" | "STRIPE" | string;
  paymentProvider?: "MANUAL" | "STRIPE" | string;
  providerPaymentStatus?: string;
  providerPaymentIntentId?: string;
  refundStatus?: string;
  deliveryMethod: "SHIPPING" | "PICKUP" | string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  addressLine?: string;
  subdistrict?: string;
  district?: string;
  province?: string;
  postalCode?: string;
  customerNote?: string;
  currency: string;
  subtotal: number;
  shippingAmount: number;
  total: number;
  reservationExpiresAt: string;
  paymentReference?: string;
  paymentNotifiedAt?: string;
  paidAt?: string;
  trackingCarrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  shipmentStatus?: string;
  shippedAt?: string;
  deliveredAt?: string;
  completedAt?: string;
  document?: {
    publicToken: string;
    documentNumber: string;
    documentType: string;
  } | null;
  warranties?: Array<{
    publicToken: string;
    warrantyNumber: string;
    sku: string;
    startsAt?: string;
    endsAt?: string;
  }>;
  createdAt: string;
  updatedAt?: string;
  items: CommerceOrderItem[];
}
