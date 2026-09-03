import { Injectable } from '@nestjs/common';
import type {
  Address,
  Customer,
  CustomerProfile,
  OrderListItem,
  PaginatedResult,
  WishlistItem,
} from '@retailos/types';
import type { AddressInput } from '@retailos/validation';
import { normalisePhone } from '@retailos/validation';
import { Errors } from '@/common/errors/app.exception';
import { bigIntToNumber } from '@/common/utils/serialization';
import { buildOrderBy, escapeLike, normaliseSearch, paginate, toPrismaPage } from '@/common/utils/pagination';
import { RequestContextService } from '@/core/context/request-context';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { mapProductListItem } from '@/modules/catalog/catalog.mapper';
import { mapOrderListItem } from '@/modules/orders/orders.mapper';

const SORTABLE = ['createdAt', 'lastOrderAt', 'orderCount', 'totalSpent', 'firstName'] as const;

@Injectable()
export class CustomersService {
  constructor(
    private readonly tenantDb: TenantDatabaseService,
    private readonly context: RequestContextService,
  ) {}

  // ============================================================ merchant ==

  async list(query: {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    isActive?: boolean;
    hasOrders?: boolean;
  }): Promise<PaginatedResult<Customer>> {
    const { skip, take, page, limit } = toPrismaPage(query);
    const search = normaliseSearch(query.search);

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.hasOrders) where.orderCount = { gt: 0 };

    if (search) {
      const term = escapeLike(search);
      where.OR = [
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: normalisePhone(term) || term } },
      ];
    }

    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, SORTABLE, {
      field: 'createdAt',
      order: 'desc',
    });

    const [rows, total] = await this.tenantDb.run((db) =>
      Promise.all([
        db.customer.findMany({ where, orderBy, skip, take }),
        db.customer.count({ where }),
      ]),
    );

    return paginate(rows.map(toCustomer), total, page, limit);
  }

  async findByIdForMerchant(id: string): Promise<Customer & { recentOrders: OrderListItem[] }> {
    const customer = await this.tenantDb.run((db) =>
      db.customer.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!customer) throw Errors.notFound('Customer', id);

    const orders = await this.tenantDb.run((db) =>
      db.order.findMany({
        where: { customerId: id },
        orderBy: { placedAt: 'desc' },
        take: 10,
        include: {
          _count: { select: { items: true } },
          items: { take: 1, select: { imageUrl: true } },
        },
      }),
    );

    return {
      ...toCustomer(customer),
      recentOrders: orders.map((o) => mapOrderListItem(o as never)),
    };
  }

  /**
   * Merchant-side edit.
   *
   * Deliberately narrow: a merchant may annotate or disable a customer, but
   * cannot touch their credentials, email or phone. Changing someone's login
   * details on their behalf is an account-takeover primitive, not a feature.
   */
  async updateByMerchant(
    id: string,
    input: { notes?: string | null; isActive?: boolean },
  ): Promise<Customer> {
    const existing = await this.tenantDb.run((db) =>
      db.customer.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw Errors.notFound('Customer', id);

    const row = await this.tenantDb.run((db) =>
      db.customer.update({
        where: { id },
        data: {
          notes: input.notes !== undefined ? input.notes : existing.notes,
          isActive: input.isActive ?? existing.isActive,
        },
      }),
    );
    return toCustomer(row);
  }

  // ============================================================ shopper ==

  async getOwnProfile(): Promise<CustomerProfile> {
    const customerId = this.requireCustomerId();
    const row = await this.tenantDb.run((db) =>
      db.customer.findFirst({ where: { id: customerId, deletedAt: null } }),
    );
    if (!row) throw Errors.unauthenticated();
    return toProfile(row);
  }

  async updateOwnProfile(input: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    avatarUrl?: string | null;
  }): Promise<CustomerProfile> {
    const customerId = this.requireCustomerId();

    // Uniqueness is enforced by an index, but checking first gives a message a
    // human can act on rather than a raw constraint violation.
    if (input.email || input.phone) {
      const clash = await this.tenantDb.run((db) =>
        db.customer.findFirst({
          where: {
            id: { not: customerId },
            OR: [
              ...(input.email ? [{ email: input.email.toLowerCase() }] : []),
              ...(input.phone ? [{ phone: normalisePhone(input.phone) }] : []),
            ],
          },
          select: { id: true, email: true },
        }),
      );
      if (clash) {
        throw Errors.duplicate(
          'account',
          clash.email === input.email?.toLowerCase() ? 'email' : 'phone number',
        );
      }
    }

    const row = await this.tenantDb.run((db) =>
      db.customer.update({
        where: { id: customerId },
        data: {
          ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
          // Changing a verified contact resets verification.
          ...(input.email !== undefined
            ? { email: input.email.toLowerCase(), emailVerified: false }
            : {}),
          ...(input.phone !== undefined
            ? { phone: normalisePhone(input.phone), phoneVerified: false }
            : {}),
          ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
        },
      }),
    );

    return toProfile(row);
  }

  // =========================================================== addresses ==

  async listAddresses(): Promise<Address[]> {
    const customerId = this.requireCustomerId();
    const rows = await this.tenantDb.run((db) =>
      db.address.findMany({
        where: { customerId, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }),
    );
    return rows.map(toAddress);
  }

  async createAddress(input: AddressInput): Promise<Address> {
    const customerId = this.requireCustomerId();

    const row = await this.tenantDb.transaction(async (tx) => {
      const count = await tx.address.count({ where: { customerId, deletedAt: null } });
      // The first address is always the default, whatever the client asked for.
      const isDefault = input.isDefault || count === 0;

      if (isDefault) {
        // A partial unique index enforces one default; clear the old one first.
        await tx.address.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: {
          customerId,
          type: input.type,
          label: input.label ?? null,
          fullName: input.fullName,
          phone: normalisePhone(input.phone),
          line1: input.line1,
          line2: input.line2 ?? null,
          landmark: input.landmark ?? null,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
          country: input.country,
          isDefault,
        },
      });
    });

    return toAddress(row);
  }

  async updateAddress(id: string, input: Partial<AddressInput>): Promise<Address> {
    const customerId = this.requireCustomerId();

    const row = await this.tenantDb.transaction(async (tx) => {
      const existing = await tx.address.findFirst({
        where: { id, customerId, deletedAt: null },
      });
      if (!existing) throw Errors.notFound('Address', id);

      if (input.isDefault) {
        await tx.address.updateMany({
          where: { customerId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      return tx.address.update({
        where: { id },
        data: {
          type: input.type ?? existing.type,
          label: input.label !== undefined ? input.label : existing.label,
          fullName: input.fullName ?? existing.fullName,
          phone: input.phone ? normalisePhone(input.phone) : existing.phone,
          line1: input.line1 ?? existing.line1,
          line2: input.line2 !== undefined ? input.line2 : existing.line2,
          landmark: input.landmark !== undefined ? input.landmark : existing.landmark,
          city: input.city ?? existing.city,
          state: input.state ?? existing.state,
          postalCode: input.postalCode ?? existing.postalCode,
          country: input.country ?? existing.country,
          isDefault: input.isDefault ?? existing.isDefault,
        },
      });
    });

    return toAddress(row);
  }

  /** Soft delete: past orders keep their own snapshot, so nothing breaks. */
  async deleteAddress(id: string): Promise<void> {
    const customerId = this.requireCustomerId();

    await this.tenantDb.transaction(async (tx) => {
      const existing = await tx.address.findFirst({ where: { id, customerId, deletedAt: null } });
      if (!existing) throw Errors.notFound('Address', id);

      await tx.address.update({
        where: { id },
        data: { deletedAt: new Date(), isDefault: false },
      });

      // Promote another address so the customer always has a default.
      if (existing.isDefault) {
        const next = await tx.address.findFirst({
          where: { customerId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  // ============================================================ wishlist ==

  async listWishlist(): Promise<WishlistItem[]> {
    const customerId = this.requireCustomerId();
    const rows = await this.tenantDb.run((db) =>
      db.wishlistItem.findMany({
        where: { customerId, product: { deletedAt: null, status: 'PUBLISHED' } },
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            include: {
              category: { select: { id: true, name: true, slug: true } },
              brand: { select: { id: true, name: true, slug: true } },
              images: { where: { isPrimary: true }, take: 1 },
              variants: {
                where: { deletedAt: null, isActive: true },
                select: { inventory: { select: { quantity: true, reserved: true } } },
              },
            },
          },
        },
      }),
    );

    return rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      product: mapProductListItem(row.product as never),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async addToWishlist(productId: string): Promise<WishlistItem> {
    const customerId = this.requireCustomerId();

    const product = await this.tenantDb.run((db) =>
      db.product.findFirst({
        where: { id: productId, deletedAt: null, status: 'PUBLISHED' },
        select: { id: true },
      }),
    );
    if (!product) throw Errors.notFound('Product', productId);

    // Idempotent: hearting twice is not an error.
    await this.tenantDb.run((db) =>
      db.wishlistItem.upsert({
        where: { customerId_productId: { customerId, productId } },
        create: { customerId, productId },
        update: {},
      }),
    );

    const items = await this.listWishlist();
    return items.find((i) => i.productId === productId)!;
  }

  async removeFromWishlist(productId: string): Promise<void> {
    const customerId = this.requireCustomerId();
    await this.tenantDb.run((db) =>
      db.wishlistItem.deleteMany({ where: { customerId, productId } }),
    );
  }

  private requireCustomerId(): string {
    const auth = this.context.auth;
    if (!auth || auth.audience !== 'customer') throw Errors.unauthenticated();
    return auth.userId;
  }
}

function toProfile(row: {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: Date;
}): CustomerProfile {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
    avatarUrl: row.avatarUrl,
    emailVerified: row.emailVerified,
    phoneVerified: row.phoneVerified,
    createdAt: row.createdAt.toISOString(),
  };
}

function toCustomer(row: {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  isActive: boolean;
  notes: string | null;
  orderCount: number;
  totalSpent: bigint;
  lastOrderAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Customer {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
    avatarUrl: row.avatarUrl,
    emailVerified: row.emailVerified,
    phoneVerified: row.phoneVerified,
    isActive: row.isActive,
    notes: row.notes,
    orderCount: row.orderCount,
    totalSpent: bigIntToNumber(row.totalSpent),
    lastOrderAt: row.lastOrderAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAddress(row: {
  id: string;
  customerId: string;
  type: string;
  label: string | null;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Address {
  return {
    id: row.id,
    customerId: row.customerId,
    type: row.type as Address['type'],
    label: row.label,
    fullName: row.fullName,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    landmark: row.landmark,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
