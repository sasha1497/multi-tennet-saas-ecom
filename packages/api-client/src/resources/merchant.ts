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
} from '@retailos/types';
import type { HttpClient } from '../http';

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
  size: number;
  mimeType: string;
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
}
