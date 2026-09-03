import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Star } from 'lucide-react';
import { formatMoney } from '@retailos/config';
import { ProductCard } from '@/components/product-card';
import { ProductPurchasePanel } from '@/components/product-purchase-panel';
import { loadStorefront, serverApi } from '@/lib/server-api';

interface Props {
  params: { slug: string };
}

/** Per-product SEO metadata — the reason this page is server-rendered. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const product = await serverApi().storefront.productBySlug(params.slug);
    return {
      title: product.metaTitle ?? product.name,
      description:
        product.metaDescription ??
        product.shortDescription ??
        `Buy ${product.name} online.`,
      openGraph: {
        title: product.name,
        description: product.shortDescription ?? undefined,
        images: product.images[0]?.url ? [{ url: product.images[0].url }] : undefined,
        type: 'website',
      },
    };
  } catch {
    return { title: 'Product not found' };
  }
}

export default async function ProductPage({ params }: Props) {
  const data = await loadStorefront();
  if (!data) return null;

  const api = serverApi();

  let product;
  try {
    product = await api.storefront.productBySlug(params.slug);
  } catch {
    // A slug belonging to a *different* tenant lands here too — the API scopes
    // the lookup to this store's database, so it is a genuine 404.
    notFound();
  }

  const [related, reviews] = await Promise.all([
    api.storefront.relatedProducts(product.id, 4).catch(() => []),
    api.storefront.reviews(product.id, 1).catch(() => null),
  ]);

  const currency = data.store.currency;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-content-muted">
        <Link href="/" className="hover:text-primary">
          Home
        </Link>
        <span>/</span>
        <Link href="/products" className="hover:text-primary">
          Products
        </Link>
        {product.category && (
          <>
            <span>/</span>
            <Link href={`/products?category=${product.category.slug}`} className="hover:text-primary">
              {product.category.name}
            </Link>
          </>
        )}
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Gallery + purchase panel are one client island so image selection and
            variant selection can talk to each other. */}
        <ProductPurchasePanel product={product} currency={currency} store={data.store} />
      </div>

      {product.description && (
        <section className="mt-12 max-w-3xl">
          <h2 className="mb-3 text-lg font-bold text-content">Product details</h2>
          <div className="whitespace-pre-line text-sm leading-relaxed text-content-muted">
            {product.description}
          </div>
          {product.tags.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {product.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-content-muted"
                >
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {reviews && reviews.items.length > 0 && (
        <section className="mt-12 max-w-3xl">
          <h2 className="mb-4 text-lg font-bold text-content">
            Reviews{' '}
            <span className="text-sm font-normal text-content-muted tabular">
              ({product.ratingCount})
            </span>
          </h2>
          <ul className="space-y-5">
            {reviews.items.map((review) => (
              <li key={review.id} className="border-b border-line pb-5 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="flex" aria-label={`${review.rating} out of 5`}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={
                          i < review.rating
                            ? 'h-3.5 w-3.5 fill-warning-500 text-warning-500'
                            : 'h-3.5 w-3.5 text-neutral-300 dark:text-neutral-700'
                        }
                        aria-hidden="true"
                      />
                    ))}
                  </span>
                  <span className="text-sm font-medium text-content">{review.customerName}</span>
                  {review.isVerifiedPurchase && (
                    <span className="rounded bg-success-50 px-1.5 py-0.5 text-[10px] font-medium text-success-700 dark:bg-success-700/20 dark:text-success-100">
                      Verified
                    </span>
                  )}
                </div>
                {review.title && (
                  <p className="mt-1.5 text-sm font-medium text-content">{review.title}</p>
                )}
                {review.comment && (
                  <p className="mt-1 text-sm text-content-muted">{review.comment}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-5 text-lg font-bold text-content">You might also like</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} currency={currency} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
