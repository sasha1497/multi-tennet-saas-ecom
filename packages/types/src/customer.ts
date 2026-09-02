import { Money, PaginationQuery } from './common';
import { AddressType } from './enums';

export interface Address {
  id: string;
  customerId: string;
  type: AddressType;
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
  createdAt: string;
  updatedAt: string;
}

/**
 * Immutable copy of an address, embedded in an order.
 * Editing the customer's address book must never rewrite shipping history.
 */
export interface AddressSnapshot {
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface Customer {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  isActive: boolean;
  notes: string | null;

  // Merchant-facing aggregates.
  orderCount: number;
  totalSpent: Money;
  lastOrderAt: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface CustomerQuery extends PaginationQuery {
  isActive?: boolean;
  hasOrders?: boolean;
}

export interface UpdateCustomerProfileRequest {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string | null;
}

export interface CreateAddressRequest {
  type?: AddressType;
  label?: string | null;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
  isDefault?: boolean;
}

export interface UpdateAddressRequest extends Partial<CreateAddressRequest> {}

export interface WishlistItem {
  id: string;
  productId: string;
  product: import('./catalog').ProductListItem;
  createdAt: string;
}
