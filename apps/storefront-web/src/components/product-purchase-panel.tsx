'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Heart, ImageOff, Minus, Plus, ShieldCheck, ShoppingBag, Truck } from 'lucide-react';
import { formatMoney } from '@retailos/config';
import type { Product, ProductVariant, StoreSettings } from '@retailos/types';
import { Badge, Button, cn, useToast } from '@retailos/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { useTemplate } from '@/templates/context';

/**
 * Gallery + variant selection + add to bag, in four arrangements.
 *
 * One client island rather than three, because these pieces are genuinely
 * coupled: choosing a colour can change the image, and stock availability
 * depends on the selected variant. The active template rearranges them —
 * sticky buy box, stacked gallery, spec sheet — but every arrangement reads
 * the same product and reaches the same cart API. Switching template changes
 * where the Add to bag button sits, never what it does.
 */
export function ProductPurchasePanel({
  product,
  currency,
  store,
}: {
  product: Product;
  currency: string;
  store: StoreSettings;
}) {
  const { addToCart, customer } = useStore();
  const { layout } = useTemplate();
  const toast = useToast();
  const router = useRouter();

  // Default to the first variant that is actually buyable.
  const firstAvailable =
    product.variants.find((v) => v.isActive && v.stock.inStock) ?? product.variants[0];

  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(
    firstAvailable?.options ?? {},
  );
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [adding, setAdding] = useState(false);

  const selectedVariant: ProductVariant | undefined = useMemo(() => {
    if (product.options.length === 0) return product.variants[0];
    return product.variants.find((v) =>
      product.options.every((opt) => v.options[opt.name] === selectedOptions[opt.name]),
    );
  }, [product, selectedOptions]);

  /**
   * Which option values are actually purchasable given the rest of the
   * selection. Greying out an unavailable size is far better than letting a
   * shopper pick it and hit an error at checkout.
   */
  const availabilityFor = (optionName: string, value: string): boolean => {
    const probe = { ...selectedOptions, [optionName]: value };
    return product.variants.some(
      (v) =>
        v.isActive &&
        v.stock.inStock &&
        product.options.every((opt) => v.options[opt.name] === probe[opt.name]),
    );
  };

  const images = product.images.length > 0 ? product.images : [];
  const activeImage = selectedVariant?.imageUrl ?? images[imageIndex]?.url ?? null;

  const price = selectedVariant?.price ?? product.priceFrom;
  const mrp = selectedVariant?.mrp ?? product.mrpFrom;
  const discount = mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
  const available = selectedVariant?.stock.available ?? 0;
  const canBuy = Boolean(selectedVariant) && (available > 0 || store.allowBackorder);

  const handleAdd = async (thenCheckout = false) => {
    if (!selectedVariant) return;
    setAdding(true);
    try {
      await addToCart(selectedVariant.id, quantity);
      if (thenCheckout) router.push('/checkout');
    } catch {
      // The toast is raised by the store context.
    } finally {
      setAdding(false);
    }
  };

  const addToWishlist = async () => {
    if (!customer) {
      router.push(`/login?next=/products/${product.slug}`);
      return;
    }
    try {
      await api().storefront.addToWishlist(product.id);
      toast.success('Saved to your wishlist');
    } catch {
      toast.error('Could not save this item');
    }
  };

  const variant = layout.productDetail;
  const stacked = variant === 'stackedGallery';
  const immersive = variant === 'immersive';

  // ── Gallery ─────────────────────────────────────────────────────────────
  const gallery = (
    <div className={cn(stacked && 'lg:sticky lg:top-24')}>
      <div
        className={cn(
          'overflow-hidden bg-surface-muted',
          variant === 'stickyPanel' || variant === 'immersive'
            ? 'rounded-none'
            : 'rounded-[calc(var(--radius)*1.5)] border border-line',
        )}
      >
        <div style={{ aspectRatio: immersive ? '4 / 3' : layout.productAspect }}>
          {activeImage ? (
            <img
              src={activeImage}
              alt={product.name}
              className={cn(
                'h-full w-full',
                variant === 'specSheet' ? 'bg-white object-contain p-6' : 'object-cover',
              )}
              fetchPriority="high"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-content-subtle">
              <ImageOff className="h-10 w-10" aria-hidden="true" />
            </span>
          )}
        </div>
      </div>

      {images.length > 1 && (
        <div className="scroll-slim mt-3 flex gap-2 overflow-x-auto">
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setImageIndex(i)}
              aria-pressed={i === imageIndex}
              className={cn(
                'h-16 w-16 shrink-0 overflow-hidden rounded-[var(--radius)] border-2 transition-colors',
                i === imageIndex ? 'border-primary' : 'border-line hover:border-content-subtle',
              )}
              aria-label={`View image ${i + 1}`}
            >
              <img src={image.url} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // ── Buy box ─────────────────────────────────────────────────────────────
  const buyBox = (
    <div className={cn(variant === 'stickyPanel' && 'lg:sticky lg:top-24 lg:self-start')}>
      {product.brand && (
        <Link
          href={`/products?brand=${product.brandId}`}
          className="text-xs uppercase tracking-[0.14em] text-content-subtle hover:text-primary"
        >
          {product.brand.name}
        </Link>
      )}

      <h1 className="heading mt-1.5 text-2xl leading-tight text-content sm:text-3xl">
        {product.name}
      </h1>

      {product.shortDescription && (
        <p className="mt-2.5 text-[15px] leading-relaxed text-content-muted">
          {product.shortDescription}
        </p>
      )}

      {product.ratingCount > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded bg-success-500 px-1.5 py-0.5 text-xs font-semibold text-white tabular">
            {product.ratingAverage.toFixed(1)} ★
          </span>
          <span className="text-sm text-content-muted tabular">
            {product.ratingCount} rating{product.ratingCount === 1 ? '' : 's'}
          </span>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-baseline gap-2.5">
        <span className="text-3xl font-bold text-content tabular">
          {formatMoney(price, currency)}
        </span>
        {discount > 0 && (
          <>
            <span className="text-lg text-content-subtle line-through tabular">
              {formatMoney(mrp, currency)}
            </span>
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-fg">
              {discount}% off
            </span>
          </>
        )}
      </div>
      {store.taxInclusivePricing && (
        <p className="mt-0.5 text-xs text-content-subtle">Inclusive of all taxes</p>
      )}

      {/* EMI line: a spec-led store sells the monthly number, not the total. */}
      {variant === 'specSheet' && price > 300000 && (
        <p className="mt-2 text-sm text-content-muted tabular">
          From {formatMoney(Math.round(price / 6), currency, { hideDecimals: true })}/month on 6-month
          EMI
        </p>
      )}

      {/* Option selectors */}
      {product.options.map((option) => (
        <div key={option.name} className="mt-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-content">{option.name}</h2>
            {selectedOptions[option.name] && (
              <span className="text-sm text-content-muted">{selectedOptions[option.name]}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {option.values.map((value) => {
              const selected = selectedOptions[option.name] === value;
              const purchasable = availabilityFor(option.name, value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setSelectedOptions((s) => ({ ...s, [option.name]: value }));
                    setQuantity(1);
                  }}
                  aria-pressed={selected}
                  className={cn(
                    'min-w-[3rem] rounded-[var(--radius)] border px-3 py-2 text-sm font-medium transition-colors',
                    selected
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-line text-content hover:border-content-subtle',
                    // Unavailable combinations are struck through rather than
                    // hidden — the shopper can see the size exists, just not now.
                    !purchasable && 'text-content-subtle line-through opacity-60',
                  )}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Stock signal */}
      <div className="mt-5">
        {!selectedVariant ? (
          <Badge tone="warning" dot>
            Choose an option to continue
          </Badge>
        ) : available === 0 ? (
          <Badge tone="danger" dot>
            Out of stock
          </Badge>
        ) : available <= 5 ? (
          <Badge tone="warning" dot>
            Only {available} left
          </Badge>
        ) : (
          <Badge tone="success" dot>
            In stock
          </Badge>
        )}
        {selectedVariant && (
          <span className="ml-2 text-xs text-content-subtle">SKU {selectedVariant.sku}</span>
        )}
      </div>

      {/* Quantity + actions */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-[var(--radius)] border border-line">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            className="p-2.5 text-content-muted hover:text-content disabled:opacity-40"
            aria-label="Decrease quantity"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="w-10 text-center text-sm font-medium text-content tabular">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(available || 99, q + 1))}
            disabled={available > 0 && quantity >= available}
            className="p-2.5 text-content-muted hover:text-content disabled:opacity-40"
            aria-label="Increase quantity"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <Button
          size="lg"
          leftIcon={<ShoppingBag className="h-4 w-4" />}
          onClick={() => void handleAdd(false)}
          loading={adding}
          disabled={!canBuy}
          className="min-w-[140px] flex-1"
        >
          Add to bag
        </Button>

        <Button
          size="icon"
          variant="outline"
          className="h-11 w-11"
          onClick={() => void addToWishlist()}
          aria-label="Save to wishlist"
        >
          <Heart className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <Button
        size="lg"
        variant="secondary"
        fullWidth
        className="mt-3"
        onClick={() => void handleAdd(true)}
        disabled={!canBuy || adding}
      >
        Buy now
      </Button>

      {/* Reassurance */}
      <ul className="mt-6 space-y-2.5 border-t border-line pt-5 text-sm text-content-muted">
        <li className="flex items-center gap-2.5">
          <Truck className="h-4 w-4 shrink-0 text-content-subtle" aria-hidden="true" />
          {store.freeShippingThreshold > 0 ? (
            <>
              Free delivery on orders above{' '}
              {formatMoney(store.freeShippingThreshold, currency, { hideDecimals: true })}
            </>
          ) : (
            <>Delivery charge {formatMoney(store.shippingFee, currency)}</>
          )}
        </li>
        {store.codEnabled && (
          <li className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 shrink-0 text-content-subtle" aria-hidden="true" />
            Cash on delivery available
          </li>
        )}
      </ul>

      {variant === 'specSheet' && <SpecSheet product={product} variant={selectedVariant} />}
    </div>
  );

  // ── Arrangement ─────────────────────────────────────────────────────────

  // Immersive: the photograph takes the full width of the page and the buy box
  // floats over its lower third on a wide screen. The premium templates' detail
  // layout. On a phone it falls back to the ordinary stack, because a panel
  // overlaying a 375px-wide image would cover the product entirely.
  if (variant === 'immersive') {
    return (
      <div className="lg:relative">
        <div className="lg:-mx-6 xl:-mx-12">{gallery}</div>
        <div className="mt-8 lg:absolute lg:inset-x-0 lg:bottom-0 lg:mt-0 lg:flex lg:justify-end lg:px-6 xl:px-12">
          <div className="lg:w-[26rem] lg:rounded-[calc(var(--radius)*1.5)] lg:bg-surface/95 lg:p-8 lg:shadow-2xl lg:backdrop-blur">
            {buyBox}
          </div>
        </div>
      </div>
    );
  }

  if (stacked) {
    // Gallery gets the wider column and stays put while the details scroll.
    return (
      <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr]">
        {gallery}
        {buyBox}
      </div>
    );
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-2">
      {gallery}
      {buyBox}
    </div>
  );
}

/**
 * A specification table, built entirely from data the merchant already
 * entered — brand, category, SKU, HSN, variant options, tags. Nothing is
 * invented to fill the table; rows with no value are dropped.
 */
function SpecSheet({ product, variant }: { product: Product; variant?: ProductVariant }) {
  const rows: { label: string; value: string }[] = [
    product.brand ? { label: 'Brand', value: product.brand.name } : null,
    product.category ? { label: 'Category', value: product.category.name } : null,
    variant ? { label: 'Model / SKU', value: variant.sku } : null,
    ...(variant
      ? Object.entries(variant.options).map(([label, value]) => ({ label, value }))
      : []),
    variant?.barcode ? { label: 'Barcode', value: variant.barcode } : null,
    product.hsnCode ? { label: 'HSN', value: product.hsnCode } : null,
    variant?.weightGrams ? { label: 'Weight', value: `${variant.weightGrams} g` } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);

  if (rows.length === 0) return null;

  return (
    <section className="mt-7">
      <h2 className="mb-3 text-sm font-semibold text-content">Specifications</h2>
      <dl className="overflow-hidden rounded-[var(--radius)] border border-line text-sm">
        {rows.map((row, i) => (
          <div
            key={`${row.label}-${i}`}
            className={cn(
              'grid grid-cols-[40%_60%] gap-3 px-4 py-2.5',
              i % 2 === 1 && 'bg-surface-muted',
            )}
          >
            <dt className="text-content-muted">{row.label}</dt>
            <dd className="font-medium text-content">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
