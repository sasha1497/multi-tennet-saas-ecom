'use client';

import Link from 'next/link';
import { ImageOff } from 'lucide-react';
import { formatMoney } from '@retailos/config';
import type { ProductListItem } from '@retailos/types';
import { cn } from '@retailos/ui';

/**
 * Product card.
 *
 * The whole card is one link — a shopper's tap target is the card, not just the
 * title. Prices use tabular figures so a grid of cards lines up column-wise.
 */
export function ProductCard({
  product,
  currency = 'INR',
  className,
}: {
  product: ProductListItem;
  currency?: string;
  className?: string;
}) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-shadow hover:shadow-md',
        className,
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-surface-muted">
        {product.primaryImageUrl ? (
          <img
            src={product.primaryImageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-content-subtle">
            <ImageOff className="h-8 w-8" />
          </span>
        )}

        {product.discountPercent > 0 && (
          <span className="absolute left-2 top-2 rounded-full bg-brandAccent px-2 py-0.5 text-[11px] font-semibold text-brandAccent-fg">
            {product.discountPercent}% off
          </span>
        )}

        {!product.inStock && (
          <span className="absolute inset-0 flex items-center justify-center bg-surface/75 text-sm font-semibold text-content">
            Out of stock
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        {product.brandName && (
          <p className="mb-0.5 truncate text-[11px] uppercase tracking-wide text-content-subtle">
            {product.brandName}
          </p>
        )}
        <h3 className="line-clamp-2 text-sm font-medium text-content group-hover:text-primary">
          {product.name}
        </h3>

        {product.ratingCount > 0 && (
          <p className="mt-1 flex items-center gap-1 text-xs text-content-muted">
            <span className="rounded bg-success-500 px-1 py-px text-[10px] font-semibold text-white tabular">
              {product.ratingAverage.toFixed(1)} ★
            </span>
            <span className="tabular">({product.ratingCount})</span>
          </p>
        )}

        <div className="mt-auto pt-2">
          <span className="text-base font-bold text-content tabular">
            {formatMoney(product.priceFrom, currency)}
          </span>
          {product.discountPercent > 0 && (
            <span className="ml-1.5 text-xs text-content-subtle line-through tabular">
              {formatMoney(product.mrpFrom, currency)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/** Matching skeleton so a loading grid holds the same shape. */
export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="skeleton-shimmer relative aspect-square bg-neutral-200/70 dark:bg-neutral-800" />
      <div className="space-y-2 p-3">
        <div className="skeleton-shimmer relative h-3 w-1/3 rounded bg-neutral-200/70 dark:bg-neutral-800" />
        <div className="skeleton-shimmer relative h-4 w-full rounded bg-neutral-200/70 dark:bg-neutral-800" />
        <div className="skeleton-shimmer relative h-4 w-1/2 rounded bg-neutral-200/70 dark:bg-neutral-800" />
      </div>
    </div>
  );
}
