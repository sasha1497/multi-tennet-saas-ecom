/**
 * Display helpers shared by every client so ₹ formatting, discount maths and
 * status labels never drift between web and mobile.
 */
import type { Money, OrderStatus } from '@retailos/types';

/** Converts minor units (paise) to a display string: 149900 -> "₹1,499.00". */
export function formatMoney(
  amount: Money,
  currency = 'INR',
  opts: { symbol?: string; compact?: boolean; hideDecimals?: boolean } = {},
): string {
  const major = amount / 100;
  const symbol = opts.symbol ?? currencySymbol(currency);

  if (opts.compact && Math.abs(major) >= 1000) {
    // Indian numbering: thousands -> K, lakhs -> L, crores -> Cr.
    if (Math.abs(major) >= 10_000_000) return `${symbol}${trim(major / 10_000_000)}Cr`;
    if (Math.abs(major) >= 100_000) return `${symbol}${trim(major / 100_000)}L`;
    return `${symbol}${trim(major / 1000)}K`;
  }

  const fractionDigits = opts.hideDecimals || Number.isInteger(major) ? 0 : 2;
  try {
    const formatted = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(major);
    return `${symbol}${formatted}`;
  } catch {
    return `${symbol}${major.toFixed(fractionDigits)}`;
  }
}

function trim(n: number): string {
  return n.toFixed(n < 10 ? 1 : 0).replace(/\.0$/, '');
}

export function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case 'INR':
      return '₹';
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    default:
      return `${currency} `;
  }
}

/** Rupees (possibly fractional) -> paise, rounded to the nearest integer. */
export function toMinorUnits(major: number): Money {
  return Math.round(major * 100);
}

export function toMajorUnits(minor: Money): number {
  return minor / 100;
}

export function discountPercent(price: Money, mrp: Money): number {
  if (!mrp || mrp <= price) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

/** Semantic tone per status, consumed by the Badge component in both web apps. */
export const ORDER_STATUS_TONES: Record<OrderStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  PENDING: 'warning',
  CONFIRMED: 'info',
  PROCESSING: 'info',
  SHIPPED: 'info',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  CANCELLED: 'danger',
  REFUNDED: 'neutral',
};

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  if (!withTime) return date;
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}
