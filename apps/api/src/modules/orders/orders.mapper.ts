import { ORDER_STATUS_LABELS, ORDER_TIMELINE_STEPS } from '@retailos/config';
import type {
  AddressSnapshot,
  Order,
  OrderItem,
  OrderListItem,
  OrderStatus,
  OrderStatusHistoryEntry,
  OrderTracking,
  PaymentStatus,
} from '@retailos/types';

type OrderRow = {
  id: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingAmount: number;
  totalAmount: number;
  currency: string;
  taxInclusive: boolean;
  couponCode: string | null;
  shippingAddress: unknown;
  billingAddress: unknown;
  notes: string | null;
  internalNotes: string | null;
  cancellationReason: string | null;
  placedAt: Date;
  confirmedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  estimatedDeliveryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items?: OrderItemRow[];
  statusHistory?: StatusRow[];
  payments?: PaymentRow[];
};

type OrderItemRow = {
  id: string;
  productId: string;
  variantId: string;
  productName: string;
  productSlug: string;
  variantLabel: string;
  sku: string;
  imageUrl: string | null;
  variantOptions: unknown;
  unitPrice: number;
  mrp: number;
  quantity: number;
  discountAmount: number;
  taxRateBps: number;
  taxAmount: number;
  lineTotal: number;
  createdAt: Date;
};

type StatusRow = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  changedBy: string | null;
  changedByType: string;
  createdAt: Date;
};

type PaymentRow = {
  id: string;
  provider: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  paidAt: Date | null;
  failureReason: string | null;
  refundedAmount: number;
  createdAt: Date;
};

/**
 * `scope: 'customer'` strips merchant-only fields.
 *
 * `internalNotes` in particular is staff-private — a shopper must never see the
 * shop's note about their order.
 */
export function mapOrder(row: OrderRow, scope: 'customer' | 'merchant' = 'merchant'): Order {
  const payment = row.payments?.[0];

  const order: Order = {
    id: row.id,
    orderNumber: row.orderNumber,
    customerId: row.customerId,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    status: row.status as OrderStatus,
    paymentStatus: row.paymentStatus as PaymentStatus,
    paymentMethod: row.paymentMethod as Order['paymentMethod'],
    items: (row.items ?? []).map(mapOrderItem),
    subtotal: row.subtotal,
    discountAmount: row.discountAmount,
    taxAmount: row.taxAmount,
    shippingAmount: row.shippingAmount,
    totalAmount: row.totalAmount,
    currency: row.currency,
    taxInclusive: row.taxInclusive,
    couponCode: row.couponCode,
    shippingAddress: row.shippingAddress as AddressSnapshot,
    billingAddress: (row.billingAddress ?? null) as AddressSnapshot | null,
    notes: row.notes,
    cancellationReason: row.cancellationReason,
    statusHistory: (row.statusHistory ?? []).map(mapStatusEntry),
    payment: payment
      ? {
          id: payment.id,
          provider: payment.provider,
          method: payment.method as Order['paymentMethod'],
          status: payment.status as PaymentStatus,
          amount: payment.amount,
          currency: payment.currency,
          providerPaymentId: payment.providerPaymentId,
          providerOrderId: payment.providerOrderId,
          paidAt: payment.paidAt?.toISOString() ?? null,
          failureReason: payment.failureReason,
          refundedAmount: payment.refundedAmount,
          createdAt: payment.createdAt.toISOString(),
        }
      : null,
    placedAt: row.placedAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    estimatedDeliveryAt: row.estimatedDeliveryAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (scope === 'merchant') {
    order.internalNotes = row.internalNotes;
  }

  return order;
}

export function mapOrderItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    productId: row.productId,
    variantId: row.variantId,
    productName: row.productName,
    productSlug: row.productSlug,
    variantLabel: row.variantLabel,
    sku: row.sku,
    imageUrl: row.imageUrl,
    variantOptions: (row.variantOptions ?? {}) as Record<string, string>,
    unitPrice: row.unitPrice,
    mrp: row.mrp,
    quantity: row.quantity,
    discountAmount: row.discountAmount,
    taxRateBps: row.taxRateBps,
    taxAmount: row.taxAmount,
    lineTotal: row.lineTotal,
    createdAt: row.createdAt.toISOString(),
  };
}

export function mapStatusEntry(row: StatusRow): OrderStatusHistoryEntry {
  return {
    id: row.id,
    fromStatus: (row.fromStatus ?? null) as OrderStatus | null,
    toStatus: row.toStatus as OrderStatus,
    note: row.note,
    changedBy: row.changedBy,
    changedByType: row.changedByType as OrderStatusHistoryEntry['changedByType'],
    createdAt: row.createdAt.toISOString(),
  };
}

export function mapOrderListItem(
  row: OrderRow & { _count?: { items: number }; items?: OrderItemRow[] },
): OrderListItem {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    status: row.status as OrderStatus,
    paymentStatus: row.paymentStatus as PaymentStatus,
    paymentMethod: row.paymentMethod as OrderListItem['paymentMethod'],
    totalAmount: row.totalAmount,
    itemCount: row._count?.items ?? row.items?.length ?? 0,
    currency: row.currency,
    placedAt: row.placedAt.toISOString(),
    thumbnailUrl: row.items?.[0]?.imageUrl ?? null,
  };
}

/**
 * Builds the progress timeline the storefront and mobile app render.
 *
 * A cancelled or refunded order gets a truncated timeline ending at the point it
 * stopped, rather than a misleading row of unreachable future steps.
 */
export function buildTracking(order: Order): OrderTracking {
  const reached = new Map<string, string>();
  for (const entry of order.statusHistory) {
    if (!reached.has(entry.toStatus)) reached.set(entry.toStatus, entry.createdAt);
  }

  const terminal = order.status === 'CANCELLED' || order.status === 'REFUNDED';

  const timeline = terminal
    ? order.statusHistory.map((entry) => ({
        status: entry.toStatus,
        label: ORDER_STATUS_LABELS[entry.toStatus],
        at: entry.createdAt,
        done: true,
      }))
    : ORDER_TIMELINE_STEPS.map((step) => ({
        status: step.status as OrderStatus,
        label: step.label,
        at: reached.get(step.status) ?? null,
        done: reached.has(step.status),
      }));

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    statusHistory: order.statusHistory,
    estimatedDeliveryAt: order.estimatedDeliveryAt,
    placedAt: order.placedAt,
    timeline,
  };
}
