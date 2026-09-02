import { Money, PaginationQuery } from './common';
import { OrderStatus, PaymentMethod, PaymentStatus } from './enums';
import { AddressSnapshot } from './customer';

/**
 * An order line is an **immutable snapshot**. Renaming a product or changing its
 * price later must not alter historical orders — see docs/DATABASE.md §Orders.
 */
export interface OrderItem {
  id: string;
  productId: string;
  variantId: string;

  // --- frozen snapshot ---
  productName: string;
  productSlug: string;
  variantLabel: string;
  sku: string;
  imageUrl: string | null;
  /** Full option map as it was at purchase time. */
  variantOptions: Record<string, string>;

  unitPrice: Money;
  mrp: Money;
  quantity: number;
  /** Line-level share of the order discount. */
  discountAmount: Money;
  taxRateBps: number;
  taxAmount: Money;
  lineTotal: Money;

  createdAt: string;
}

export interface OrderStatusHistoryEntry {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  /** Platform user id, customer id, or 'system'. */
  changedBy: string | null;
  changedByType: 'STAFF' | 'CUSTOMER' | 'SYSTEM';
  createdAt: string;
}

export interface OrderPaymentSummary {
  id: string;
  provider: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: Money;
  currency: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  paidAt: string | null;
  failureReason: string | null;
  refundedAmount: Money;
  createdAt: string;
}

export interface Order {
  id: string;
  /** Human-facing sequential number, e.g. `KZ-2026-000123`. */
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;

  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;

  items: OrderItem[];

  subtotal: Money;
  discountAmount: Money;
  taxAmount: Money;
  shippingAmount: Money;
  totalAmount: Money;
  currency: string;

  couponCode: string | null;

  shippingAddress: AddressSnapshot;
  billingAddress: AddressSnapshot | null;

  notes: string | null;
  /** Internal staff-only note, never returned on customer endpoints. */
  internalNotes?: string | null;
  cancellationReason: string | null;

  statusHistory: OrderStatusHistoryEntry[];
  payment: OrderPaymentSummary | null;

  placedAt: string;
  confirmedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  estimatedDeliveryAt: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  customerName: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  totalAmount: Money;
  itemCount: number;
  currency: string;
  placedAt: string;
  /** First item's image, for compact list rendering. */
  thumbnailUrl: string | null;
}

export interface OrderQuery extends PaginationQuery {
  status?: OrderStatus | OrderStatus[];
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number;
  maxAmount?: number;
}

// ---------------------------------------------------------------- requests --

export interface CreateOrderRequest {
  /** Existing saved address, or a fresh one to snapshot. */
  shippingAddressId?: string;
  shippingAddress?: AddressSnapshot;
  billingAddressId?: string;
  billingAddress?: AddressSnapshot | null;
  paymentMethod: PaymentMethod;
  notes?: string | null;
  /**
   * Client-generated key. Replaying the same key returns the original order
   * instead of creating a duplicate — protects against double-tap checkout.
   */
  idempotencyKey: string;
}

export interface CreateOrderResponse {
  order: Order;
  /** Present for online payments; the client hands this to the gateway SDK. */
  payment: {
    paymentId: string;
    provider: string;
    providerOrderId: string | null;
    /** Public key/config the client SDK needs. Never a secret. */
    publicKey: string | null;
    amount: Money;
    currency: string;
    /** For the mock provider in local dev. */
    checkoutUrl?: string | null;
  } | null;
}

export interface UpdateOrderStatusRequest {
  status: OrderStatus;
  note?: string;
  /** Required when moving to CANCELLED. */
  reason?: string;
}

export interface CancelOrderRequest {
  reason: string;
}

/** Public tracking view — safe to expose without authentication via a token. */
export interface OrderTracking {
  orderNumber: string;
  status: OrderStatus;
  statusHistory: OrderStatusHistoryEntry[];
  estimatedDeliveryAt: string | null;
  placedAt: string;
  timeline: { status: OrderStatus; label: string; at: string | null; done: boolean }[];
}
