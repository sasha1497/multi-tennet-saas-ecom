import Link from 'next/link';
import { ArrowRight, BadgePercent, ShieldCheck, Truck } from 'lucide-react';
import { formatMoney } from '@retailos/config';
import { ProductCard } from '@/components/product-card';
import { loadStorefront, serverApi } from '@/lib/server-api';

/**
 * Store home page.
 *
 * Server-rendered: the tenant is resolved from the Host, the catalog is fetched
 * on the server, and the browser receives finished HTML. That matters for a
 * retail storefront — it is the difference between a fast first paint on a
 * mid-range phone and a spinner.
 */
export default async function HomePage() {
  const data = await loadStorefront();
  if (!data) return null; // The layout already rendered the "no store" page.

  const { store, categories } = data;
  const api = serverApi();

  // Fetched in parallel — three sequential round trips would be visible.
  const [featured, popular] = await Promise.all([
    api.storefront.featuredProducts(8).catch(() => []),
    api.storefront.popularProducts(8).catch(() => []),
  ]);

  const banner = store.banners.find((b) => b.isActive) ?? store.banners[0];

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line bg-primary-soft">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-12 lg:grid-cols-2 lg:py-16">
          <div>
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-content sm:text-4xl lg:text-5xl">
              {banner?.title ?? store.tagline ?? `Welcome to ${store.storeName}`}
            </h1>
            <p className="mt-3 max-w-md text-md text-content-muted">
              {banner?.subtitle ??
                store.description ??
                'Quality products from your neighbourhood store, delivered to your door.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={banner?.ctaHref ?? '/products'}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-md font-semibold text-primary-fg transition hover:brightness-110"
              >
                {banner?.ctaLabel ?? 'Shop now'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/offers"
                className="inline-flex h-11 items-center rounded-lg border border-line bg-surface px-5 text-md font-semibold text-content transition hover:bg-surface-muted"
              >
                View offers
              </Link>
            </div>
          </div>

          {banner?.imageUrl && (
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl lg:aspect-[3/2]">
              <img
                src={banner.imageUrl}
                alt=""
                className="h-full w-full object-cover"
                fetchPriority="high"
              />
            </div>
          )}
        </div>
      </section>

      {/* Trust strip — the three things a local shopper actually wants to know. */}
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:grid-cols-3">
          <Feature
            icon={<Truck className="h-4.5 w-4.5" />}
            title={
              store.freeShippingThreshold > 0
                ? `Free delivery above ${formatMoney(store.freeShippingThreshold, store.currency, { hideDecimals: true })}`
                : 'Fast local delivery'
            }
            description="Delivered from a shop near you"
          />
          <Feature
            icon={<ShieldCheck className="h-4.5 w-4.5" />}
            title={store.codEnabled ? 'Cash on delivery' : 'Secure payments'}
            description={store.codEnabled ? 'Pay when it arrives' : 'UPI, cards and net banking'}
          />
          <Feature
            icon={<BadgePercent className="h-4.5 w-4.5" />}
            title="Genuine products"
            description="Straight from the store"
          />
        </div>
      </section>

      {/* Categories */}
      {categories.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-10">
          <h2 className="mb-5 text-xl font-bold tracking-tight text-content">Shop by category</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {categories.slice(0, 10).map((cat) => (
              <Link
                key={cat.id}
                href={`/products?category=${cat.slug}`}
                className="group overflow-hidden rounded-xl border border-line bg-surface transition-shadow hover:shadow-md"
              >
                <div className="aspect-[4/3] overflow-hidden bg-surface-muted">
                  {cat.imageUrl ? (
                    <img
                      src={cat.imageUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center text-2xl font-bold text-content-subtle">
                      {cat.name.charAt(0)}
                    </span>
                  )}
                </div>
                <div className="p-2.5 text-center">
                  <p className="truncate text-sm font-medium text-content group-hover:text-primary">
                    {cat.name}
                  </p>
                  {typeof cat.productCount === 'number' && (
                    <p className="text-xs text-content-subtle tabular">{cat.productCount} items</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {featured.length > 0 && (
        <ProductRow
          title="Featured"
          description="Hand-picked by the store"
          products={featured}
          currency={store.currency}
          href="/products?featured=true"
        />
      )}

      {popular.length > 0 && (
        <ProductRow
          title="Best sellers"
          description="What everyone is buying"
          products={popular}
          currency={store.currency}
          href="/products?sortBy=soldCount"
        />
      )}

      {featured.length === 0 && popular.length === 0 && (
        <section className="mx-auto max-w-7xl px-4 py-16 text-center">
          <h2 className="text-lg font-semibold text-content">This store is just getting started</h2>
          <p className="mt-1.5 text-sm text-content-muted">
            Products will appear here as soon as they are added.
          </p>
        </section>
      )}
    </>
  );
}

function Feature({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-content">{title}</p>
        <p className="truncate text-xs text-content-muted">{description}</p>
      </div>
    </div>
  );
}

function ProductRow({
  title,
  description,
  products,
  currency,
  href,
}: {
  title: string;
  description: string;
  products: Awaited<ReturnType<ReturnType<typeof serverApi>['storefront']['featuredProducts']>>;
  currency: string;
  href: string;
}) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-content">{title}</h2>
          <p className="mt-0.5 text-sm text-content-muted">{description}</p>
        </div>
        <Link
          href={href}
          className="shrink-0 text-sm font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} currency={currency} />
        ))}
      </div>
    </section>
  );
}
