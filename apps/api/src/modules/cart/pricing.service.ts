import { Injectable } from '@nestjs/common';
import type { AppliedCoupon, CartTotals, DiscountType, Money } from '@retailos/types';
import { Errors } from '@/common/errors/app.exception';

export interface PricingLine {
  variantId: string;
  productId: string;
  quantity: number;
  /** Selling price per unit, minor units. */
  unitPrice: Money;
  mrp: Money;
  /** Product override; null falls back to the store default. */
  taxRateBps: number | null;
}

export interface PricingStoreConfig {
  currency: string;
  defaultTaxRateBps: number;
  /** When true, `unitPrice` already contains tax and we back it out for display. */
  taxInclusivePricing: boolean;
  shippingFee: Money;
  freeShippingThreshold: Money;
  minOrderAmount: Money;
}

export interface CouponConfig {
  code: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount: Money | null;
  minOrderAmount: Money;
  description?: string | null;
}

export interface PricedLine extends PricingLine {
  lineSubtotal: Money;
  /** This line's share of the order-level discount. */
  discountAmount: Money;
  taxRateBps: number;
  taxAmount: Money;
  lineTotal: Money;
}

export interface PricingResult {
  lines: PricedLine[];
  totals: CartTotals;
  coupon: AppliedCoupon | null;
}

/**
 * The single money calculator.
 *
 * Cart preview, checkout and the stored order all run through here, which is
 * the only way to guarantee that what a customer saw in the cart is exactly what
 * they are charged. A second implementation anywhere in the codebase is a bug
 * waiting to happen.
 *
 * Rules, in the order they apply:
 *   1. subtotal   = Σ unitPrice × quantity
 *   2. discount   = coupon, capped, then distributed across lines proportionally
 *   3. tax        = per-line rate on the post-discount amount
 *   4. shipping   = flat fee, waived above the free-shipping threshold
 *   5. total      = subtotal − discount + tax + shipping
 *
 * Every value is an integer in minor units and every division is rounded
 * immediately, so the per-line amounts always re-sum to the order total — which
 * is what the `orders_total_consistent` CHECK constraint enforces at the database.
 */
@Injectable()
export class PricingService {
  price(
    lines: PricingLine[],
    store: PricingStoreConfig,
    coupon?: CouponConfig | null,
  ): PricingResult {
    const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

    const { discount, appliedCoupon } = this.computeDiscount(subtotal, coupon);

    // Distribute the discount across lines in proportion to their value. The
    // last line absorbs the rounding remainder so the parts always sum exactly.
    const priced: PricedLine[] = [];
    let distributed = 0;

    lines.forEach((line, index) => {
      const lineSubtotal = line.unitPrice * line.quantity;
      const isLast = index === lines.length - 1;

      const lineDiscount = isLast
        ? discount - distributed
        : subtotal > 0
          ? Math.round((lineSubtotal / subtotal) * discount)
          : 0;
      distributed += lineDiscount;

      const taxRateBps = line.taxRateBps ?? store.defaultTaxRateBps;
      const taxableBase = Math.max(0, lineSubtotal - lineDiscount);

      const taxAmount = store.taxInclusivePricing
        ? // Price already includes tax: back out the tax component.
          Math.round(taxableBase - taxableBase / (1 + taxRateBps / 10_000))
        : Math.round((taxableBase * taxRateBps) / 10_000);

      priced.push({
        ...line,
        lineSubtotal,
        discountAmount: lineDiscount,
        taxRateBps,
        taxAmount,
        // With inclusive pricing the tax is already inside the subtotal, so it
        // must not be added again.
        lineTotal: store.taxInclusivePricing ? taxableBase : taxableBase + taxAmount,
      });
    });

    const tax = priced.reduce((sum, l) => sum + l.taxAmount, 0);
    const netAfterDiscount = subtotal - discount;

    const shipping =
      netAfterDiscount <= 0
        ? 0
        : store.freeShippingThreshold > 0 && netAfterDiscount >= store.freeShippingThreshold
          ? 0
          : store.shippingFee;

    const total = store.taxInclusivePricing
      ? netAfterDiscount + shipping
      : netAfterDiscount + tax + shipping;

    return {
      lines: priced,
      coupon: appliedCoupon,
      totals: {
        subtotal,
        discount,
        tax,
        shipping,
        total: Math.max(0, total),
        itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
        currency: store.currency,
      },
    };
  }

  /** Validates a coupon against the cart and returns the capped discount. */
  private computeDiscount(
    subtotal: Money,
    coupon?: CouponConfig | null,
  ): { discount: Money; appliedCoupon: AppliedCoupon | null } {
    if (!coupon) return { discount: 0, appliedCoupon: null };

    if (subtotal < coupon.minOrderAmount) {
      throw Errors.couponInvalid(
        `This coupon needs a minimum order of ${formatPaise(coupon.minOrderAmount)}`,
      );
    }

    let discount =
      coupon.discountType === 'PERCENTAGE'
        ? Math.round((subtotal * coupon.discountValue) / 100)
        : coupon.discountValue;

    if (coupon.maxDiscountAmount !== null && coupon.maxDiscountAmount > 0) {
      discount = Math.min(discount, coupon.maxDiscountAmount);
    }

    // A discount can never exceed the goods value — no negative orders.
    discount = Math.min(discount, subtotal);

    return {
      discount,
      appliedCoupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountAmount: discount,
        description: coupon.description ?? null,
      },
    };
  }

  /** Rejects an order below the store's configured floor. */
  assertMeetsMinimum(totals: CartTotals, store: PricingStoreConfig): void {
    if (store.minOrderAmount > 0 && totals.subtotal < store.minOrderAmount) {
      throw Errors.badRequest(
        `The minimum order value for this store is ${formatPaise(store.minOrderAmount)}`,
      );
    }
  }
}

function formatPaise(amount: Money): string {
  return `₹${(amount / 100).toFixed(2)}`;
}
