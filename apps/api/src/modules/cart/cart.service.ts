import { Injectable } from '@nestjs/common';
import { GUEST_CART_TTL_DAYS } from '@retailos/config';
import type { Cart, CartIssue, CartItem } from '@retailos/types';
import { Errors } from '@/common/errors/app.exception';
import { RequestContextService } from '@/core/context/request-context';
import {
  TenantDatabaseService,
  type TenantTransactionClient,
} from '@/core/database/tenant-database.service';
import { AppLogger } from '@/core/logger/logger.service';
import { TokenHasher } from '@/core/security/credential-cipher.service';
import { CouponsService } from '@/modules/coupons/coupons.service';
import { StoreService } from '@/modules/store/store.service';
import { PricingService, type PricingLine } from './pricing.service';

/** Everything needed to price and validate a cart, in one query. */
const CART_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' },
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
} as const;

/**
 * Shopping cart.
 *
 * Two invariants are non-negotiable:
 *
 *  1. **A cart belongs to exactly one tenant.** That is structural here — the
 *     cart lives in the tenant's own database, so a cart physically cannot hold
 *     another store's products. Requirement §25 asks for this guarantee; the
 *     database-per-tenant design gives it for free.
 *
 *  2. **The server owns prices.** The client never sends an amount. Prices are
 *     re-read from the catalog on every cart read and re-validated again at
 *     checkout, so a tampered request cannot buy a ₹5,000 shoe for ₹5.
 *
 * Anonymous shoppers get an HMAC-signed guest token; on login their cart is
 * merged into the customer's.
 */
@Injectable()
export class CartService {
  private readonly logger: AppLogger;

  constructor(
    private readonly tenantDb: TenantDatabaseService,
    private readonly context: RequestContextService,
    private readonly pricing: PricingService,
    private readonly store: StoreService,
    private readonly coupons: CouponsService,
    private readonly hasher: TokenHasher,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('CartService');
  }

  /** Current cart, priced and validated. Creates one lazily if none exists. */
  async get(): Promise<Cart> {
    const cart = await this.resolveCart({ create: false });
    if (!cart) return this.emptyCart();
    return this.build(cart);
  }

  async addItem(variantId: string, quantity: number): Promise<Cart> {
    const cart = await this.resolveCart({ create: true });

    await this.tenantDb.transaction(async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: { id: variantId, deletedAt: null, isActive: true },
        include: {
          inventory: true,
          product: { select: { status: true, deletedAt: true, name: true } },
        },
      });

      if (!variant || variant.product.deletedAt || variant.product.status !== 'PUBLISHED') {
        throw Errors.notFound('Product');
      }

      const existing = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: cart!.id, variantId } },
      });
      const desired = (existing?.quantity ?? 0) + quantity;

      const available = Math.max(
        0,
        (variant.inventory?.quantity ?? 0) - (variant.inventory?.reserved ?? 0),
      );
      const settings = await this.store.getPricingConfig();

      if (!settings.allowBackorder && desired > available) {
        throw Errors.insufficientStock(variant.sku, desired, available);
      }

      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: desired, addedAtPrice: variant.price },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: cart!.id,
            variantId,
            quantity,
            addedAtPrice: variant.price,
          },
        });
      }

      await this.touch(tx, cart!.id);
    });

    return this.get();
  }

  /** Quantity 0 removes the line — the usual behaviour of a quantity stepper. */
  async updateItem(itemId: string, quantity: number): Promise<Cart> {
    const cart = await this.resolveCart({ create: false });
    if (!cart) throw Errors.notFound('Cart');

    await this.tenantDb.transaction(async (tx) => {
      const item = await tx.cartItem.findFirst({
        where: { id: itemId, cartId: cart.id },
        include: { variant: { include: { inventory: true } } },
      });
      if (!item) throw Errors.notFound('Cart item', itemId);

      if (quantity <= 0) {
        await tx.cartItem.delete({ where: { id: itemId } });
      } else {
        const available = Math.max(
          0,
          (item.variant.inventory?.quantity ?? 0) - (item.variant.inventory?.reserved ?? 0),
        );
        const settings = await this.store.getPricingConfig();
        if (!settings.allowBackorder && quantity > available) {
          throw Errors.insufficientStock(item.variant.sku, quantity, available);
        }
        await tx.cartItem.update({ where: { id: itemId }, data: { quantity } });
      }

      await this.touch(tx, cart.id);
    });

    return this.get();
  }

  async removeItem(itemId: string): Promise<Cart> {
    const cart = await this.resolveCart({ create: false });
    if (!cart) throw Errors.notFound('Cart');

    await this.tenantDb.run((db) =>
      db.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } }),
    );
    return this.get();
  }

  async clear(): Promise<Cart> {
    const cart = await this.resolveCart({ create: false });
    if (!cart) return this.emptyCart();

    await this.tenantDb.transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
    });
    return this.get();
  }

  async applyCoupon(code: string): Promise<Cart> {
    const cart = await this.resolveCart({ create: false });
    if (!cart || cart.items.length === 0) throw Errors.cartEmpty();

    // Validate before storing, so an invalid code is rejected with a clear
    // message rather than silently sticking to the cart.
    const priced = await this.build(cart);
    const coupon = await this.coupons.validate(code, {
      subtotal: priced.totals.subtotal,
      customerId: this.customerId,
    });

    await this.tenantDb.run((db) =>
      db.cart.update({ where: { id: cart.id }, data: { couponCode: coupon.code } }),
    );

    return this.get();
  }

  async removeCoupon(): Promise<Cart> {
    const cart = await this.resolveCart({ create: false });
    if (!cart) return this.emptyCart();
    await this.tenantDb.run((db) =>
      db.cart.update({ where: { id: cart.id }, data: { couponCode: null } }),
    );
    return this.get();
  }

  /**
   * Folds an anonymous cart into the signed-in customer's cart.
   *
   * Called right after login. Quantities are summed rather than replaced, which
   * matches what shoppers expect when they add items and then sign in.
   */
  async mergeGuestCart(): Promise<Cart> {
    const customerId = this.customerId;
    const guestToken = this.context.guestToken;
    if (!customerId || !guestToken) return this.get();

    await this.tenantDb.transaction(async (tx) => {
      const guestCart = await tx.cart.findUnique({
        where: { guestToken },
        include: { items: true },
      });
      if (!guestCart || guestCart.items.length === 0) return;

      const customerCart =
        (await tx.cart.findFirst({ where: { customerId } })) ??
        (await tx.cart.create({
          data: { customerId, expiresAt: this.expiry() },
        }));

      for (const item of guestCart.items) {
        const existing = await tx.cartItem.findUnique({
          where: { cartId_variantId: { cartId: customerCart.id, variantId: item.variantId } },
        });
        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + item.quantity },
          });
        } else {
          await tx.cartItem.create({
            data: {
              cartId: customerCart.id,
              variantId: item.variantId,
              quantity: item.quantity,
              addedAtPrice: item.addedAtPrice,
            },
          });
        }
      }

      if (guestCart.couponCode && !customerCart.couponCode) {
        await tx.cart.update({
          where: { id: customerCart.id },
          data: { couponCode: guestCart.couponCode },
        });
      }

      await tx.cart.delete({ where: { id: guestCart.id } });
      this.logger.debug('Merged guest cart', { customerId, items: guestCart.items.length });
    });

    return this.get();
  }

  /** Issues a signed guest token for a shopper who does not have one yet. */
  issueGuestToken(): string {
    return this.hasher.signGuestToken();
  }

  // ============================================================ internals ==

  private get customerId(): string | null {
    const auth = this.context.auth;
    return auth?.audience === 'customer' ? auth.userId : null;
  }

  /**
   * Finds the caller's cart: by customer id when signed in, otherwise by the
   * signed guest token. Never by a raw id from the client — that would let
   * anyone read anyone else's cart.
   */
  private async resolveCart(opts: { create: boolean }) {
    const customerId = this.customerId;
    const guestToken = this.context.guestToken;

    const existing = await this.tenantDb.run((db) =>
      customerId
        ? db.cart.findFirst({ where: { customerId }, include: CART_INCLUDE })
        : guestToken
          ? db.cart.findUnique({ where: { guestToken }, include: CART_INCLUDE })
          : Promise.resolve(null),
    );

    if (existing) return existing;
    if (!opts.create) return null;

    if (!customerId && !guestToken) {
      // The controller issues and returns a token via the X-Guest-Token header
      // before any write reaches here.
      throw Errors.badRequest('A guest session is required to start a cart');
    }

    return this.tenantDb.run((db) =>
      db.cart.create({
        data: {
          customerId,
          guestToken: customerId ? null : guestToken,
          expiresAt: this.expiry(),
        },
        include: CART_INCLUDE,
      }),
    );
  }

  /** Prices the cart and reports anything that would block checkout. */
  private async build(cart: CartRow): Promise<Cart> {
    const settings = await this.store.getPricingConfig();

    const issues: CartIssue[] = [];
    const lines: PricingLine[] = [];
    const items: CartItem[] = [];

    for (const item of cart.items) {
      const { variant } = item;
      const product = variant.product;

      const unavailable =
        product.deletedAt !== null || product.status !== 'PUBLISHED' || !variant.isActive;

      const available = Math.max(
        0,
        (variant.inventory?.quantity ?? 0) - (variant.inventory?.reserved ?? 0),
      );
      const priceChanged = item.addedAtPrice !== variant.price;

      if (unavailable) {
        issues.push({
          code: 'PRODUCT_UNAVAILABLE',
          itemId: item.id,
          message: `${product.name} is no longer available`,
        });
      } else if (available === 0 && !settings.allowBackorder) {
        issues.push({
          code: 'OUT_OF_STOCK',
          itemId: item.id,
          message: `${product.name} is out of stock`,
          availableStock: 0,
        });
      } else if (item.quantity > available && !settings.allowBackorder) {
        issues.push({
          code: 'INSUFFICIENT_STOCK',
          itemId: item.id,
          message: `Only ${available} left of ${product.name}`,
          availableStock: available,
        });
      }

      if (priceChanged) {
        issues.push({
          code: 'PRICE_CHANGED',
          itemId: item.id,
          message: `The price of ${product.name} has changed`,
          newPrice: variant.price,
        });
      }

      items.push({
        id: item.id,
        productId: product.id,
        variantId: variant.id,
        productName: product.name,
        productSlug: product.slug,
        variantLabel: variant.label,
        sku: variant.sku,
        imageUrl: variant.imageUrl ?? product.images[0]?.url ?? null,
        unitPrice: variant.price,
        mrp: variant.mrp,
        quantity: item.quantity,
        lineTotal: variant.price * item.quantity,
        availableStock: available,
        inStock: available > 0,
        priceChanged,
        addedAtPrice: item.addedAtPrice,
        createdAt: item.createdAt.toISOString(),
      });

      // Unavailable lines are excluded from pricing so the displayed total
      // matches what the customer can actually buy.
      if (!unavailable) {
        lines.push({
          variantId: variant.id,
          productId: product.id,
          quantity: item.quantity,
          unitPrice: variant.price,
          mrp: variant.mrp,
          taxRateBps: product.taxRateBps,
        });
      }
    }

    // A coupon that has since expired or hit its cap should not break the cart —
    // it is dropped with the rest of the cart still usable.
    let coupon = null;
    if (cart.couponCode && lines.length > 0) {
      const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
      coupon = await this.coupons
        .validate(cart.couponCode, { subtotal, customerId: this.customerId })
        .catch(() => null);
    }

    const priced = this.pricing.price(lines, settings, coupon);

    return {
      id: cart.id,
      customerId: cart.customerId,
      guestToken: cart.guestToken,
      items,
      totals: priced.totals,
      coupon: priced.coupon,
      issues,
      updatedAt: cart.updatedAt.toISOString(),
    };
  }

  private emptyCart(): Cart {
    return {
      id: '',
      customerId: this.customerId,
      guestToken: this.context.guestToken,
      items: [],
      totals: {
        subtotal: 0,
        discount: 0,
        tax: 0,
        shipping: 0,
        total: 0,
        itemCount: 0,
        currency: 'INR',
      },
      coupon: null,
      issues: [],
      updatedAt: new Date().toISOString(),
    };
  }

  private expiry(): Date {
    return new Date(Date.now() + GUEST_CART_TTL_DAYS * 86_400_000);
  }

  private async touch(tx: TenantTransactionClient, cartId: string): Promise<void> {
    await tx.cart.update({ where: { id: cartId }, data: { expiresAt: this.expiry() } });
  }
}

type CartRow = {
  id: string;
  customerId: string | null;
  guestToken: string | null;
  couponCode: string | null;
  updatedAt: Date;
  items: {
    id: string;
    quantity: number;
    addedAtPrice: number;
    createdAt: Date;
    variant: {
      id: string;
      sku: string;
      label: string;
      price: number;
      mrp: number;
      imageUrl: string | null;
      isActive: boolean;
      inventory: { quantity: number; reserved: number } | null;
      product: {
        id: string;
        name: string;
        slug: string;
        status: string;
        deletedAt: Date | null;
        taxRateBps: number | null;
        images: { url: string }[];
      };
    };
  }[];
};
