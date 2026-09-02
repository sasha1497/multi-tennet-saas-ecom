import { PaginationQuery } from './common';
import { InventoryTransactionType } from './enums';

export interface InventoryRecord {
  id: string;
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  variantLabel: string;
  imageUrl: string | null;

  quantity: number;
  reserved: number;
  /** Always `quantity - reserved`; computed, never stored. */
  available: number;
  lowStockThreshold: number;
  isLowStock: boolean;

  /** Optimistic-concurrency token — clients must echo it back on adjustments. */
  version: number;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: string;
  variantId: string;
  sku: string;
  type: InventoryTransactionType;
  /** Signed: negative for outbound movements. */
  quantityChange: number;
  quantityAfter: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  performedBy: string | null;
  createdAt: string;
}

export interface AdjustInventoryRequest {
  variantId: string;
  /** Signed delta. Use `setQuantity` instead for an absolute stock-take. */
  quantityChange?: number;
  setQuantity?: number;
  type: InventoryTransactionType;
  reason?: string;
  /** Optimistic lock; omit to force. */
  expectedVersion?: number;
}

export interface BulkAdjustInventoryRequest {
  adjustments: AdjustInventoryRequest[];
}

export interface UpdateLowStockThresholdRequest {
  variantId: string;
  lowStockThreshold: number;
}

export interface InventoryQuery extends PaginationQuery {
  lowStockOnly?: boolean;
  outOfStockOnly?: boolean;
  categoryId?: string;
}
