import { Money } from './common';
import { DiscountType } from './enums';

export interface CartItem {
  id: string;
  productId: string;
  variantId: string;
  productName: string;
  productSlug: string;
  variantLabel: string;
  sku: string;
  imageUrl: string | null;
  /** Live price at read time — the checkout re-validates it server-side. */
  unitPrice: Money;
  mrp: Money;
  quantity: number;
  lineTotal: Money;

  /** Availability signals so the cart can warn before checkout fails. */
  availableStock: number;
  inStock: boolean;
  /** True when the price moved since the item was added. */
  priceChanged: boolean;
  addedAtPrice: Money;
  createdAt: string;
}

export interface CartTotals {
  subtotal: Money;
  discount: Money;
  tax: Money;
  shipping: Money;
  total: Money;
  itemCount: number;
  currency: string;
}

export interface AppliedCoupon {
  code: string;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: Money;
  description: string | null;
}

export interface Cart {
  id: string;
  customerId: string | null;
  /** Anonymous carts are keyed by a signed guest token stored client-side. */
  guestToken: string | null;
  items: CartItem[];
  totals: CartTotals;
  coupon: AppliedCoupon | null;
  /** Blocking problems the customer must resolve before checkout. */
  issues: CartIssue[];
  updatedAt: string;
}

export interface CartIssue {
  code: 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | 'PRICE_CHANGED' | 'PRODUCT_UNAVAILABLE';
  itemId: string;
  message: string;
  availableStock?: number;
  newPrice?: Money;
}

export interface AddCartItemRequest {
  variantId: string;
  quantity: number;
}

export interface UpdateCartItemRequest {
  quantity: number;
}

export interface ApplyCouponRequest {
  code: string;
}

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discountType: DiscountType;
  /** Percent (0-100) or minor units, depending on `discountType`. */
  discountValue: number;
  /** Minor units; caps a percentage discount. */
  maxDiscountAmount: Money | null;
  minOrderAmount: Money;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface CreateCouponRequest {
  code: string;
  description?: string | null;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount?: Money | null;
  minOrderAmount?: Money;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
}
