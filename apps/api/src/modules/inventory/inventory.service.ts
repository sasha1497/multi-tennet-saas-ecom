import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  type InventoryRecord,
  type InventoryTransaction,
  type PaginatedResult,
} from '@retailos/types';
import type { AdjustInventoryInput } from '@retailos/validation';
import { Errors } from '@/common/errors/app.exception';
import { escapeLike, normaliseSearch, paginate, toPrismaPage } from '@/common/utils/pagination';
import { RequestContextService } from '@/core/context/request-context';
import {
  TenantDatabaseService,
  type TenantTransactionClient,
} from '@/core/database/tenant-database.service';
import { AppLogger } from '@/core/logger/logger.service';
import { QueueService } from '@/core/queue/queue.service';
import { AuditService } from '@/modules/audit/audit.service';

/**
 * Stock, reservations and the movement ledger.
 *
 * The concurrency story is the whole point of this file. Two shoppers buying
 * the last pair of shoes at the same instant must not both succeed, and the
 * naive `read → check → write` pattern cannot prevent that no matter how the
 * application code is arranged.
 *
 * So every stock movement is a **single conditional UPDATE** whose WHERE clause
 * carries the invariant:
 *
 *     UPDATE inventory SET reserved = reserved + $n
 *      WHERE variant_id = $id AND quantity - reserved >= $n
 *
 * PostgreSQL takes a row lock for the duration; the loser's UPDATE matches zero
 * rows and we turn that into a clean `INSUFFICIENT_STOCK`. The CHECK constraints
 * from migration 0002 are the backstop if anyone ever writes a plain UPDATE.
 *
 * Lifecycle of a unit of stock:
 *   reserve  — order placed, stock held but not yet sold
 *   commit   — payment captured (or COD confirmed): held stock becomes sold
 *   release  — order cancelled or payment failed: held stock returns
 *   restock  — refund/return: sold stock comes back
 */
@Injectable()
export class InventoryService {
  private readonly logger: AppLogger;

  constructor(
    private readonly tenantDb: TenantDatabaseService,
    private readonly context: RequestContextService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('InventoryService');
  }

  // ================================================ atomic stock movements ==

  /**
   * Holds `quantity` units for an order. Throws INSUFFICIENT_STOCK if the
   * available count would go negative.
   *
   * Must be called inside the order transaction so a later failure rolls the
   * reservation back with it.
   */
  async reserve(
    tx: TenantTransactionClient,
    variantId: string,
    quantity: number,
    reference: { type: string; id: string },
    options: { allowBackorder?: boolean } = {},
  ): Promise<void> {
    if (quantity <= 0) throw Errors.badRequest('Quantity must be greater than zero');

    const updated = options.allowBackorder
      ? await tx.$executeRaw`
          UPDATE inventory
             SET reserved = reserved + ${quantity},
                 version = version + 1,
                 updated_at = NOW()
           WHERE variant_id = ${variantId}::uuid`
      : await tx.$executeRaw`
          UPDATE inventory
             SET reserved = reserved + ${quantity},
                 version = version + 1,
                 updated_at = NOW()
           WHERE variant_id = ${variantId}::uuid
             AND quantity - reserved >= ${quantity}`;

    if (updated === 0) {
      const current = await this.readStock(tx, variantId);
      throw Errors.insufficientStock(current.sku, quantity, current.available);
    }

    await this.writeLedger(tx, {
      variantId,
      type: 'RESERVATION',
      quantityChange: 0,
      reason: `Reserved ${quantity} for ${reference.type}`,
      referenceType: reference.type,
      referenceId: reference.id,
    });
  }

  /** Converts a reservation into a sale: `quantity -= n`, `reserved -= n`. */
  async commit(
    tx: TenantTransactionClient,
    variantId: string,
    quantity: number,
    reference: { type: string; id: string },
  ): Promise<void> {
    const updated = await tx.$executeRaw`
      UPDATE inventory
         SET quantity = quantity - ${quantity},
             reserved = GREATEST(0, reserved - ${quantity}),
             version = version + 1,
             updated_at = NOW()
       WHERE variant_id = ${variantId}::uuid
         AND quantity >= ${quantity}`;

    if (updated === 0) {
      // Backorder or a manual stock-take can leave less on hand than reserved.
      // Clamping to zero beats failing a paid order.
      this.logger.warn('Committing stock below zero; clamping', { variantId, quantity });
      await tx.$executeRaw`
        UPDATE inventory
           SET quantity = 0,
               reserved = GREATEST(0, reserved - ${quantity}),
               version = version + 1,
               updated_at = NOW()
         WHERE variant_id = ${variantId}::uuid`;
    }

    const after = await this.readStock(tx, variantId);
    await this.writeLedger(tx, {
      variantId,
      type: 'SALE',
      quantityChange: -quantity,
      quantityAfter: after.quantity,
      reason: `Sold ${quantity}`,
      referenceType: reference.type,
      referenceId: reference.id,
    });
  }

  /** Returns held stock to the available pool (cancellation, payment failure). */
  async release(
    tx: TenantTransactionClient,
    variantId: string,
    quantity: number,
    reference: { type: string; id: string },
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE inventory
         SET reserved = GREATEST(0, reserved - ${quantity}),
             version = version + 1,
             updated_at = NOW()
       WHERE variant_id = ${variantId}::uuid`;

    await this.writeLedger(tx, {
      variantId,
      type: 'RELEASE',
      quantityChange: 0,
      reason: `Released ${quantity} from ${reference.type}`,
      referenceType: reference.type,
      referenceId: reference.id,
    });
  }

  /** Puts sold units back on the shelf (refund or return). */
  async restock(
    tx: TenantTransactionClient,
    variantId: string,
    quantity: number,
    reference: { type: string; id: string },
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE inventory
         SET quantity = quantity + ${quantity},
             version = version + 1,
             updated_at = NOW()
       WHERE variant_id = ${variantId}::uuid`;

    const after = await this.readStock(tx, variantId);
    await this.writeLedger(tx, {
      variantId,
      type: 'RETURN',
      quantityChange: quantity,
      quantityAfter: after.quantity,
      reason: `Returned ${quantity}`,
      referenceType: reference.type,
      referenceId: reference.id,
    });
  }

  // ============================================================== merchant ==

  async list(query: {
    page?: number;
    limit?: number;
    search?: string;
    lowStockOnly?: boolean;
    outOfStockOnly?: boolean;
    categoryId?: string;
  }): Promise<PaginatedResult<InventoryRecord>> {
    const { skip, take, page, limit } = toPrismaPage(query);
    const search = normaliseSearch(query.search);

    const where: Record<string, unknown> = {
      variant: {
        deletedAt: null,
        product: {
          deletedAt: null,
          ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        },
        ...(search
          ? {
              OR: [
                { sku: { contains: escapeLike(search).toUpperCase() } },
                { product: { name: { contains: escapeLike(search), mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
    };

    if (query.outOfStockOnly) where.quantity = { lte: 0 };

    const [rows, total] = await this.tenantDb.run((db) =>
      Promise.all([
        db.inventory.findMany({
          where,
          include: {
            variant: {
              include: {
                product: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: [{ quantity: 'asc' }, { updatedAt: 'desc' }],
          skip,
          take,
        }),
        db.inventory.count({ where }),
      ]),
    );

    let items = rows.map((row) => this.toRecord(row));
    // Low stock is a derived comparison against a per-row threshold, so it is
    // applied after mapping rather than in SQL.
    if (query.lowStockOnly) items = items.filter((i) => i.isLowStock);

    return paginate(items, total, page, limit);
  }

  /**
   * Manual adjustment by a staff member.
   *
   * `expectedVersion` gives optimistic concurrency: if two people are counting
   * the same shelf, the second one is told to reload instead of silently
   * overwriting the first.
   */
  async adjust(input: AdjustInventoryInput): Promise<InventoryRecord> {
    const record = await this.tenantDb.transaction(async (tx) => {
      const current = await tx.inventory.findUnique({
        where: { variantId: input.variantId },
        include: { variant: { include: { product: { select: { id: true, name: true } } } } },
      });
      if (!current) throw Errors.notFound('Inventory record for this variant');

      if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
        throw Errors.concurrentModification('stock level');
      }

      const delta =
        input.setQuantity !== undefined
          ? input.setQuantity - current.quantity
          : (input.quantityChange ?? 0);

      const newQuantity = current.quantity + delta;
      if (newQuantity < 0) {
        throw Errors.badRequest(
          `That would take stock to ${newQuantity}. Current quantity is ${current.quantity}.`,
        );
      }
      if (newQuantity < current.reserved) {
        throw Errors.badRequest(
          `Cannot reduce below ${current.reserved} — that many units are reserved for open orders.`,
        );
      }

      const updated = await tx.inventory.update({
        where: { variantId: input.variantId },
        data: { quantity: newQuantity, version: { increment: 1 } },
        include: { variant: { include: { product: { select: { id: true, name: true } } } } },
      });

      await tx.inventoryTransaction.create({
        data: {
          variantId: input.variantId,
          type: input.type,
          quantityChange: delta,
          quantityAfter: newQuantity,
          reason: input.reason ?? (input.setQuantity !== undefined ? 'Stock take' : 'Manual adjustment'),
          referenceType: 'manual',
          performedBy: this.context.userId,
        },
      });

      return updated;
    });

    this.audit.record('tenant', {
      action: AuditAction.INVENTORY_ADJUSTED,
      resourceType: 'inventory',
      resourceId: input.variantId,
      metadata: {
        type: input.type,
        quantityChange: input.quantityChange,
        setQuantity: input.setQuantity,
        reason: input.reason,
      },
    });

    const mapped = this.toRecord(record);
    if (mapped.isLowStock || mapped.available === 0) {
      await this.queue.lowStockAlert({
        tenantId: this.tenantDb.tenantId,
        variantIds: [input.variantId],
      });
    }
    return mapped;
  }

  async bulkAdjust(inputs: AdjustInventoryInput[]): Promise<InventoryRecord[]> {
    const results: InventoryRecord[] = [];
    // Sequential on purpose: each adjustment must produce its own ledger entry
    // and its own concurrency check, and a partial failure should stop the rest.
    for (const input of inputs) {
      results.push(await this.adjust(input));
    }
    return results;
  }

  async setLowStockThreshold(variantId: string, threshold: number): Promise<InventoryRecord> {
    const record = await this.tenantDb.run((db) =>
      db.inventory.update({
        where: { variantId },
        data: { lowStockThreshold: threshold },
        include: { variant: { include: { product: { select: { id: true, name: true } } } } },
      }),
    );
    return this.toRecord(record);
  }

  async transactions(query: {
    variantId?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResult<InventoryTransaction>> {
    const { skip, take, page, limit } = toPrismaPage(query);
    const where = query.variantId ? { variantId: query.variantId } : {};

    const [rows, total] = await this.tenantDb.run((db) =>
      Promise.all([
        db.inventoryTransaction.findMany({
          where,
          include: { variant: { select: { sku: true } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        db.inventoryTransaction.count({ where }),
      ]),
    );

    const items: InventoryTransaction[] = rows.map((row) => ({
      id: row.id,
      variantId: row.variantId,
      sku: row.variant.sku,
      type: row.type,
      quantityChange: row.quantityChange,
      quantityAfter: row.quantityAfter,
      reason: row.reason,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      performedBy: row.performedBy,
      createdAt: row.createdAt.toISOString(),
    }));

    return paginate(items, total, page, limit);
  }

  /** Variants at or below their threshold — powers the dashboard alert card. */
  async lowStockItems(limit = 10) {
    const rows = await this.tenantDb.run(
      (db) =>
        db.$queryRaw<
          {
            variant_id: string;
            product_id: string;
            product_name: string;
            variant_label: string;
            sku: string;
            image_url: string | null;
            available: number;
            low_stock_threshold: number;
          }[]
        >`
        SELECT i.variant_id,
               p.id            AS product_id,
               p.name          AS product_name,
               v.label         AS variant_label,
               v.sku,
               COALESCE(v.image_url, (
                 SELECT pi.url FROM product_images pi
                  WHERE pi.product_id = p.id
                  ORDER BY pi.is_primary DESC, pi.sort_order ASC
                  LIMIT 1
               ))              AS image_url,
               (i.quantity - i.reserved) AS available,
               i.low_stock_threshold
          FROM inventory i
          JOIN product_variants v ON v.id = i.variant_id
          JOIN products p         ON p.id = v.product_id
         WHERE v.deleted_at IS NULL
           AND p.deleted_at IS NULL
           AND (i.quantity - i.reserved) <= i.low_stock_threshold
         ORDER BY available ASC
         LIMIT ${limit}`,
    );

    return rows.map((r) => ({
      variantId: r.variant_id,
      productId: r.product_id,
      productName: r.product_name,
      variantLabel: r.variant_label,
      sku: r.sku,
      imageUrl: r.image_url,
      available: Number(r.available),
      lowStockThreshold: r.low_stock_threshold,
    }));
  }

  // ============================================================ internals ==

  private async readStock(
    tx: TenantTransactionClient,
    variantId: string,
  ): Promise<{ quantity: number; reserved: number; available: number; sku: string }> {
    const row = await tx.inventory.findUnique({
      where: { variantId },
      include: { variant: { select: { sku: true } } },
    });
    if (!row) throw Errors.notFound('Inventory record');
    return {
      quantity: row.quantity,
      reserved: row.reserved,
      available: Math.max(0, row.quantity - row.reserved),
      sku: row.variant.sku,
    };
  }

  private async writeLedger(
    tx: TenantTransactionClient,
    entry: {
      variantId: string;
      type: 'RESERVATION' | 'RELEASE' | 'SALE' | 'RETURN' | 'ADJUSTMENT';
      quantityChange: number;
      quantityAfter?: number;
      reason: string;
      referenceType: string;
      referenceId: string;
    },
  ): Promise<void> {
    const quantityAfter =
      entry.quantityAfter ?? (await this.readStock(tx, entry.variantId)).quantity;

    await tx.inventoryTransaction.create({
      data: {
        variantId: entry.variantId,
        type: entry.type,
        quantityChange: entry.quantityChange,
        quantityAfter,
        reason: entry.reason,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        performedBy: this.context.userId,
      },
    });
  }

  private toRecord(row: {
    id: string;
    variantId: string;
    quantity: number;
    reserved: number;
    lowStockThreshold: number;
    version: number;
    updatedAt: Date;
    variant: {
      sku: string;
      label: string;
      imageUrl: string | null;
      productId: string;
      product: { id: string; name: string };
    };
  }): InventoryRecord {
    const available = Math.max(0, row.quantity - row.reserved);
    return {
      id: row.id,
      variantId: row.variantId,
      sku: row.variant.sku,
      productId: row.variant.productId,
      productName: row.variant.product.name,
      variantLabel: row.variant.label,
      imageUrl: row.variant.imageUrl,
      quantity: row.quantity,
      reserved: row.reserved,
      available,
      lowStockThreshold: row.lowStockThreshold,
      isLowStock: available <= row.lowStockThreshold,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
