import { Inject, Injectable, forwardRef } from '@nestjs/common';
import {
  AuditAction,
  CUSTOMER_CANCELLABLE_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  type AddressSnapshot,
  type CreateOrderResponse,
  type Order,
  type OrderListItem,
  type OrderStatus,
  type OrderTracking,
  type PaginatedResult,
} from '@retailos/types';
import type { CreateOrderInput, OrderQueryInput } from '@retailos/validation';
import { Errors } from '@/common/errors/app.exception';
import { buildOrderBy, escapeLike, normaliseSearch, paginate, toPrismaPage } from '@/common/utils/pagination';
import { RequestContextService } from '@/core/context/request-context';
import {
  TenantDatabaseService,
  type TenantTransactionClient,
} from '@/core/database/tenant-database.service';
import { AppLogger } from '@/core/logger/logger.service';
import { QueueService } from '@/core/queue/queue.service';
import { AuditService } from '@/modules/audit/audit.service';
import { CouponsService } from '@/modules/coupons/coupons.service';
import { InventoryService } from '@/modules/inventory/inventory.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { PricingService, type PricingLine } from '@/modules/cart/pricing.service';
import { StoreService } from '@/modules/store/store.service';
import { buildTracking, mapOrder, mapOrderListItem } from './orders.mapper';

const ORDER_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'desc' } },
} as const;

const SORTABLE = ['placedAt', 'totalAmount', 'status', 'createdAt'] as const;

@Injectable()
export class OrdersService {
  private readonly logger: AppLogger;

  constructor(
    private readonly tenantDb: TenantDatabaseService,
    private readonly context: RequestContextService,
    private readonly pricing: PricingService,
    private readonly store: StoreService,
    private readonly inventory: InventoryService,
    private readonly coupons: CouponsService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => PaymentsService)) private readonly payments: PaymentsService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('OrdersService');
  }

  // ========================================================== checkout ==

  /**
   * Places an order.
   *
   * Everything that must succeed or fail together happens in one transaction:
   * stock reservation, order + line snapshots, coupon redemption, the payment
   * record and clearing the cart. If any step throws — most commonly a stock
   * race — nothing is written and the shopper gets a precise error.
   *
   * The gateway call is deliberately *outside* the transaction: a third-party
   * HTTP round trip must never hold row locks on inventory.
   *
   * Idempotency: the client sends a key, stored on a unique index. A double-tap
   * on "Place order" returns the original order rather than charging twice.
   */
  async create(input: CreateOrderInput): Promise<CreateOrderResponse> {
    const tenant = this.context.requireTenant();
    const customerId = this.requireCustomerId();

    // Fast path for a retry — avoids doing any of the work below twice.
    const existing = await this.tenantDb.run((db) =>
      db.order.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: ORDER_INCLUDE,
      }),
    );
    if (existing) {
      this.logger.info('Returning existing order for idempotency key', {
        orderId: existing.id,
        key: input.idempotencyKey,
      });
      return { order: mapOrder(existing as never, 'customer'), payment: null };
    }

    const settings = await this.store.getPricingConfig();

    if (input.paymentMethod === 'COD' && !settings.codEnabled) {
      throw Errors.badRequest('Cash on delivery is not available for this store');
    }
    if (input.paymentMethod !== 'COD' && !settings.onlinePaymentEnabled) {
      throw Errors.badRequest('Online payment is not available for this store');
    }

    const created = await this.tenantDb.transaction(
      async (tx) => {
        // ---- cart ------------------------------------------------------
        const cart = await tx.cart.findFirst({
          where: { customerId },
          include: {
            items: {
              include: {
                variant: {
                  include: {
                    inventory: true,
                    product: {
                      select: {
                        id: true,
                        name: true,
                        slug: true,
                        status: true,
                        deletedAt: true,
                        taxRateBps: true,
                        images: { where: { isPrimary: true }, take: 1, select: { url: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!cart || cart.items.length === 0) throw Errors.cartEmpty();

        // ---- re-validate every line against the live catalog ------------
        const lines: PricingLine[] = [];
        for (const item of cart.items) {
          const { variant } = item;
          const product = variant.product;

          if (product.deletedAt || product.status !== 'PUBLISHED' || !variant.isActive) {
            throw Errors.badRequest(`${product.name} is no longer available`);
          }

          lines.push({
            variantId: variant.id,
            productId: product.id,
            quantity: item.quantity,
            // Live price, not the cart's remembered one — the server decides.
            unitPrice: variant.price,
            mrp: variant.mrp,
            taxRateBps: product.taxRateBps,
          });
        }

        const customer = await tx.customer.findUniqueOrThrow({
          where: { id: customerId },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true },
        });

        // ---- coupon + pricing -------------------------------------------
        const coupon = cart.couponCode
          ? await this.coupons.validate(cart.couponCode, {
              subtotal: lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
              customerId,
            })
          : null;

        const priced = this.pricing.price(lines, settings, coupon);
        this.pricing.assertMeetsMinimum(priced.totals, settings);

        // ---- addresses (snapshot, never a reference) ---------------------
        const shippingAddress = await this.resolveAddress(
          tx,
          customerId,
          input.shippingAddressId,
          normaliseSnapshot(input.shippingAddress),
        );
        const billingAddress = input.billingAddressId
          ? await this.resolveAddress(tx, customerId, input.billingAddressId, undefined)
          : normaliseSnapshot(input.billingAddress);

        // ---- stock ------------------------------------------------------
        // Reserve before writing the order: if the last unit just sold, we fail
        // here and no order or payment record is ever created.
        for (const line of lines) {
          await this.inventory.reserve(
            tx,
            line.variantId,
            line.quantity,
            { type: 'order', id: input.idempotencyKey },
            { allowBackorder: settings.allowBackorder },
          );
        }

        const orderNumber = await this.store.nextOrderNumber(tx as never);

        // COD needs no gateway round trip, so it is confirmed immediately and
        // its reservation is converted to a sale in the same transaction.
        const isCod = input.paymentMethod === 'COD';
        const status: OrderStatus = isCod ? 'CONFIRMED' : 'PENDING';

        const order = await tx.order.create({
          data: {
            orderNumber,
            customerId,
            customerName: `${customer.firstName} ${customer.lastName}`.trim(),
            customerEmail: customer.email,
            customerPhone: customer.phone,
            status,
            paymentStatus: 'PENDING',
            paymentMethod: input.paymentMethod,
            subtotal: priced.totals.subtotal,
            discountAmount: priced.totals.discount,
            taxAmount: priced.totals.tax,
            shippingAmount: priced.totals.shipping,
            totalAmount: priced.totals.total,
            currency: priced.totals.currency,
            taxInclusive: settings.taxInclusivePricing,
            couponCode: coupon?.code ?? null,
            shippingAddress: shippingAddress as never,
            billingAddress: (billingAddress ?? null) as never,
            notes: input.notes ?? null,
            idempotencyKey: input.idempotencyKey,
            confirmedAt: isCod ? new Date() : null,
            // A simple, honest promise; a real delivery module would refine it.
            estimatedDeliveryAt: new Date(Date.now() + 4 * 86_400_000),
          },
        });

        // ---- immutable line snapshots ------------------------------------
        for (const [index, line] of priced.lines.entries()) {
          const cartItem = cart.items[index];
          const variant = cartItem.variant;
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: line.productId,
              variantId: line.variantId,
              // Everything below is frozen: editing the product later must not
              // rewrite what the customer actually bought.
              productName: variant.product.name,
              productSlug: variant.product.slug,
              variantLabel: variant.label,
              sku: variant.sku,
              imageUrl: variant.imageUrl ?? variant.product.images[0]?.url ?? null,
              variantOptions: variant.options as never,
              unitPrice: line.unitPrice,
              mrp: line.mrp,
              quantity: line.quantity,
              discountAmount: line.discountAmount,
              taxRateBps: line.taxRateBps,
              taxAmount: line.taxAmount,
              lineTotal: line.lineTotal,
            },
          });
        }

        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: null,
            toStatus: status,
            note: isCod ? 'Order placed (cash on delivery)' : 'Order placed, awaiting payment',
            changedBy: customerId,
            changedByType: 'CUSTOMER',
          },
        });

        if (coupon) {
          await this.coupons.redeem(tx, {
            code: coupon.code,
            orderId: order.id,
            customerId,
            amount: priced.totals.discount,
          });
        }

        if (isCod) {
          for (const line of lines) {
            await this.inventory.commit(tx, line.variantId, line.quantity, {
              type: 'order',
              id: order.id,
            });
          }
          await this.bumpSoldCounters(tx, lines);
          await this.bumpCustomerAggregates(tx, customerId, priced.totals.total);
        }

        const { paymentId } = await this.payments.createPaymentRecord(tx, {
          orderId: order.id,
          orderNumber,
          amount: priced.totals.total,
          currency: priced.totals.currency,
          method: input.paymentMethod,
        });

        // The cart has become an order; empty it so a refresh does not re-order.
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.cart.update({ where: { id: cart.id }, data: { couponCode: null } });

        const full = await tx.order.findUniqueOrThrow({
          where: { id: order.id },
          include: ORDER_INCLUDE,
        });

        return { order: full, paymentId, customer, isCod };
      },
      { timeout: 20_000 },
    );

    // ---- outside the transaction ---------------------------------------
    let paymentIntent: CreateOrderResponse['payment'] = null;

    if (!created.isCod) {
      const intent = await this.payments.attachProviderIntent({
        tenantId: tenant.tenantId,
        tenantSlug: tenant.slug,
        paymentId: created.paymentId,
        orderId: created.order.id,
        orderNumber: created.order.orderNumber,
        amount: created.order.totalAmount,
        currency: created.order.currency,
        method: input.paymentMethod,
        customer: {
          name: created.order.customerName,
          email: created.order.customerEmail,
          phone: created.order.customerPhone,
        },
      });

      paymentIntent = {
        paymentId: intent.paymentId,
        provider: intent.provider,
        providerOrderId: intent.providerOrderId,
        publicKey: intent.publicKey,
        amount: intent.amount,
        currency: intent.currency,
        checkoutUrl: intent.checkoutUrl ?? null,
      };
    } else {
      await this.tenantDb.run((db) =>
        db.payment.update({
          where: { id: created.paymentId },
          data: { status: 'PENDING' },
        }),
      );
    }

    await this.queue.orderPlaced({ tenantId: tenant.tenantId, orderId: created.order.id });

    this.audit.record('tenant', {
      action: AuditAction.ORDER_CREATED,
      resourceType: 'order',
      resourceId: created.order.id,
      metadata: {
        orderNumber: created.order.orderNumber,
        total: created.order.totalAmount,
        method: input.paymentMethod,
      },
    });

    this.logger.info('Order placed', {
      orderId: created.order.id,
      orderNumber: created.order.orderNumber,
      total: created.order.totalAmount,
      method: input.paymentMethod,
    });

    return { order: mapOrder(created.order as never, 'customer'), payment: paymentIntent };
  }

  // ================================================ payment callbacks ==

  /** Payment captured: commit the reservation and confirm the order. */
  async onPaymentSucceeded(tenantId: string, orderId: string): Promise<void> {
    await this.tenantDb.transactionFor(tenantId, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) return;

      // Idempotent: a webhook arriving after the client verify finds it done.
      if (order.paymentStatus === 'PAID') return;

      await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: 'PAID',
          status: order.status === 'PENDING' ? 'CONFIRMED' : order.status,
          confirmedAt: order.confirmedAt ?? new Date(),
        },
      });

      if (order.status === 'PENDING') {
        for (const item of order.items) {
          await this.inventory.commit(tx, item.variantId, item.quantity, {
            type: 'order',
            id: orderId,
          });
        }
        await this.bumpSoldCounters(
          tx,
          order.items.map((i) => ({ variantId: i.variantId, productId: i.productId, quantity: i.quantity })),
        );
        if (order.customerId) {
          await this.bumpCustomerAggregates(tx, order.customerId, order.totalAmount);
        }

        await tx.orderStatusHistory.create({
          data: {
            orderId,
            fromStatus: 'PENDING',
            toStatus: 'CONFIRMED',
            note: 'Payment received',
            changedByType: 'SYSTEM',
          },
        });
      }
    });

    await this.queue.orderStatusChanged({
      tenantId,
      orderId,
      fromStatus: 'PENDING',
      toStatus: 'CONFIRMED',
    });
  }

  /** Payment failed: release the held stock so it goes back on sale. */
  async onPaymentFailed(tenantId: string, orderId: string, reason: string): Promise<void> {
    await this.tenantDb.transactionFor(tenantId, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order || order.status !== 'PENDING') return;

      for (const item of order.items) {
        await this.inventory.release(tx, item.variantId, item.quantity, {
          type: 'order',
          id: orderId,
        });
      }

      await this.coupons.release(tx, orderId);

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'CANCELLED',
          paymentStatus: 'FAILED',
          cancelledAt: new Date(),
          cancellationReason: reason.slice(0, 500),
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: 'PENDING',
          toStatus: 'CANCELLED',
          note: `Payment failed: ${reason}`.slice(0, 500),
          changedByType: 'SYSTEM',
        },
      });
    });

    this.logger.info('Order cancelled after payment failure', { tenantId, orderId, reason });
  }

  // ================================================== status transitions ==

  /**
   * Merchant status change, validated against the transition map.
   *
   * The map is the reason an order cannot jump from PENDING to DELIVERED: every
   * move must be a legal edge, so the timeline the customer sees stays coherent.
   */
  async updateStatus(
    orderId: string,
    to: OrderStatus,
    options: { note?: string; reason?: string },
  ): Promise<Order> {
    const tenantId = this.tenantDb.tenantId;
    const actorId = this.context.userId;

    const from = await this.tenantDb.transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) throw Errors.notFound('Order', orderId);

      const current = order.status as OrderStatus;
      if (current === to) return current;

      const allowed = ORDER_STATUS_TRANSITIONS[current] ?? [];
      if (!allowed.includes(to)) {
        throw Errors.invalidTransition(current, to);
      }

      const timestamps: Record<string, Date> = {};
      if (to === 'CONFIRMED') timestamps.confirmedAt = new Date();
      if (to === 'SHIPPED') timestamps.shippedAt = new Date();
      if (to === 'DELIVERED') timestamps.deliveredAt = new Date();
      if (to === 'CANCELLED') timestamps.cancelledAt = new Date();

      // Cancelling or refunding has to give the stock back, and which operation
      // that is depends on whether the sale was ever committed.
      if (to === 'CANCELLED') {
        for (const item of order.items) {
          if (current === 'PENDING') {
            await this.inventory.release(tx, item.variantId, item.quantity, {
              type: 'order',
              id: orderId,
            });
          } else {
            await this.inventory.restock(tx, item.variantId, item.quantity, {
              type: 'order',
              id: orderId,
            });
          }
        }
        await this.coupons.release(tx, orderId);
      }

      if (to === 'REFUNDED' && current !== 'CANCELLED') {
        for (const item of order.items) {
          await this.inventory.restock(tx, item.variantId, item.quantity, {
            type: 'order',
            id: orderId,
          });
        }
      }

      // COD is collected on delivery, so that is the point it becomes PAID.
      const paymentStatus =
        to === 'DELIVERED' && order.paymentMethod === 'COD' && order.paymentStatus === 'PENDING'
          ? 'PAID'
          : to === 'REFUNDED'
            ? 'REFUNDED'
            : order.paymentStatus;

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: to,
          paymentStatus,
          cancellationReason: to === 'CANCELLED' ? (options.reason ?? null) : order.cancellationReason,
          ...timestamps,
        },
      });

      if (to === 'DELIVERED' && order.paymentMethod === 'COD') {
        await tx.payment.updateMany({
          where: { orderId, status: 'PENDING' },
          data: { status: 'PAID', paidAt: new Date() },
        });
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: current,
          toStatus: to,
          note: options.note ?? options.reason ?? null,
          changedBy: actorId,
          changedByType: actorId ? 'STAFF' : 'SYSTEM',
        },
      });

      return current;
    });

    await this.queue.orderStatusChanged({ tenantId, orderId, fromStatus: from, toStatus: to });

    this.audit.record('tenant', {
      action: AuditAction.ORDER_STATUS_CHANGED,
      resourceType: 'order',
      resourceId: orderId,
      metadata: { from, to, note: options.note, reason: options.reason },
    });

    return this.findByIdForMerchant(orderId);
  }

  /** Customer-initiated cancellation, allowed only before dispatch. */
  async cancelByCustomer(orderId: string, reason: string): Promise<Order> {
    const customerId = this.requireCustomerId();

    const order = await this.tenantDb.run((db) =>
      db.order.findFirst({ where: { id: orderId, customerId }, select: { id: true, status: true } }),
    );
    if (!order) throw Errors.notFound('Order', orderId);

    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status as OrderStatus)) {
      throw Errors.badRequest(
        'This order can no longer be cancelled. Please contact the store for help.',
      );
    }

    await this.updateStatus(orderId, 'CANCELLED', { reason, note: 'Cancelled by customer' });
    return this.findByIdForCustomer(orderId);
  }

  // ============================================================ reading ==

  async listForCustomer(query: OrderQueryInput): Promise<PaginatedResult<OrderListItem>> {
    const customerId = this.requireCustomerId();
    return this.list({ ...query, customerId }, 'customer');
  }

  async listForMerchant(query: OrderQueryInput): Promise<PaginatedResult<OrderListItem>> {
    return this.list(query, 'merchant');
  }

  private async list(
    query: OrderQueryInput & { customerId?: string },
    scope: 'customer' | 'merchant',
  ): Promise<PaginatedResult<OrderListItem>> {
    const { skip, take, page, limit } = toPrismaPage(query);
    const search = normaliseSearch(query.search);

    const where: Record<string, unknown> = {};
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) {
      where.status = Array.isArray(query.status) ? { in: query.status } : query.status;
    }
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;

    if (query.dateFrom || query.dateTo) {
      where.placedAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    if (query.minAmount !== undefined || query.maxAmount !== undefined) {
      where.totalAmount = {
        ...(query.minAmount !== undefined ? { gte: query.minAmount } : {}),
        ...(query.maxAmount !== undefined ? { lte: query.maxAmount } : {}),
      };
    }

    if (search && scope === 'merchant') {
      const term = escapeLike(search);
      where.OR = [
        { orderNumber: { contains: term.toUpperCase() } },
        { customerName: { contains: term, mode: 'insensitive' } },
        { customerPhone: { contains: term } },
        { customerEmail: { contains: term, mode: 'insensitive' } },
      ];
    } else if (search) {
      where.orderNumber = { contains: escapeLike(search).toUpperCase() };
    }

    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, SORTABLE, {
      field: 'placedAt',
      order: 'desc',
    });

    const [rows, total] = await this.tenantDb.run((db) =>
      Promise.all([
        db.order.findMany({
          where,
          orderBy,
          skip,
          take,
          include: {
            _count: { select: { items: true } },
            items: { take: 1, select: { imageUrl: true } },
          },
        }),
        db.order.count({ where }),
      ]),
    );

    return paginate(rows.map((r) => mapOrderListItem(r as never)), total, page, limit);
  }

  async findByIdForMerchant(id: string): Promise<Order> {
    const row = await this.tenantDb.run((db) =>
      db.order.findUnique({ where: { id }, include: ORDER_INCLUDE }),
    );
    if (!row) throw Errors.notFound('Order', id);
    return mapOrder(row as never, 'merchant');
  }

  /** Scoped by customer id, so one shopper can never read another's order. */
  async findByIdForCustomer(id: string): Promise<Order> {
    const customerId = this.requireCustomerId();
    const row = await this.tenantDb.run((db) =>
      db.order.findFirst({ where: { id, customerId }, include: ORDER_INCLUDE }),
    );
    if (!row) throw Errors.notFound('Order', id);
    return mapOrder(row as never, 'customer');
  }

  async tracking(orderNumber: string): Promise<OrderTracking> {
    const customerId = this.requireCustomerId();
    const row = await this.tenantDb.run((db) =>
      db.order.findFirst({
        where: { orderNumber: orderNumber.toUpperCase(), customerId },
        include: ORDER_INCLUDE,
      }),
    );
    if (!row) throw Errors.notFound('Order', orderNumber);
    return buildTracking(mapOrder(row as never, 'customer'));
  }

  async updateInternalNotes(orderId: string, notes: string | null): Promise<Order> {
    await this.tenantDb.run((db) =>
      db.order.update({ where: { id: orderId }, data: { internalNotes: notes } }),
    );
    return this.findByIdForMerchant(orderId);
  }

  /**
   * Releases reservations for unpaid orders that have sat past the window.
   *
   * Without this an abandoned checkout would hold the last unit of stock
   * indefinitely. Run from the maintenance queue.
   */
  async releaseStaleReservations(tenantId: string, olderThanMinutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

    const stale = await this.tenantDb.runFor(tenantId, (db) =>
      db.order.findMany({
        where: { status: 'PENDING', paymentStatus: 'PENDING', placedAt: { lt: cutoff } },
        select: { id: true },
        take: 100,
      }),
    );

    for (const order of stale) {
      await this.onPaymentFailed(tenantId, order.id, 'Payment was not completed in time');
    }

    if (stale.length) {
      this.logger.info('Released stale order reservations', { tenantId, count: stale.length });
    }
    return stale.length;
  }

  // ========================================================== internals ==

  private requireCustomerId(): string {
    const auth = this.context.auth;
    if (!auth || auth.audience !== 'customer') {
      throw Errors.unauthenticated('Please sign in to continue');
    }
    return auth.userId;
  }

  /**
   * Produces the frozen address for an order.
   *
   * A saved address is copied by value: later edits to the customer's address
   * book must not silently rewrite where a past order was shipped.
   */
  private async resolveAddress(
    tx: TenantTransactionClient,
    customerId: string,
    addressId: string | undefined,
    inline: AddressSnapshot | undefined,
  ): Promise<AddressSnapshot> {
    if (addressId) {
      const address = await tx.address.findFirst({
        where: { id: addressId, customerId, deletedAt: null },
      });
      if (!address) throw Errors.notFound('Address', addressId);
      return {
        fullName: address.fullName,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2,
        landmark: address.landmark,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
      };
    }

    if (inline) return inline;
    throw Errors.badRequest('A shipping address is required');
  }

  private async bumpSoldCounters(
    tx: TenantTransactionClient,
    lines: { productId: string; quantity: number }[],
  ): Promise<void> {
    const byProduct = new Map<string, number>();
    for (const line of lines) {
      byProduct.set(line.productId, (byProduct.get(line.productId) ?? 0) + line.quantity);
    }
    for (const [productId, quantity] of byProduct) {
      await tx.product.update({
        where: { id: productId },
        data: { soldCount: { increment: quantity } },
      });
    }
  }

  private async bumpCustomerAggregates(
    tx: TenantTransactionClient,
    customerId: string,
    amount: number,
  ): Promise<void> {
    await tx.customer.update({
      where: { id: customerId },
      data: {
        orderCount: { increment: 1 },
        totalSpent: { increment: BigInt(amount) },
        lastOrderAt: new Date(),
      },
    });
  }
}

/**
 * Zod's `.nullish()` yields `string | null | undefined`, while an order's stored
 * snapshot uses `string | null`. This narrows the optional address fields once,
 * at the boundary, rather than casting at each use.
 */
function normaliseSnapshot(
  input:
    | {
        fullName: string;
        phone: string;
        line1: string;
        line2?: string | null;
        landmark?: string | null;
        city: string;
        state: string;
        postalCode: string;
        country: string;
      }
    | null
    | undefined,
): AddressSnapshot | undefined {
  if (!input) return undefined;
  return {
    fullName: input.fullName,
    phone: input.phone,
    line1: input.line1,
    line2: input.line2 ?? null,
    landmark: input.landmark ?? null,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
  };
}
