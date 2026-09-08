'use client';

import Link from 'next/link';
import { ImageOff, Star } from 'lucide-react';
import { formatMoney } from '@retailos/config';
import type { ProductCardVariant } from '@retailos/templates';
import type { ProductListItem } from '@retailos/types';
import { cn } from '@retailos/ui';
import { productAspectStyle, useTemplate } from '../context';

/**
 * The product card, in five voices.
 *
 * Every variant renders the *same* `ProductListItem` — the template decides how
 * a product looks, never what a product is. Swapping designs re-reads the same
 * catalogue row through a different card; no product data is copied, adapted or
 * duplicated to make a template work.
 *
 * The whole card is one link in every variant: on a phone the tap target is the
 * card, not the title.
 */
export function ProductCard({
  product,
  currency = 'INR',
  className,
  variant,
  priority,
}: {
  product: ProductListItem;
  currency?: string;
  className?: string;
  /** Overrides the template's card, for previews that need a specific one. */
  variant?: ProductCardVariant;
  priority?: boolean;
}) {
  const { layout } = useTemplate();
  const kind = variant ?? layout.productCard;

  const image = (
    <ProductImage product={product} aspect={productAspectStyle(layout)} priority={priority} kind={kind} />
  );

  const price = (
    <Price product={product} currency={currency} kind={kind} />
  );

  switch (kind) {
    // ── Editorial: type-led, no card chrome, lots of air. Urban Luxe. ──────
    case 'editorial':
      return (
        <Link href={href(product)} className={cn('group flex flex-col', className)}>
          <div className="relative overflow-hidden bg-surface-muted">{image}</div>
          <div className="flex flex-1 flex-col pt-3">
            {product.brandName && (
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-content-subtle">
                {product.brandName}
              </p>
            )}
            <h3 className="line-clamp-2 text-sm font-medium leading-snug text-content group-hover:underline">
              {product.name}
            </h3>
            <div className="mt-2">{price}</div>
          </div>
        </Link>
      );

    // ── Portrait: framed, serif-friendly, centred. Silk Editorial. ─────────
    case 'portrait':
      return (
        <Link href={href(product)} className={cn('group flex flex-col text-center', className)}>
          <div className="relative overflow-hidden rounded-[var(--radius)] bg-surface-muted">
            {image}
          </div>
          <div className="flex flex-1 flex-col px-1 pt-3.5">
            <h3 className="heading line-clamp-2 text-[15px] leading-snug text-content group-hover:text-primary">
              {product.name}
            </h3>
            {product.brandName && (
              <p className="mt-1 text-xs text-content-subtle">{product.brandName}</p>
            )}
            <div className="mt-2.5 flex justify-center">{price}</div>
          </div>
        </Link>
      );

    // ── Spec: dense, rating-forward, comparison-friendly. Spec Grid. ───────
    case 'spec':
      return (
        <Link
          href={href(product)}
          className={cn(
            'group flex flex-col overflow-hidden rounded-[var(--radius)] border border-line bg-surface transition hover:border-primary/40 hover:shadow-md',
            className,
          )}
        >
          <div className="relative bg-white p-3">{image}</div>
          <div className="flex flex-1 flex-col border-t border-line p-3">
            {product.brandName && (
              <p className="mb-0.5 truncate text-[11px] font-semibold uppercase tracking-wide text-primary">
                {product.brandName}
              </p>
            )}
            <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-content">
              {product.name}
            </h3>
            {product.ratingCount > 0 && <Rating product={product} className="mt-1.5" />}
            <div className="mt-auto pt-2.5">
              {price}
              <p className="mt-1 text-[11px] text-content-muted tabular">
                or {formatMoney(Math.round(product.priceFrom / 6), currency, { hideDecimals: true })}
                /mo · 6 mo EMI
              </p>
            </div>
          </div>
        </Link>
      );

    // ── Soft: rounded, warm, generous. Glow and Pawsome. ───────────────────
    case 'soft':
      return (
        <Link
          href={href(product)}
          className={cn(
            'group flex flex-col overflow-hidden rounded-3xl bg-surface shadow-sm ring-1 ring-black/5 transition hover:shadow-lg',
            className,
          )}
        >
          <div className="relative overflow-hidden bg-surface-muted">{image}</div>
          <div className="flex flex-1 flex-col p-3.5">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-content group-hover:text-primary">
              {product.name}
            </h3>
            {product.ratingCount > 0 && <Rating product={product} className="mt-1.5" />}
            <div className="mt-auto pt-2.5">{price}</div>
          </div>
        </Link>
      );

    // ── Compact: minimum height per product. Daily Cart. ───────────────────
    case 'compact':
    default:
      return (
        <Link
          href={href(product)}
          className={cn(
            'group flex flex-col overflow-hidden rounded-[var(--radius)] border border-line bg-surface transition hover:shadow-md',
            className,
          )}
        >
          <div className="relative overflow-hidden bg-surface-muted">{image}</div>
          <div className="flex flex-1 flex-col p-2.5">
            <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-content group-hover:text-primary">
              {product.name}
            </h3>
            <div className="mt-auto pt-2">{price}</div>
          </div>
        </Link>
      );
  }
}

function href(product: ProductListItem): string {
  return `/products/${product.slug}`;
}

function ProductImage({
  product,
  aspect,
  priority,
  kind,
}: {
  product: ProductListItem;
  aspect: { aspectRatio: string };
  priority?: boolean;
  kind: ProductCardVariant;
}) {
  return (
    <>
      <div style={aspect} className="w-full overflow-hidden">
        {product.primaryImageUrl ? (
          <img
            src={product.primaryImageUrl}
            alt={product.name}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            className={cn(
              'h-full w-full transition-transform duration-500 group-hover:scale-[1.04]',
              kind === 'spec' ? 'object-contain' : 'object-cover',
            )}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-surface-muted text-content-subtle">
            <ImageOff className="h-7 w-7" aria-hidden="true" />
          </span>
        )}
      </div>

      {product.discountPercent > 0 && (
        <span
          className={cn(
            'absolute left-2 top-2 px-2 py-0.5 text-[11px] font-semibold',
            kind === 'editorial'
              ? 'bg-content text-surface'
              : 'rounded-full bg-accent text-accent-fg',
          )}
        >
          {product.discountPercent}% off
        </span>
      )}

      {!product.inStock && (
        <span className="absolute inset-0 flex items-center justify-center bg-surface/80 text-sm font-semibold uppercase tracking-wide text-content">
          Sold out
        </span>
      )}
    </>
  );
}

function Rating({ product, className }: { product: ProductListItem; className?: string }) {
  return (
    <p className={cn('flex items-center gap-1 text-xs text-content-muted', className)}>
      <Star className="h-3 w-3 fill-current text-amber-500" aria-hidden="true" />
      <span className="font-medium text-content tabular">{product.ratingAverage.toFixed(1)}</span>
      <span className="tabular">({product.ratingCount})</span>
    </p>
  );
}

function Price({
  product,
  currency,
  kind,
}: {
  product: ProductListItem;
  currency: string;
  kind: ProductCardVariant;
}) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span
        className={cn(
          'font-bold text-content tabular',
          kind === 'editorial' || kind === 'portrait' ? 'text-sm font-semibold' : 'text-[15px]',
        )}
      >
        {formatMoney(product.priceFrom, currency)}
      </span>
      {product.discountPercent > 0 && (
        <span className="text-xs text-content-subtle line-through tabular">
          {formatMoney(product.mrpFrom, currency)}
        </span>
      )}
    </span>
  );
}

/** Matching skeleton, so a loading grid holds the shape the cards will fill. */
export function ProductCardSkeleton() {
  const { layout } = useTemplate();
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-surface">
      <div
        style={productAspectStyle(layout)}
        className="skeleton-shimmer relative w-full bg-neutral-200/70"
      />
      <div className="space-y-2 p-3">
        <div className="skeleton-shimmer relative h-3 w-1/3 rounded bg-neutral-200/70" />
        <div className="skeleton-shimmer relative h-4 w-full rounded bg-neutral-200/70" />
        <div className="skeleton-shimmer relative h-4 w-1/2 rounded bg-neutral-200/70" />
      </div>
    </div>
  );
}
