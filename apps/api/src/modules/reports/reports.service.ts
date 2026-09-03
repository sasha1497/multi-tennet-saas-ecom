import { Injectable } from '@nestjs/common';
import { ORDER_STATUS_LABELS } from '@retailos/config';
import type {
  CustomerReport,
  DashboardSummary,
  InventoryReport,
  MetricDelta,
  Money,
  OrderStatus,
  SalesChartPoint,
  SalesReport,
} from '@retailos/types';
import type { ReportQueryInput } from '@retailos/validation';
import { bigIntToNumber } from '@/common/utils/serialization';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { InventoryService } from '@/modules/inventory/inventory.service';
import { mapOrderListItem } from '@/modules/orders/orders.mapper';
import { StoreService } from '@/modules/store/store.service';

/** Statuses that count as real revenue — cancelled and failed orders do not. */
const REVENUE_STATUSES = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

@Injectable()
export class ReportsService {
  constructor(
    private readonly tenantDb: TenantDatabaseService,
    private readonly inventory: InventoryService,
    private readonly store: StoreService,
  ) {}

  /**
   * Everything the merchant dashboard renders, in one call.
   *
   * Deliberately a single endpoint rather than eight: the dashboard is the first
   * screen after login and a waterfall of requests is what makes an admin feel
   * slow. The queries below are aggregates over indexed columns, so this stays
   * well inside a comfortable response budget.
   */
  async dashboard(query: ReportQueryInput): Promise<DashboardSummary> {
    const range = resolveRange(query);
    const previous = previousWindow(range);
    const settings = await this.store.getPricingConfig();

    const [
      current,
      prior,
      customerCount,
      priorCustomerCount,
      pendingOrders,
      salesChart,
      ordersByStatus,
      topProducts,
      recentOrders,
      lowStockItems,
      revenueByCategory,
    ] = await Promise.all([
      this.revenueTotals(range.from, range.to),
      this.revenueTotals(previous.from, previous.to),
      this.countCustomers(range.from, range.to),
      this.countCustomers(previous.from, previous.to),
      this.countPendingOrders(),
      this.salesByDay(range.from, range.to),
      this.ordersByStatus(range.from, range.to),
      this.topProducts(range.from, range.to, 5),
      this.recentOrders(8),
      this.inventory.lowStockItems(8),
      this.revenueByCategory(range.from, range.to, 6),
    ]);

    const avgCurrent = current.orders > 0 ? Math.round(current.revenue / current.orders) : 0;
    const avgPrior = prior.orders > 0 ? Math.round(prior.revenue / prior.orders) : 0;

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
      currency: settings.currency,
      totalRevenue: delta(current.revenue, prior.revenue),
      totalOrders: delta(current.orders, prior.orders),
      totalCustomers: delta(customerCount, priorCustomerCount),
      averageOrderValue: delta(avgCurrent, avgPrior),
      pendingOrders,
      salesChart,
      ordersByStatus,
      topProducts,
      recentOrders,
      lowStockItems,
      revenueByCategory,
    };
  }

  async salesReport(query: ReportQueryInput): Promise<SalesReport> {
    const range = resolveRange(query);
    const settings = await this.store.getPricingConfig();

    const [totals, byDay, byPaymentMethod, byStatus] = await Promise.all([
      this.salesTotals(range.from, range.to),
      this.salesByDay(range.from, range.to),
      this.salesByPaymentMethod(range.from, range.to),
      this.salesByStatus(range.from, range.to),
    ]);

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      currency: settings.currency,
      totals,
      byDay,
      byPaymentMethod,
      byStatus,
    };
  }

  async customerReport(query: ReportQueryInput): Promise<CustomerReport> {
    const range = resolveRange(query);

    const [newCustomers, returning, top] = await Promise.all([
      this.tenantDb.run((db) =>
        db.customer.count({
          where: { createdAt: { gte: range.from, lte: range.to }, deletedAt: null },
        }),
      ),
      this.tenantDb.run((db) =>
        db.customer.count({
          where: {
            orderCount: { gt: 1 },
            lastOrderAt: { gte: range.from, lte: range.to },
            deletedAt: null,
          },
        }),
      ),
      this.tenantDb.run((db) =>
        db.customer.findMany({
          where: { orderCount: { gt: 0 }, deletedAt: null },
          orderBy: { totalSpent: 'desc' },
          take: 10,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            orderCount: true,
            totalSpent: true,
          },
        }),
      ),
    ]);

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      newCustomers,
      returningCustomers: returning,
      topCustomers: top.map((c) => ({
        customerId: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        orderCount: c.orderCount,
        totalSpent: bigIntToNumber(c.totalSpent),
      })),
    };
  }

  async inventoryReport(): Promise<InventoryReport> {
    const [rows] = await Promise.all([
      this.tenantDb.run(
        (db) =>
          db.$queryRaw<
            {
              total: bigint;
              in_stock: bigint;
              low_stock: bigint;
              out_of_stock: bigint;
              stock_value: bigint | null;
            }[]
          >`
          SELECT COUNT(*)                                                     AS total,
                 COUNT(*) FILTER (WHERE i.quantity - i.reserved > i.low_stock_threshold) AS in_stock,
                 COUNT(*) FILTER (WHERE i.quantity - i.reserved > 0
                                    AND i.quantity - i.reserved <= i.low_stock_threshold) AS low_stock,
                 COUNT(*) FILTER (WHERE i.quantity - i.reserved <= 0)         AS out_of_stock,
                 SUM(i.quantity::bigint * v.price::bigint)                    AS stock_value
            FROM inventory i
            JOIN product_variants v ON v.id = i.variant_id
            JOIN products p         ON p.id = v.product_id
           WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL`,
      ),
    ]);

    const stats = rows[0];
    const lowStockItems = await this.inventory.lowStockItems(50);

    return {
      totalVariants: Number(stats?.total ?? 0),
      inStock: Number(stats?.in_stock ?? 0),
      lowStock: Number(stats?.low_stock ?? 0),
      outOfStock: Number(stats?.out_of_stock ?? 0),
      stockValue: Number(stats?.stock_value ?? 0),
      lowStockItems,
    };
  }

  // ============================================================ queries ==

  private async revenueTotals(from: Date, to: Date): Promise<{ revenue: Money; orders: number }> {
    const result = await this.tenantDb.run((db) =>
      db.order.aggregate({
        where: { placedAt: { gte: from, lte: to }, status: { in: REVENUE_STATUSES as never } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
    );
    return { revenue: result._sum.totalAmount ?? 0, orders: result._count._all };
  }

  private async countCustomers(from: Date, to: Date): Promise<number> {
    return this.tenantDb.run((db) =>
      db.customer.count({ where: { createdAt: { gte: from, lte: to }, deletedAt: null } }),
    );
  }

  private async countPendingOrders(): Promise<number> {
    return this.tenantDb.run((db) =>
      db.order.count({ where: { status: { in: ['PENDING', 'CONFIRMED'] } } }),
    );
  }

  /**
   * Daily series with **zero-filled gaps**.
   *
   * `generate_series` on the SQL side means a day with no orders still returns a
   * row, so the chart shows a flat line instead of silently compressing the
   * x-axis — which would misrepresent a quiet week as a busy one.
   */
  private async salesByDay(from: Date, to: Date): Promise<SalesChartPoint[]> {
    const rows = await this.tenantDb.run(
      (db) =>
        db.$queryRaw<{ day: Date; revenue: bigint | null; orders: bigint }[]>`
        SELECT d.day::date                                   AS day,
               COALESCE(SUM(o.total_amount), 0)::bigint      AS revenue,
               COUNT(o.id)::bigint                           AS orders
          FROM generate_series(${from}::date, ${to}::date, '1 day') AS d(day)
          LEFT JOIN orders o
                 ON o.placed_at >= d.day
                AND o.placed_at <  d.day + INTERVAL '1 day'
                AND o.status = ANY(${REVENUE_STATUSES}::"OrderStatus"[])
         GROUP BY d.day
         ORDER BY d.day ASC`,
    );

    return rows.map((r) => ({
      date: new Date(r.day).toISOString().slice(0, 10),
      revenue: Number(r.revenue ?? 0),
      orders: Number(r.orders),
    }));
  }

  private async ordersByStatus(
    from: Date,
    to: Date,
  ): Promise<{ status: OrderStatus; count: number; label: string }[]> {
    const rows = await this.tenantDb.run((db) =>
      db.order.groupBy({
        by: ['status'],
        where: { placedAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
    );

    return rows.map((r) => ({
      status: r.status as OrderStatus,
      count: r._count._all,
      label: ORDER_STATUS_LABELS[r.status as OrderStatus],
    }));
  }

  private async topProducts(from: Date, to: Date, limit: number) {
    const rows = await this.tenantDb.run(
      (db) =>
        db.$queryRaw<
          {
            product_id: string;
            product_name: string;
            image_url: string | null;
            units_sold: bigint;
            revenue: bigint;
          }[]
        >`
        SELECT oi.product_id,
               MAX(oi.product_name)          AS product_name,
               MAX(oi.image_url)             AS image_url,
               SUM(oi.quantity)::bigint      AS units_sold,
               SUM(oi.line_total)::bigint    AS revenue
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
         WHERE o.placed_at BETWEEN ${from} AND ${to}
           AND o.status = ANY(${REVENUE_STATUSES}::"OrderStatus"[])
         GROUP BY oi.product_id
         ORDER BY units_sold DESC
         LIMIT ${limit}`,
    );

    return rows.map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      imageUrl: r.image_url,
      unitsSold: Number(r.units_sold),
      revenue: Number(r.revenue),
    }));
  }

  private async recentOrders(limit: number) {
    const rows = await this.tenantDb.run((db) =>
      db.order.findMany({
        orderBy: { placedAt: 'desc' },
        take: limit,
        include: {
          _count: { select: { items: true } },
          items: { take: 1, select: { imageUrl: true } },
        },
      }),
    );
    return rows.map((r) => mapOrderListItem(r as never));
  }

  private async revenueByCategory(from: Date, to: Date, limit: number) {
    const rows = await this.tenantDb.run(
      (db) =>
        db.$queryRaw<{ category_id: string | null; category_name: string; revenue: bigint }[]>`
        SELECT c.id                        AS category_id,
               COALESCE(c.name, 'Uncategorised') AS category_name,
               SUM(oi.line_total)::bigint  AS revenue
          FROM order_items oi
          JOIN orders o    ON o.id = oi.order_id
          JOIN products p  ON p.id = oi.product_id
          LEFT JOIN categories c ON c.id = p.category_id
         WHERE o.placed_at BETWEEN ${from} AND ${to}
           AND o.status = ANY(${REVENUE_STATUSES}::"OrderStatus"[])
         GROUP BY c.id, c.name
         ORDER BY revenue DESC
         LIMIT ${limit}`,
    );

    return rows.map((r) => ({
      categoryId: r.category_id ?? 'uncategorised',
      categoryName: r.category_name,
      revenue: Number(r.revenue),
    }));
  }

  private async salesTotals(from: Date, to: Date) {
    const [orderAgg, itemAgg] = await Promise.all([
      this.tenantDb.run((db) =>
        db.order.aggregate({
          where: { placedAt: { gte: from, lte: to }, status: { in: REVENUE_STATUSES as never } },
          _sum: {
            totalAmount: true,
            discountAmount: true,
            taxAmount: true,
            shippingAmount: true,
          },
          _count: { _all: true },
        }),
      ),
      this.tenantDb.run((db) =>
        db.orderItem.aggregate({
          where: {
            order: { placedAt: { gte: from, lte: to }, status: { in: REVENUE_STATUSES as never } },
          },
          _sum: { quantity: true },
        }),
      ),
    ]);

    const revenue = orderAgg._sum.totalAmount ?? 0;
    const orders = orderAgg._count._all;

    return {
      revenue,
      orders,
      itemsSold: itemAgg._sum.quantity ?? 0,
      averageOrderValue: orders > 0 ? Math.round(revenue / orders) : 0,
      discountGiven: orderAgg._sum.discountAmount ?? 0,
      taxCollected: orderAgg._sum.taxAmount ?? 0,
      shippingCollected: orderAgg._sum.shippingAmount ?? 0,
    };
  }

  private async salesByPaymentMethod(from: Date, to: Date) {
    const rows = await this.tenantDb.run((db) =>
      db.order.groupBy({
        by: ['paymentMethod'],
        where: { placedAt: { gte: from, lte: to }, status: { in: REVENUE_STATUSES as never } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
    );
    return rows.map((r) => ({
      method: r.paymentMethod,
      orders: r._count._all,
      revenue: r._sum.totalAmount ?? 0,
    }));
  }

  private async salesByStatus(from: Date, to: Date) {
    const rows = await this.tenantDb.run((db) =>
      db.order.groupBy({
        by: ['status'],
        where: { placedAt: { gte: from, lte: to } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
    );
    return rows.map((r) => ({
      status: r.status as OrderStatus,
      orders: r._count._all,
      revenue: r._sum.totalAmount ?? 0,
    }));
  }
}

// ============================================================== helpers ==

interface ResolvedRange {
  from: Date;
  to: Date;
  label: string;
}

function resolveRange(query: ReportQueryInput): ResolvedRange {
  const to = query.dateTo ? new Date(query.dateTo) : new Date();
  const range = query.range ?? '30d';

  if (range === 'custom' && query.dateFrom) {
    return { from: new Date(query.dateFrom), to, label: 'Custom range' };
  }

  const from = new Date(to);
  switch (range) {
    case '7d':
      from.setDate(from.getDate() - 7);
      return { from, to, label: 'Last 7 days' };
    case '90d':
      from.setDate(from.getDate() - 90);
      return { from, to, label: 'Last 90 days' };
    case 'mtd':
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      return { from, to, label: 'This month' };
    case 'ytd':
      from.setMonth(0, 1);
      from.setHours(0, 0, 0, 0);
      return { from, to, label: 'This year' };
    case '30d':
    default:
      from.setDate(from.getDate() - 30);
      return { from, to, label: 'Last 30 days' };
  }
}

/** The immediately preceding window of equal length, for the trend arrows. */
function previousWindow(range: ResolvedRange): { from: Date; to: Date } {
  const span = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - span),
    to: new Date(range.from.getTime() - 1),
  };
}

function delta(value: number, previous: number): MetricDelta {
  const changePercent =
    previous > 0 ? Math.round(((value - previous) / previous) * 1000) / 10 : null;
  return {
    value,
    previous,
    changePercent,
    trend: value > previous ? 'up' : value < previous ? 'down' : 'flat',
  };
}
