import { Injectable } from '@nestjs/common';
import type { PaginatedResult, Review } from '@retailos/types';
import { Errors } from '@/common/errors/app.exception';
import { paginate, toPrismaPage } from '@/common/utils/pagination';
import { CacheService } from '@/core/cache/cache.service';
import { RequestContextService } from '@/core/context/request-context';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly tenantDb: TenantDatabaseService,
    private readonly context: RequestContextService,
    private readonly cache: CacheService,
  ) {}

  /** Public listing — only approved reviews are ever visible to shoppers. */
  async listPublic(
    productId: string,
    query: { page?: number; limit?: number },
  ): Promise<PaginatedResult<Review>> {
    const { skip, take, page, limit } = toPrismaPage(query);
    const where = { productId, isApproved: true, deletedAt: null };

    const [rows, total] = await this.tenantDb.run((db) =>
      Promise.all([
        db.review.findMany({
          where,
          include: { customer: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        db.review.count({ where }),
      ]),
    );

    return paginate(rows.map(toApi), total, page, limit);
  }

  async listForMerchant(query: {
    page?: number;
    limit?: number;
    isApproved?: boolean;
  }): Promise<PaginatedResult<Review>> {
    const { skip, take, page, limit } = toPrismaPage(query);
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.isApproved !== undefined) where.isApproved = query.isApproved;

    const [rows, total] = await this.tenantDb.run((db) =>
      Promise.all([
        db.review.findMany({
          where,
          include: { customer: { select: { firstName: true, lastName: true } } },
          orderBy: [{ isApproved: 'asc' }, { createdAt: 'desc' }],
          skip,
          take,
        }),
        db.review.count({ where }),
      ]),
    );

    return paginate(rows.map(toApi), total, page, limit);
  }

  /**
   * Creates a review.
   *
   * Reviews start unapproved: a storefront that publishes arbitrary customer
   * text unmoderated is a spam and abuse vector. `isVerifiedPurchase` is derived
   * from delivered orders, never taken from the client.
   */
  async create(input: {
    productId: string;
    rating: number;
    title?: string | null;
    comment?: string | null;
    orderId?: string | null;
  }): Promise<Review> {
    const customerId = this.requireCustomerId();

    const product = await this.tenantDb.run((db) =>
      db.product.findFirst({
        where: { id: input.productId, deletedAt: null },
        select: { id: true },
      }),
    );
    if (!product) throw Errors.notFound('Product', input.productId);

    const purchased = await this.tenantDb.run((db) =>
      db.orderItem.findFirst({
        where: {
          productId: input.productId,
          order: { customerId, status: { in: ['DELIVERED', 'SHIPPED', 'OUT_FOR_DELIVERY'] } },
        },
        select: { id: true, orderId: true },
      }),
    );

    const row = await this.tenantDb.run((db) =>
      db.review
        .create({
          data: {
            productId: input.productId,
            customerId,
            orderId: input.orderId ?? purchased?.orderId ?? null,
            rating: input.rating,
            title: input.title ?? null,
            comment: input.comment ?? null,
            isApproved: false,
            isVerifiedPurchase: Boolean(purchased),
          },
          include: { customer: { select: { firstName: true, lastName: true } } },
        })
        .catch((err: { code?: string }) => {
          if (err.code === 'P2002') {
            throw Errors.duplicate('review', 'product');
          }
          throw err;
        }),
    );

    return toApi(row);
  }

  /** Approving or rejecting recomputes the product's rating aggregates. */
  async moderate(id: string, isApproved: boolean): Promise<Review> {
    const row = await this.tenantDb.transaction(async (tx) => {
      const review = await tx.review.findFirst({ where: { id, deletedAt: null } });
      if (!review) throw Errors.notFound('Review', id);

      const updated = await tx.review.update({
        where: { id },
        data: { isApproved },
        include: { customer: { select: { firstName: true, lastName: true } } },
      });

      const stats = await tx.review.aggregate({
        where: { productId: review.productId, isApproved: true, deletedAt: null },
        _avg: { rating: true },
        _count: { _all: true },
      });

      await tx.product.update({
        where: { id: review.productId },
        data: {
          ratingAverage: stats._avg.rating ?? 0,
          ratingCount: stats._count._all,
        },
      });

      return updated;
    });

    await this.cache.invalidateCatalog(this.tenantDb.tenantId);
    return toApi(row);
  }

  private requireCustomerId(): string {
    const auth = this.context.auth;
    if (!auth || auth.audience !== 'customer') throw Errors.unauthenticated();
    return auth.userId;
  }
}

function toApi(row: {
  id: string;
  productId: string;
  customerId: string;
  orderId: string | null;
  rating: number;
  title: string | null;
  comment: string | null;
  isApproved: boolean;
  isVerifiedPurchase: boolean;
  createdAt: Date;
  customer: { firstName: string; lastName: string };
}): Review {
  // Show "Priya S." rather than a full surname — a small privacy courtesy.
  const surnameInitial = row.customer.lastName ? `${row.customer.lastName[0]}.` : '';
  return {
    id: row.id,
    productId: row.productId,
    customerId: row.customerId,
    customerName: `${row.customer.firstName} ${surnameInitial}`.trim(),
    orderId: row.orderId,
    rating: row.rating,
    title: row.title,
    comment: row.comment,
    isApproved: row.isApproved,
    isVerifiedPurchase: row.isVerifiedPurchase,
    createdAt: row.createdAt.toISOString(),
  };
}
