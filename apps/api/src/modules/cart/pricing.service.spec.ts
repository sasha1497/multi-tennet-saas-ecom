import { PricingService, type PricingLine, type PricingStoreConfig } from './pricing.service';
import { AppException } from '@/common/errors/app.exception';

/**
 * Money maths is the least forgiving part of this system: a rounding error here
 * becomes a rupee of missing revenue per order, and the database CHECK
 * constraint will reject the write rather than let it through silently.
 */
describe('PricingService', () => {
  const pricing = new PricingService();

  const exclusiveStore: PricingStoreConfig = {
    currency: 'INR',
    defaultTaxRateBps: 1800, // 18%
    taxInclusivePricing: false,
    shippingFee: 4900,
    freeShippingThreshold: 99900,
    minOrderAmount: 0,
  };

  const inclusiveStore: PricingStoreConfig = { ...exclusiveStore, taxInclusivePricing: true };

  const line = (overrides: Partial<PricingLine> = {}): PricingLine => ({
    variantId: 'v1',
    productId: 'p1',
    quantity: 1,
    unitPrice: 100_00,
    mrp: 150_00,
    taxRateBps: null,
    ...overrides,
  });

  describe('subtotal', () => {
    it('multiplies unit price by quantity across lines', () => {
      const result = pricing.price(
        [line({ unitPrice: 100_00, quantity: 2 }), line({ variantId: 'v2', unitPrice: 250_00 })],
        exclusiveStore,
      );
      expect(result.totals.subtotal).toBe(450_00);
      expect(result.totals.itemCount).toBe(3);
    });

    it('returns zeroed totals for an empty cart', () => {
      const result = pricing.price([], exclusiveStore);
      expect(result.totals.subtotal).toBe(0);
      expect(result.totals.total).toBe(0);
      expect(result.totals.shipping).toBe(0);
    });
  });

  describe('tax', () => {
    // ₹500 keeps the order under the ₹999 free-delivery threshold, so the
    // shipping fee is part of the assertion rather than silently waived.
    it('adds tax on top when pricing is exclusive', () => {
      const result = pricing.price([line({ unitPrice: 500_00 })], exclusiveStore);
      expect(result.totals.tax).toBe(90_00);
      expect(result.totals.total).toBe(500_00 + 90_00 + 49_00);
    });

    it('backs tax out of the price when pricing is inclusive', () => {
      // ₹590 inclusive of 18% == ₹500 net + ₹90 tax.
      const result = pricing.price([line({ unitPrice: 590_00 })], inclusiveStore);
      expect(result.totals.tax).toBe(90_00);
      // The customer pays the shelf price plus delivery — tax is NOT added again.
      expect(result.totals.total).toBe(590_00 + 49_00);
    });

    it('honours a per-product tax rate over the store default', () => {
      const result = pricing.price([line({ unitPrice: 500_00, taxRateBps: 500 })], exclusiveStore);
      expect(result.totals.tax).toBe(25_00);
    });

    it('charges no tax at a zero rate', () => {
      const result = pricing.price([line({ unitPrice: 500_00, taxRateBps: 0 })], exclusiveStore);
      expect(result.totals.tax).toBe(0);
    });
  });

  describe('shipping', () => {
    it('charges the flat fee below the free-shipping threshold', () => {
      const result = pricing.price([line({ unitPrice: 500_00 })], exclusiveStore);
      expect(result.totals.shipping).toBe(4900);
    });

    it('waives the fee at or above the threshold', () => {
      const result = pricing.price([line({ unitPrice: 999_00 })], exclusiveStore);
      expect(result.totals.shipping).toBe(0);
    });

    it('measures the threshold against the post-discount value', () => {
      // 1000 - 200 coupon = 800, which is below the 999 threshold.
      const result = pricing.price([line({ unitPrice: 1000_00 })], exclusiveStore, {
        code: 'FLAT200',
        discountType: 'FIXED',
        discountValue: 200_00,
        maxDiscountAmount: null,
        minOrderAmount: 0,
      });
      expect(result.totals.shipping).toBe(4900);
    });
  });

  describe('discounts', () => {
    it('applies a percentage discount', () => {
      const result = pricing.price([line({ unitPrice: 1000_00 })], exclusiveStore, {
        code: 'SAVE10',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        maxDiscountAmount: null,
        minOrderAmount: 0,
      });
      expect(result.totals.discount).toBe(100_00);
      expect(result.coupon?.code).toBe('SAVE10');
    });

    it('caps a percentage discount at maxDiscountAmount', () => {
      const result = pricing.price([line({ unitPrice: 10_000_00 })], exclusiveStore, {
        code: 'SAVE10',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        maxDiscountAmount: 500_00,
        minOrderAmount: 0,
      });
      // 10% of 10,000 would be 1,000 — capped at 500.
      expect(result.totals.discount).toBe(500_00);
    });

    it('never discounts more than the goods are worth', () => {
      const result = pricing.price([line({ unitPrice: 100_00 })], exclusiveStore, {
        code: 'HUGE',
        discountType: 'FIXED',
        discountValue: 500_00,
        maxDiscountAmount: null,
        minOrderAmount: 0,
      });
      expect(result.totals.discount).toBe(100_00);
      expect(result.totals.total).toBeGreaterThanOrEqual(0);
    });

    it('rejects a coupon below its minimum order value', () => {
      expect(() =>
        pricing.price([line({ unitPrice: 100_00 })], exclusiveStore, {
          code: 'BIGSPEND',
          discountType: 'FIXED',
          discountValue: 50_00,
          maxDiscountAmount: null,
          minOrderAmount: 1000_00,
        }),
      ).toThrow(AppException);
    });

    /**
     * The important one: line discounts are distributed proportionally and must
     * re-sum to the order discount exactly, or `orders_total_consistent` fails.
     */
    it('distributes a discount across lines with no rounding drift', () => {
      const result = pricing.price(
        [
          line({ variantId: 'a', unitPrice: 333_33 }),
          line({ variantId: 'b', unitPrice: 333_33 }),
          line({ variantId: 'c', unitPrice: 333_34 }),
        ],
        exclusiveStore,
        {
          code: 'ODD',
          discountType: 'PERCENTAGE',
          discountValue: 33,
          maxDiscountAmount: null,
          minOrderAmount: 0,
        },
      );

      const distributed = result.lines.reduce((sum, l) => sum + l.discountAmount, 0);
      expect(distributed).toBe(result.totals.discount);
    });

    it('keeps every amount an integer number of paise', () => {
      const result = pricing.price(
        [line({ unitPrice: 799_99, quantity: 3 })],
        exclusiveStore,
        {
          code: 'SEVEN',
          discountType: 'PERCENTAGE',
          discountValue: 7,
          maxDiscountAmount: null,
          minOrderAmount: 0,
        },
      );

      for (const value of Object.values(result.totals)) {
        if (typeof value === 'number') expect(Number.isInteger(value)).toBe(true);
      }
      for (const l of result.lines) {
        expect(Number.isInteger(l.taxAmount)).toBe(true);
        expect(Number.isInteger(l.discountAmount)).toBe(true);
        expect(Number.isInteger(l.lineTotal)).toBe(true);
      }
    });
  });

  describe('total consistency', () => {
    /**
     * Mirrors the database CHECK constraint exactly. If this test and the
     * constraint ever disagree, orders start failing at write time — so the
     * invariant is asserted here in the same form.
     */
    const assertConsistent = (
      totals: { subtotal: number; discount: number; tax: number; shipping: number; total: number },
      taxInclusive: boolean,
    ) => {
      const expected =
        totals.subtotal - totals.discount + totals.shipping + (taxInclusive ? 0 : totals.tax);
      expect(totals.total).toBe(expected);
    };

    it('holds for exclusive pricing', () => {
      const result = pricing.price(
        [line({ unitPrice: 1234_56, quantity: 2 }), line({ variantId: 'b', unitPrice: 99_00 })],
        exclusiveStore,
        {
          code: 'X',
          discountType: 'PERCENTAGE',
          discountValue: 13,
          maxDiscountAmount: null,
          minOrderAmount: 0,
        },
      );
      assertConsistent(result.totals, false);
    });

    it('holds for inclusive pricing', () => {
      const result = pricing.price(
        [line({ unitPrice: 1234_56, quantity: 2 }), line({ variantId: 'b', unitPrice: 99_00 })],
        inclusiveStore,
        {
          code: 'X',
          discountType: 'PERCENTAGE',
          discountValue: 13,
          maxDiscountAmount: null,
          minOrderAmount: 0,
        },
      );
      assertConsistent(result.totals, true);
    });
  });

  describe('minimum order value', () => {
    it('rejects an order below the store minimum', () => {
      const store = { ...exclusiveStore, minOrderAmount: 500_00 };
      const result = pricing.price([line({ unitPrice: 100_00 })], store);
      expect(() => pricing.assertMeetsMinimum(result.totals, store)).toThrow(AppException);
    });

    it('accepts an order at exactly the minimum', () => {
      const store = { ...exclusiveStore, minOrderAmount: 500_00 };
      const result = pricing.price([line({ unitPrice: 500_00 })], store);
      expect(() => pricing.assertMeetsMinimum(result.totals, store)).not.toThrow();
    });
  });
});
