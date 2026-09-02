import type {
  Address,
  AddCartItemRequest,
  Brand,
  Cart,
  CategoryTreeNode,
  Coupon,
  CreateAddressRequest,
  CreateOrderRequest,
  CreateOrderResponse,
  CreateReviewRequest,
  CustomerProfile,
  Notification,
  Order,
  OrderListItem,
  OrderQuery,
  OrderTracking,
  PaginatedResult,
  Product,
  ProductListItem,
  ProductQuery,
  Review,
  StorefrontBootstrap,
  UpdateAddressRequest,
  UpdateCustomerProfileRequest,
  VerifyPaymentRequest,
  VerifyPaymentResponse,
  WishlistItem,
} from '@retailos/types';
import type { HttpClient } from '../http';

/**
 * Storefront + mobile endpoints.
 *
 * Every call here is tenant-scoped by the request Host (or, for the mobile app,
 * by an `X-Tenant-Slug`-style hint the API re-resolves against the domain
 * registry). The client never sends a raw tenant id it made up.
 */
export class StorefrontResource {
  constructor(private readonly http: HttpClient) {}

  /** First call of every session: branding, settings and the category tree. */
  bootstrap(): Promise<StorefrontBootstrap> {
    return this.http.get('/store', { anonymous: true });
  }

  categories(): Promise<CategoryTreeNode[]> {
    return this.http.get('/categories', { anonymous: true });
  }

  brands(): Promise<Brand[]> {
    return this.http.get('/brands', { anonymous: true });
  }

  products(query: ProductQuery = {}): Promise<PaginatedResult<ProductListItem>> {
    return this.http.get('/products', { query: query as Record<string, unknown>, anonymous: true });
  }

  featuredProducts(limit = 8): Promise<ProductListItem[]> {
    return this.http.get('/products/featured', { query: { limit }, anonymous: true });
  }

  popularProducts(limit = 8): Promise<ProductListItem[]> {
    return this.http.get('/products/popular', { query: { limit }, anonymous: true });
  }

  productBySlug(slug: string): Promise<Product> {
    return this.http.get(`/products/${encodeURIComponent(slug)}`, { anonymous: true });
  }

  relatedProducts(productId: string, limit = 8): Promise<ProductListItem[]> {
    return this.http.get(`/products/${productId}/related`, { query: { limit }, anonymous: true });
  }

  search(term: string, limit = 10): Promise<ProductListItem[]> {
    return this.http.get('/products/search', { query: { q: term, limit }, anonymous: true });
  }

  // ---------------------------------------------------------------- cart --

  getCart(): Promise<Cart> {
    return this.http.get('/cart', { anonymous: true });
  }

  addToCart(body: AddCartItemRequest): Promise<Cart> {
    return this.http.post('/cart/items', body, { anonymous: true });
  }

  updateCartItem(itemId: string, quantity: number): Promise<Cart> {
    return this.http.patch(`/cart/items/${itemId}`, { quantity }, { anonymous: true });
  }

  removeCartItem(itemId: string): Promise<Cart> {
    return this.http.delete(`/cart/items/${itemId}`, { anonymous: true });
  }

  clearCart(): Promise<Cart> {
    return this.http.delete('/cart', { anonymous: true });
  }

  applyCoupon(code: string): Promise<Cart> {
    return this.http.post('/cart/coupon', { code }, { anonymous: true });
  }

  removeCoupon(): Promise<Cart> {
    return this.http.delete('/cart/coupon', { anonymous: true });
  }

  /** Merges the anonymous cart into the customer's cart after login. */
  mergeGuestCart(): Promise<Cart> {
    return this.http.post('/cart/merge');
  }

  // -------------------------------------------------------------- orders --

  createOrder(body: CreateOrderRequest): Promise<CreateOrderResponse> {
    return this.http.post('/orders', body);
  }

  orders(query: OrderQuery = {}): Promise<PaginatedResult<OrderListItem>> {
    return this.http.get('/orders', { query: query as Record<string, unknown> });
  }

  order(id: string): Promise<Order> {
    return this.http.get(`/orders/${id}`);
  }

  cancelOrder(id: string, reason: string): Promise<Order> {
    return this.http.post(`/orders/${id}/cancel`, { reason });
  }

  tracking(orderNumber: string): Promise<OrderTracking> {
    return this.http.get(`/orders/${encodeURIComponent(orderNumber)}/tracking`);
  }

  verifyPayment(body: VerifyPaymentRequest): Promise<VerifyPaymentResponse> {
    return this.http.post('/payments/verify', body);
  }

  /** Local-dev only: drives the mock gateway without a real provider. */
  simulatePayment(paymentId: string, outcome: 'success' | 'failure'): Promise<VerifyPaymentResponse> {
    return this.http.post(`/payments/mock/${paymentId}/${outcome}`, {});
  }

  // ------------------------------------------------------------- account --

  profile(): Promise<CustomerProfile> {
    return this.http.get('/me');
  }

  updateProfile(body: UpdateCustomerProfileRequest): Promise<CustomerProfile> {
    return this.http.patch('/me', body);
  }

  addresses(): Promise<Address[]> {
    return this.http.get('/addresses');
  }

  createAddress(body: CreateAddressRequest): Promise<Address> {
    return this.http.post('/addresses', body);
  }

  updateAddress(id: string, body: UpdateAddressRequest): Promise<Address> {
    return this.http.patch(`/addresses/${id}`, body);
  }

  deleteAddress(id: string): Promise<void> {
    return this.http.delete(`/addresses/${id}`);
  }

  wishlist(): Promise<WishlistItem[]> {
    return this.http.get('/wishlist');
  }

  addToWishlist(productId: string): Promise<WishlistItem> {
    return this.http.post('/wishlist', { productId });
  }

  removeFromWishlist(productId: string): Promise<void> {
    return this.http.delete(`/wishlist/${productId}`);
  }

  availableCoupons(): Promise<Coupon[]> {
    return this.http.get('/coupons/available', { anonymous: true });
  }

  reviews(productId: string, page = 1): Promise<PaginatedResult<Review>> {
    return this.http.get('/reviews', { query: { productId, page }, anonymous: true });
  }

  createReview(body: CreateReviewRequest): Promise<Review> {
    return this.http.post('/reviews', body);
  }

  notifications(): Promise<Notification[]> {
    return this.http.get('/notifications');
  }

  markNotificationRead(id: string): Promise<void> {
    return this.http.post(`/notifications/${id}/read`);
  }

  registerPushToken(token: string, platform: 'ios' | 'android' | 'web'): Promise<void> {
    return this.http.post('/notifications/push-token', { token, platform });
  }
}
