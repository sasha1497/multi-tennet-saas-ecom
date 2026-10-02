import type {
  AdjustInventoryRequest,
  Brand,
  Category,
  Coupon,
  CreateBrandRequest,
  CreateCategoryRequest,
  CreateCouponRequest,
  CreateProductRequest,
  CurrentTenantResponse,
  Customer,
  CustomerQuery,
  CustomerReport,
  DashboardSummary,
  InventoryQuery,
  InventoryRecord,
  InventoryReport,
  InventoryTransaction,
  Order,
  OrderListItem,
  OrderQuery,
  PaginatedResult,
  Product,
  ProductImage,
  ProductListItem,
  ProductQuery,
  ReportQuery,
  Review,
  SalesReport,
  StoreSettings,
  TenantMembershipSummary,
  UpdateOrderStatusRequest,
  UpdateProductRequest,
  UpdateStoreSettingsRequest,
  UpdateStoreTemplateRequest,
  TemplateAccess,
} from '@retailos/types';
import type { TemplateDefinition } from '@retailos/templates';
import type { HttpClient } from '../http';

/** A plan in the RetailOS catalogue, as the merchant console sees it. */
export interface SubscriptionPlanOption {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** Minor units — ₹499/month is `49900`. */
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  trialDays: number;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  isCurrent: boolean;
  sortOrder: number;
  /** Relative to the store's current plan. */
  direction: 'current' | 'upgrade' | 'downgrade';
}

export interface UsageMeter {
  used: number;
  /** `-1` means unlimited. */
  limit: number;
}

export interface SubscriptionInvoice {
  id: string;
  reference: string;
  status: 'PAID' | 'FAILED' | 'VOID' | string;
  planCode: string;
  planName: string;
  amount: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  paidAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

/** Response of `GET /merchant/subscription`. */
export interface SubscriptionOverview {
  plans: SubscriptionPlanOption[];
  subscription: {
    id: string;
    status: string;
    planCode: string;
    planName: string;
    priceMonthly: number;
    currency: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    trialEndsAt: string | null;
    cancelledAt: string | null;
    /** Days left in the current period; negative once it has lapsed. */
    daysRemaining: number;
    isTrialing: boolean;
    /** True once the store has dropped to the free floor. */
    lapsed: boolean;
    /** When a failed renewal stops being covered (PAST_DUE only). */
    graceEndsAt: string | null;
  } | null;
  /** What the store is actually served after lapse and overrides — the source of truth. */
  effective: {
    planCode: string;
    features: Record<string, boolean>;
    limits: Record<string, number>;
  };
  usage: {
    products: UsageMeter;
    staff: UsageMeter;
    aiGenerations: UsageMeter & { resetsAt: string };
  };
  templates: {
    families: ('standard' | 'premium' | '3d')[];
    counts: Record<'standard' | 'premium' | '3d', number>;
  };
  invoices: SubscriptionInvoice[];
  /** False when this deployment cannot take a subscription payment yet. */
  billingAvailable: boolean;
}

/** Response of `GET /merchant/payments/setup` — how this store gets paid. */
export interface PaymentSetupStatus {
  status: 'NOT_CONNECTED' | 'CONNECTED' | 'ACTION_REQUIRED' | 'REVOKED';
  connectionType: 'keys' | 'oauth' | 'platform' | null;
  provider: string | null;
  environment: 'test' | 'live';
  /** The store's own Razorpay account id (`acc_…`). */
  accountId: string | null;
  connectedAt: string | null;
  onlinePaymentsAvailable: boolean;
  onlinePaymentsSwitchedOn: boolean;
  reason: string | null;
  /** Whether "Connect Razorpay" is offered on this deployment. */
  oauthAvailable: boolean;
}

/** One gateway's configuration — the safe view; secrets are never returned. */
export interface PaymentGatewayConfig {
  provider: string;
  enabled: boolean;
  environment: 'test' | 'live';
  publicKey: string | null;
  currency: string;
  configured: boolean;
}

export interface StorePayment {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  provider: string;
  method: string;
  status: string;
  amount: number;
  refundedAmount: number;
  currency: string;
  providerPaymentId: string | null;
  paidAt: string | null;
  createdAt: string;
  refunds: { id: string; status: string; amount: number; providerRefundId: string | null; createdAt: string }[];
}

/** Response of `POST /merchant/ai/product-suggestions`. */
export interface ProductSuggestionResponse {
  suggestion: {
    name: string;
    shortDescription: string;
    description: string;
    categoryName: string;
    /** An existing category id, or null — never a newly invented category. */
    categoryId: string | null;
    tags: string[];
    metaTitle: string;
    metaDescription: string;
  };
  /** True when an identical earlier request was reused at no charge. */
  cached: boolean;
  usage: { used: number; limit: number; resetsAt: string };
}

export interface AiUsage {
  used: number;
  limit: number;
  resetsAt: string;
  provider: string;
  available: boolean;
}

/** Response of `POST /merchant/subscription/checkout`. */
export interface SubscriptionCheckout {
  reference: string;
  planCode: string;
  planName: string;
  amount: number;
  currency: string;
  /** True while the deployment has no real platform gateway wired in. */
  simulated: boolean;
}

/** Response of `GET /merchant/templates`. */
export interface TemplateCatalogue {
  /** The whole catalogue, ranked with this store's recommendations first. */
  templates: TemplateDefinition[];
  /** Ids designed for this store's business category. */
  recommendedIds: string[];
  /** The design the storefront is currently rendering. */
  active: StoreSettings['template'];
  /** Per template: whether this store's plan allows choosing it. Decided by the API. */
  access: Record<string, TemplateAccess>;
  /** False when the store is on a template its plan no longer includes. */
  activeAllowed: boolean;
}

export interface StaffMember {
  id: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  role: string;
  permissions: string[];
  extraPermissions: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UploadedFile {
  url: string;
  key: string;
  /** Same value as `key`, under the name the product image payload uses. */
  objectKey: string;
  bucket: string;
  fileName: string;
  size: number;
  mimeType: string;
}

/** A presigned PUT for one file, plus the key to confirm afterwards. */
export interface UploadTicket {
  fileName: string;
  objectKey: string;
  bucket: string;
  uploadUrl: string;
  /** Must be sent verbatim — they are covered by the signature. */
  headers: Record<string, string>;
  expiresAt: string;
}

/** Progress for one file in a multi-file upload. */
export interface UploadProgress {
  /** Index in the array that was passed to `uploadFiles`. */
  index: number;
  fileName: string;
  /** 0–100. Jumps 0 → 100 where the platform cannot report increments. */
  percent: number;
  status: 'pending' | 'uploading' | 'confirming' | 'done' | 'failed';
  error?: string;
}

/** Everything the merchant console talks to. All calls require a tenant context. */
export class MerchantResource {
  constructor(private readonly http: HttpClient) {}

  // ----------------------------------------------------------- dashboard --

  dashboard(query: ReportQuery = {}): Promise<DashboardSummary> {
    return this.http.get('/merchant/dashboard', { query: query as Record<string, unknown> });
  }

  currentTenant(): Promise<CurrentTenantResponse> {
    return this.http.get('/merchant/tenant');
  }

  memberships(): Promise<TenantMembershipSummary[]> {
    return this.http.get('/merchant/tenant/memberships');
  }

  // ------------------------------------------------------------ products --

  products(query: ProductQuery = {}): Promise<PaginatedResult<ProductListItem>> {
    return this.http.get('/merchant/products', { query: query as Record<string, unknown> });
  }

  product(id: string): Promise<Product> {
    return this.http.get(`/merchant/products/${id}`);
  }

  createProduct(body: CreateProductRequest): Promise<Product> {
    return this.http.post('/merchant/products', body);
  }

  updateProduct(id: string, body: UpdateProductRequest): Promise<Product> {
    return this.http.patch(`/merchant/products/${id}`, body);
  }

  /** Soft-delete: the product is archived so historical orders stay intact. */
  deleteProduct(id: string): Promise<void> {
    return this.http.delete(`/merchant/products/${id}`);
  }

  publishProduct(id: string, publish: boolean): Promise<Product> {
    return this.http.post(`/merchant/products/${id}/publish`, { publish });
  }

  // ---------------------------------------------------------- categories --

  categories(): Promise<Category[]> {
    return this.http.get('/merchant/categories');
  }
  createCategory(body: CreateCategoryRequest): Promise<Category> {
    return this.http.post('/merchant/categories', body);
  }
  updateCategory(id: string, body: Partial<CreateCategoryRequest>): Promise<Category> {
    return this.http.patch(`/merchant/categories/${id}`, body);
  }
  deleteCategory(id: string): Promise<void> {
    return this.http.delete(`/merchant/categories/${id}`);
  }

  // -------------------------------------------------------------- brands --

  brands(): Promise<Brand[]> {
    return this.http.get('/merchant/brands');
  }
  createBrand(body: CreateBrandRequest): Promise<Brand> {
    return this.http.post('/merchant/brands', body);
  }
  updateBrand(id: string, body: Partial<CreateBrandRequest>): Promise<Brand> {
    return this.http.patch(`/merchant/brands/${id}`, body);
  }
  deleteBrand(id: string): Promise<void> {
    return this.http.delete(`/merchant/brands/${id}`);
  }

  // ----------------------------------------------------------- inventory --

  inventory(query: InventoryQuery = {}): Promise<PaginatedResult<InventoryRecord>> {
    return this.http.get('/merchant/inventory', { query: query as Record<string, unknown> });
  }

  adjustInventory(body: AdjustInventoryRequest): Promise<InventoryRecord> {
    return this.http.post('/merchant/inventory/adjust', body);
  }

  bulkAdjustInventory(adjustments: AdjustInventoryRequest[]): Promise<InventoryRecord[]> {
    return this.http.post('/merchant/inventory/bulk-adjust', { adjustments });
  }

  setLowStockThreshold(variantId: string, lowStockThreshold: number): Promise<InventoryRecord> {
    return this.http.post('/merchant/inventory/threshold', { variantId, lowStockThreshold });
  }

  inventoryTransactions(
    query: { variantId?: string; page?: number; limit?: number } = {},
  ): Promise<PaginatedResult<InventoryTransaction>> {
    return this.http.get('/merchant/inventory/transactions', { query });
  }

  // -------------------------------------------------------------- orders --

  orders(query: OrderQuery = {}): Promise<PaginatedResult<OrderListItem>> {
    return this.http.get('/merchant/orders', { query: query as Record<string, unknown> });
  }

  order(id: string): Promise<Order> {
    return this.http.get(`/merchant/orders/${id}`);
  }

  updateOrderStatus(id: string, body: UpdateOrderStatusRequest): Promise<Order> {
    return this.http.post(`/merchant/orders/${id}/status`, body);
  }

  updateOrderNotes(id: string, internalNotes: string | null): Promise<Order> {
    return this.http.patch(`/merchant/orders/${id}/notes`, { internalNotes });
  }

  // ----------------------------------------------------------- customers --

  customers(query: CustomerQuery = {}): Promise<PaginatedResult<Customer>> {
    return this.http.get('/merchant/customers', { query: query as Record<string, unknown> });
  }

  customer(id: string): Promise<Customer & { recentOrders: OrderListItem[] }> {
    return this.http.get(`/merchant/customers/${id}`);
  }

  updateCustomer(
    id: string,
    body: { notes?: string | null; isActive?: boolean },
  ): Promise<Customer> {
    return this.http.patch(`/merchant/customers/${id}`, body);
  }

  // ------------------------------------------------------------ coupons --

  coupons(query: { page?: number; limit?: number } = {}): Promise<PaginatedResult<Coupon>> {
    return this.http.get('/merchant/coupons', { query });
  }
  createCoupon(body: CreateCouponRequest): Promise<Coupon> {
    return this.http.post('/merchant/coupons', body);
  }
  updateCoupon(id: string, body: Partial<CreateCouponRequest>): Promise<Coupon> {
    return this.http.patch(`/merchant/coupons/${id}`, body);
  }
  deleteCoupon(id: string): Promise<void> {
    return this.http.delete(`/merchant/coupons/${id}`);
  }

  // ------------------------------------------------------------ reviews --

  reviews(query: { page?: number; isApproved?: boolean } = {}): Promise<PaginatedResult<Review>> {
    return this.http.get('/merchant/reviews', { query });
  }
  moderateReview(id: string, isApproved: boolean): Promise<Review> {
    return this.http.post(`/merchant/reviews/${id}/moderate`, { isApproved });
  }

  // -------------------------------------------------------------- store --

  storeSettings(): Promise<StoreSettings> {
    return this.http.get('/merchant/store');
  }

  updateStoreSettings(body: UpdateStoreSettingsRequest): Promise<StoreSettings> {
    return this.http.patch('/merchant/store', body);
  }

  /** Records what the shop sells. Drives template recommendations. */
  updateBusinessCategory(businessCategory: string | null): Promise<CurrentTenantResponse> {
    return this.http.patch('/merchant/tenant', { businessCategory });
  }

  // ---------------------------------------------------------- templates --

  /** The template catalogue, recommendations first, with the active one flagged. */
  storeTemplates(): Promise<TemplateCatalogue> {
    return this.http.get('/merchant/templates');
  }

  /**
   * Switches storefront template and/or updates its customisation.
   *
   * Presentation only: the merchant's products, orders, customers, payments
   * and inventory are not touched by this call.
   */
  updateStoreTemplate(body: UpdateStoreTemplateRequest): Promise<StoreSettings> {
    return this.http.put('/merchant/store/template', body);
  }

  // ------------------------------------------------------- subscription --

  /**
   * What this store pays RetailOS.
   *
   * Not to be confused with `paymentConfig` — that is how the store gets paid
   * by its own shoppers.
   */
  subscription(): Promise<SubscriptionOverview> {
    return this.http.get('/merchant/subscription');
  }

  startSubscriptionCheckout(planCode: string): Promise<SubscriptionCheckout> {
    return this.http.post('/merchant/subscription/checkout', { planCode });
  }

  /** `outcome` only matters to the development simulator. */
  confirmSubscription(
    planCode: string,
    reference: string,
    outcome: 'paid' | 'failed' = 'paid',
  ): Promise<{
    status: string;
    invoiceStatus: string;
    planCode: string;
    planName: string;
    currentPeriodEnd: string | null;
  }> {
    return this.http.post('/merchant/subscription/confirm', { planCode, reference, outcome });
  }

  // ------------------------------------------------------ store payments --
  // How this store's customers pay it. Not the RetailOS subscription.

  paymentSetup(): Promise<PaymentSetupStatus> {
    return this.http.get('/merchant/payments/setup');
  }

  /** Returns Razorpay's authorisation URL; the browser goes there next. */
  connectRazorpay(): Promise<{ authorizeUrl: string }> {
    return this.http.post('/merchant/payments/razorpay/connect', {});
  }

  completeRazorpay(code: string, state: string): Promise<PaymentSetupStatus> {
    return this.http.post('/merchant/payments/razorpay/callback', { code, state });
  }

  disconnectRazorpay(): Promise<{ disconnected: boolean }> {
    return this.http.post('/merchant/payments/razorpay/disconnect', {});
  }

  paymentGateways(): Promise<PaymentGatewayConfig[]> {
    return this.http.get('/merchant/payments/config');
  }

  /** Manual keys (fallback). Secrets are write-only: omit to keep the stored one. */
  savePaymentGateway(body: {
    provider: string;
    enabled: boolean;
    environment: 'test' | 'live';
    publicKey?: string | null;
    secretKey?: string | null;
    webhookSecret?: string | null;
  }): Promise<PaymentGatewayConfig> {
    return this.http.put('/merchant/payments/config', body);
  }

  storePayments(limit = 20): Promise<StorePayment[]> {
    return this.http.get('/merchant/payments', { query: { limit } });
  }

  /** Full refund when `amount` is omitted. Money returns from the store's own gateway account. */
  refundOrder(
    orderId: string,
    body: { amount?: number; reason: string },
  ): Promise<{ refundId: string; status: string; amount: number; orderStatus: string }> {
    return this.http.post(`/merchant/orders/${orderId}/refund`, body);
  }

  // ----------------------------------------------------------------- ai --

  aiUsage(): Promise<AiUsage> {
    return this.http.get('/merchant/ai/usage');
  }

  /** A draft listing from an already-uploaded photo. Creates nothing. */
  suggestProduct(objectKey: string, hint?: string): Promise<ProductSuggestionResponse> {
    return this.http.post('/merchant/ai/product-suggestions', { objectKey, hint });
  }

  // -------------------------------------------------------------- staff --

  staff(): Promise<StaffMember[]> {
    return this.http.get('/merchant/staff');
  }

  inviteStaff(body: {
    email: string;
    firstName: string;
    lastName?: string;
    phone?: string;
    role: 'MANAGER' | 'STAFF';
    extraPermissions?: string[];
  }): Promise<StaffMember & { temporaryPassword?: string }> {
    return this.http.post('/merchant/staff', body);
  }

  updateStaff(
    id: string,
    body: { role?: 'MANAGER' | 'STAFF'; extraPermissions?: string[]; isActive?: boolean },
  ): Promise<StaffMember> {
    return this.http.patch(`/merchant/staff/${id}`, body);
  }

  removeStaff(id: string): Promise<void> {
    return this.http.delete(`/merchant/staff/${id}`);
  }

  // ------------------------------------------------------------ reports --

  salesReport(query: ReportQuery = {}): Promise<SalesReport> {
    return this.http.get('/merchant/reports/sales', { query: query as Record<string, unknown> });
  }
  customerReport(query: ReportQuery = {}): Promise<CustomerReport> {
    return this.http.get('/merchant/reports/customers', { query: query as Record<string, unknown> });
  }
  inventoryReport(): Promise<InventoryReport> {
    return this.http.get('/merchant/reports/inventory');
  }

  // -------------------------------------------------------------- files --

  /**
   * Uploads several files straight to object storage.
   *
   * Three round trips, not one per byte through the API:
   *
   *   1. ask for presigned PUTs (one request for the whole batch)
   *   2. PUT each file directly to MinIO/S3, in parallel
   *   3. confirm the ones that landed, so the API can verify their contents
   *
   * Failures are per-file and are returned rather than thrown: with eight
   * images selected, one failing upload should not discard the seven that
   * worked. Retry by calling this again with just the files that failed.
   */
  async uploadFiles(
    files: File[],
    options: {
      folder?: 'products' | 'categories' | 'brands' | 'store' | 'banners';
      /** Scopes keys to one product, so deleting it removes exactly its files. */
      productId?: string;
      onProgress?: (progress: UploadProgress) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<{ uploaded: UploadedFile[]; failed: { index: number; fileName: string; error: string }[] }> {
    const { onProgress, signal } = options;
    const report = (p: UploadProgress) => onProgress?.(p);

    files.forEach((file, index) =>
      report({ index, fileName: file.name, percent: 0, status: 'pending' }),
    );

    const { uploads: tickets } = await this.presignUploads({
      files: files.map((f) => ({ fileName: f.name, mimeType: f.type, size: f.size })),
      folder: options.folder ?? 'products',
      productId: options.productId,
    });

    const failed: { index: number; fileName: string; error: string }[] = [];
    const landed: { objectKey: string; fileName: string }[] = [];

    await Promise.all(
      tickets.map(async (ticket, index) => {
        const file = files[index];
        report({ index, fileName: file.name, percent: 0, status: 'uploading' });
        try {
          await putToStorage(ticket, file, signal, (percent) =>
            report({ index, fileName: file.name, percent, status: 'uploading' }),
          );
          landed.push({ objectKey: ticket.objectKey, fileName: file.name });
          report({ index, fileName: file.name, percent: 100, status: 'confirming' });
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Upload failed';
          failed.push({ index, fileName: file.name, error });
          report({ index, fileName: file.name, percent: 0, status: 'failed', error });
        }
      }),
    );

    if (landed.length === 0) return { uploaded: [], failed };

    try {
      const { files: uploaded } = await this.confirmUploads(landed);
      uploaded.forEach((file) => {
        const index = files.findIndex((f) => f.name === file.fileName);
        report({ index, fileName: file.fileName, percent: 100, status: 'done' });
      });
      return { uploaded, failed };
    } catch (err) {
      // The bytes are in the bucket but the API would not vouch for them —
      // wrong type, wrong size, or the object never actually landed. Report
      // every confirmed-in-flight file as failed rather than half-succeeding.
      const error = err instanceof Error ? err.message : 'Could not confirm the upload';
      for (const item of landed) {
        const index = files.findIndex((f) => f.name === item.fileName);
        failed.push({ index, fileName: item.fileName, error });
        report({ index, fileName: item.fileName, percent: 0, status: 'failed', error });
      }
      return { uploaded: [], failed };
    }
  }

  /** Step 1 of the direct-upload flow. Returns one presigned PUT per file. */
  presignUploads(body: {
    files: { fileName: string; mimeType: string; size: number }[];
    folder?: string;
    productId?: string;
  }): Promise<{ uploads: UploadTicket[] }> {
    return this.http.post('/merchant/files/presign', body);
  }

  /** Step 3: the API verifies each object's real size and magic number. */
  confirmUploads(
    uploads: { objectKey: string; fileName?: string }[],
  ): Promise<{ files: UploadedFile[] }> {
    return this.http.post('/merchant/files/confirm', { uploads });
  }

  /** Single-file upload through the API. Prefer `uploadFiles`. */
  uploadFile(file: File | Blob, filename?: string): Promise<UploadedFile> {
    const form = new FormData();
    form.append('file', file, filename);
    return this.http.upload('/merchant/files/upload', form);
  }

  /** React Native passes `{ uri, name, type }` rather than a Blob. */
  uploadFileNative(part: { uri: string; name: string; type: string }): Promise<UploadedFile> {
    const form = new FormData();
    form.append('file', part as unknown as Blob);
    return this.http.upload('/merchant/files/upload', form);
  }

  // ------------------------------------------------------- product images --

  /** Appends confirmed uploads to a product's gallery. */
  addProductImages(
    productId: string,
    images: {
      objectKey?: string;
      url?: string;
      alt?: string | null;
      fileName?: string | null;
      mimeType?: string | null;
      size?: number | null;
      isPrimary?: boolean;
    }[],
  ): Promise<ProductImage[]> {
    return this.http.post(`/merchant/products/${productId}/images`, { images });
  }

  /**
   * Reorders a gallery and sets the primary image.
   *
   * Send every image id, in the order you want them. Idempotent, so a retried
   * request cannot leave a half-applied order.
   */
  reorderProductImages(
    productId: string,
    imageIds: string[],
    primaryImageId?: string,
  ): Promise<ProductImage[]> {
    return this.http.patch(`/merchant/products/${productId}/images`, {
      imageIds,
      primaryImageId,
    });
  }

  /** Removes one image and the object behind it. */
  deleteProductImage(productId: string, imageId: string): Promise<void> {
    return this.http.delete(`/merchant/products/${productId}/images/${imageId}`);
  }
}

/**
 * PUTs one file to a presigned URL, reporting progress where the platform can.
 *
 * XHR rather than fetch, for one reason: `fetch` has no upload-progress event,
 * and a merchant uploading eight product photos on a phone connection needs to
 * see that something is happening. Where XHR is unavailable (React Native's
 * partial implementations, some test environments) it falls back to `fetch`
 * and reports 0 → 100.
 *
 * The signed headers are replayed exactly as issued — they are covered by the
 * signature, so changing or omitting one makes the object store reject the PUT.
 */
function putToStorage(
  ticket: UploadTicket,
  file: File | Blob,
  signal: AbortSignal | undefined,
  onProgress: (percent: number) => void,
): Promise<void> {
  if (typeof XMLHttpRequest === 'undefined') {
    return fetch(ticket.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: ticket.headers,
      signal,
    }).then((res) => {
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      onProgress(100);
    });
  }

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.uploadUrl, true);
    for (const [name, value] of Object.entries(ticket.headers)) {
      xhr.setRequestHeader(name, value);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () =>
      reject(new Error('Could not reach storage. Check your connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));

    if (signal) {
      if (signal.aborted) return reject(new Error('Upload cancelled'));
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(file);
  });
}
