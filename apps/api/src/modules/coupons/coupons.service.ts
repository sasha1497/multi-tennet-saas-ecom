import { Injectable } from '@nestjs/common';
import type { Coupon, Money, PaginatedResult } from '@retailos/types';
import type { CreateCouponInput } from '@retailos/validation';
import { Errors } from '@/common/errors/app.exception';
import { paginate, toPrismaPage } from '@/common/utils/pagination';
import {
  TenantDatabaseService,
  type TenantTransactionClient,
} from '@/core/database/tenant-database.service';
import type { CouponConfig } from '@/modules/cart/pricing.service';

@Injectable()
export class CouponsService {
  constructor(private readonly tenantDb: TenantDatabaseService) {}

  /**
   * Validates a coupon for a specific cart.
   *
   * Checks, in the order a shopper would care about them: does it exist, is it
   * live, is the window open, is the global cap spent, has *this* customer used
   * it up, and does the cart clear the minimum. Each failure gets its own
   * message so the storefront can say why rather than "invalid coupon".
   */
  async validate(
    code: string,
    context: { subtotal: Money; customerId: string | null },
  ): Promise<CouponConfig> {
    const normalised = code.trim().toUpperCase();

    const coupon = await this.tenantDb.run((db) =>
      db.coupon.findFirst({ where: { code: normalised, deletedAt: null } }),
    );

    if (!coupon) throw Errors.couponInvalid('This coupon code is not valid');
    if (!coupon.isActive) throw Errors.couponInvalid('This coupon is no longer active');

    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      throw Errors.couponInvalid('This coupon is not active yet');
    }
    if (coupon.endsAt && coupon.endsAt < now) {
      throw Errors.couponInvalid('This coupon has expired');
    }
    if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
      throw Errors.couponInvalid('This coupon has reached its usage limit');
    }
    if (context.subtotal < coupon.minOrderAmount) {
      throw Errors.couponInvalid(
        `Add ${formatPaise(coupon.minOrderAmount - context.subtotal)} more to use this coupon`,
      );
    }

    if (coupon.perCustomerLimit !== null && context.customerId) {
      const used = await this.tenantDb.run((db) =>
        db.couponRedemption.count({
          where: { couponId: coupon.id, customerId: context.customerId },
        }),
      );
      if (used >= coupon.perCustomerLimit) {
        throw Errors.couponInvalid('You have already used this coupon');
      }
    }

    return {
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      maxDiscountAmount: coupon.maxDiscountAmount,
      minOrderAmount: coupon.minOrderAmount,
      description: coupon.description,
    };
  }

  /**
   * Records a redemption inside the order transaction.
   *
   * The conditional UPDATE is what keeps a "first 100 customers" coupon honest
   * under concurrency: the 101st simultaneous checkout matches zero rows.
   */
  async redeem(
    tx: TenantTransactionClient,
    params: { code: string; orderId: string; customerId: string | null; amount: Money },
  ): Promise<void> {
    const coupon = await tx.coupon.findFirst({
      where: { code: params.code, deletedAt: null },
      select: { id: true, usageLimit: true },
    });
    if (!coupon) return;

    const claimed =
      coupon.usageLimit === null
        ? await tx.$executeRaw`
            UPDATE coupons SET usage_count = usage_count + 1, updated_at = NOW()
             WHERE id = ${coupon.id}::uuid`
        : await tx.$executeRaw`
            UPDATE coupons SET usage_count = usage_count + 1, updated_at = NOW()
             WHERE id = ${coupon.id}::uuid AND usage_count < usage_limit`;

    if (claimed === 0) {
      throw Errors.couponInvalid('This coupon has just reached its usage limit');
    }

    await tx.couponRedemption.create({
      data: {
        couponId: coupon.id,
        customerId: params.customerId,
        orderId: params.orderId,
        amount: params.amount,
      },
    });
  }

  /** Reverses a redemption when an order is cancelled before fulfilment. */
  async release(tx: TenantTransactionClient, orderId: string): Promise<void> {
    const redemption = await tx.couponRedemption.findUnique({ where: { orderId } });
    if (!redemption) return;

    await tx.$executeRaw`
      UPDATE coupons SET usage_count = GREATEST(0, usage_count - 1), updated_at = NOW()
       WHERE id = ${redemption.couponId}::uuid`;
    await tx.couponRedemption.delete({ where: { orderId } });
  }

  // ------------------------------------------------------------- merchant --

  async list(query: { page?: number; limit?: number }): Promise<PaginatedResult<Coupon>> {
    const { skip, take, page, limit } = toPrismaPage(query);
    const [rows, total] = await this.tenantDb.run((db) =>
      Promise.all([
        db.coupon.findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        db.coupon.count({ where: { deletedAt: null } }),
      ]),
    );
    return paginate(rows.map(toApi), total, page, limit);
  }

  /** Coupons a shopper can actually see and use right now. */
  async availableForStorefront(): Promise<Coupon[]> {
    const now = new Date();
    const rows = await this.tenantDb.run((db) =>
      db.coupon.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
    return rows
      .filter((c) => c.usageLimit === null || c.usageCount < c.usageLimit)
      .map(toApi);
  }

  async create(input: CreateCouponInput): Promise<Coupon> {
    const code = input.code.trim().toUpperCase();

    const existing = await this.tenantDb.run((db) =>
      db.coupon.findFirst({ where: { code, deletedAt: null }, select: { id: true } }),
    );
    if (existing) throw Errors.duplicate('coupon', 'code');

    const row = await this.tenantDb.run((db) =>
      db.coupon.create({
        data: {
          code,
          description: input.description ?? null,
          discountType: input.discountType,
          discountValue: input.discountValue,
          maxDiscountAmount: input.maxDiscountAmount ?? null,
          minOrderAmount: input.minOrderAmount ?? 0,
          usageLimit: input.usageLimit ?? null,
          perCustomerLimit: input.perCustomerLimit ?? null,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          isActive: input.isActive ?? true,
        },
      }),
    );
    return toApi(row);
  }

  async update(id: string, input: Partial<CreateCouponInput>): Promise<Coupon> {
    const existing = await this.tenantDb.run((db) =>
      db.coupon.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw Errors.notFound('Coupon', id);

    const row = await this.tenantDb.run((db) =>
      db.coupon.update({
        where: { id },
        data: {
          description: input.description !== undefined ? input.description : existing.description,
          discountType: input.discountType ?? existing.discountType,
          discountValue: input.discountValue ?? existing.discountValue,
          maxDiscountAmount:
            input.maxDiscountAmount !== undefined
              ? input.maxDiscountAmount
              : existing.maxDiscountAmount,
          minOrderAmount: input.minOrderAmount ?? existing.minOrderAmount,
          usageLimit: input.usageLimit !== undefined ? input.usageLimit : existing.usageLimit,
          perCustomerLimit:
            input.perCustomerLimit !== undefined
              ? input.perCustomerLimit
              : existing.perCustomerLimit,
          startsAt: input.startsAt !== undefined
            ? input.startsAt ? new Date(input.startsAt) : null
            : existing.startsAt,
          endsAt: input.endsAt !== undefined
            ? input.endsAt ? new Date(input.endsAt) : null
            : existing.endsAt,
          isActive: input.isActive ?? existing.isActive,
        },
      }),
    );
    return toApi(row);
  }

  /** Soft delete — redemption history on past orders must stay readable. */
  async remove(id: string): Promise<void> {
    const existing = await this.tenantDb.run((db) =>
      db.coupon.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw Errors.notFound('Coupon', id);

    await this.tenantDb.run((db) =>
      db.coupon.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
    );
  }
}

function toApi(row: {
  id: string;
  code: string;
  description: string | null;
  discountType: string;
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}): Coupon {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    discountType: row.discountType as Coupon['discountType'],
    discountValue: row.discountValue,
    maxDiscountAmount: row.maxDiscountAmount,
    minOrderAmount: row.minOrderAmount,
    usageLimit: row.usageLimit,
    usageCount: row.usageCount,
    perCustomerLimit: row.perCustomerLimit,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

function formatPaise(amount: Money): string {
  return `₹${(amount / 100).toFixed(2)}`;
}
