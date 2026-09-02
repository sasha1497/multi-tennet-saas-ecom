import { Money } from './common';
import { OrderStatus } from './enums';

export type ReportRange = '7d' | '30d' | '90d' | 'mtd' | 'ytd' | 'custom';

export interface ReportQuery {
  range?: ReportRange;
  dateFrom?: string;
  dateTo?: string;
}

export interface MetricDelta {
  value: Money | number;
  /** Same metric over the immediately preceding window. */
  previous: Money | number;
  /** Percent change vs `previous`; null when previous is 0. */
  changePercent: number | null;
  trend: 'up' | 'down' | 'flat';
}

/** Everything the merchant dashboard's top row + charts need, in one call. */
export interface DashboardSummary {
  range: { from: string; to: string; label: string };
  currency: string;

  totalRevenue: MetricDelta;
  totalOrders: MetricDelta;
  totalCustomers: MetricDelta;
  averageOrderValue: MetricDelta;
  pendingOrders: number;

  salesChart: SalesChartPoint[];
  ordersByStatus: { status: OrderStatus; count: number; label: string }[];
  topProducts: TopProduct[];
  recentOrders: import('./order').OrderListItem[];
  lowStockItems: LowStockItem[];
  revenueByCategory: { categoryId: string; categoryName: string; revenue: Money }[];
}

export interface SalesChartPoint {
  date: string;
  revenue: Money;
  orders: number;
}

export interface TopProduct {
  productId: string;
  productName: string;
  imageUrl: string | null;
  unitsSold: number;
  revenue: Money;
}

export interface LowStockItem {
  variantId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  imageUrl: string | null;
  available: number;
  lowStockThreshold: number;
}

export interface SalesReport {
  range: { from: string; to: string };
  currency: string;
  totals: {
    revenue: Money;
    orders: number;
    itemsSold: number;
    averageOrderValue: Money;
    discountGiven: Money;
    taxCollected: Money;
    shippingCollected: Money;
  };
  byDay: SalesChartPoint[];
  byPaymentMethod: { method: string; orders: number; revenue: Money }[];
  byStatus: { status: OrderStatus; orders: number; revenue: Money }[];
}

export interface CustomerReport {
  range: { from: string; to: string };
  newCustomers: number;
  returningCustomers: number;
  topCustomers: {
    customerId: string;
    name: string;
    orderCount: number;
    totalSpent: Money;
  }[];
}

export interface InventoryReport {
  totalVariants: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
  /** Sum of quantity × price across all variants. */
  stockValue: Money;
  lowStockItems: LowStockItem[];
}
