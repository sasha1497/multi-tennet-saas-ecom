'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Filter, PackageSearch, SlidersHorizontal, X } from 'lucide-react';
import { formatMoney } from '@retailos/config';
import { Button, Drawer, EmptyState, Pagination, Select, cn } from '@retailos/ui';
import { ProductCard, ProductCardSkeleton } from '@/components/product-card';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';

const SORTS = [
  { value: 'soldCount:desc', label: 'Most popular' },
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'priceFrom:asc', label: 'Price: low to high' },
  { value: 'priceFrom:desc', label: 'Price: high to low' },
  { value: 'ratingAverage:desc', label: 'Top rated' },
];

function ProductsView() {
  const { bootstrap } = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const category = params.get('category') ?? '';
  const brandId = params.get('brand') ?? '';
  const search = params.get('search') ?? '';
  const sort = params.get('sort') ?? 'soldCount:desc';
  const inStockOnly = params.get('inStock') === 'true';
  const page = Number(params.get('page')) || 1;
  const [sortBy, sortOrder] = sort.split(':') as [string, 'asc' | 'desc'];

  const setParam = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in patch)) next.delete('page');
    router.push(`/products?${next.toString()}`, { scroll: false });
  };

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: () => api().storefront.brands(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['products', category, brandId, search, sort, inStockOnly, page],
    queryFn: () =>
      api().storefront.products({
        page,
        limit: 24,
        categorySlug: category || undefined,
        brandId: brandId || undefined,
        search: search || undefined,
        sortBy,
        sortOrder,
        inStock: inStockOnly || undefined,
      }),
  });

  const activeCategory = bootstrap.categories.find((c) => c.slug === category);
  const activeFilters = [category, brandId, inStockOnly ? 'stock' : ''].filter(Boolean).length;

  const filterPanel = (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2.5 text-sm font-semibold text-content">Category</h3>
        <ul className="space-y-1">
          <li>
            <button
              type="button"
              onClick={() => setParam({ category: undefined })}
              className={cn(
                'w-full rounded-lg px-2.5 py-1.5 text-left text-sm',
                !category ? 'bg-primary-soft font-medium text-primary' : 'text-content-muted hover:bg-surface-muted',
              )}
            >
              All categories
            </button>
          </li>
          {bootstrap.categories.map((cat) => (
            <li key={cat.id}>
              <button
                type="button"
                onClick={() => setParam({ category: cat.slug })}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm',
                  category === cat.slug
                    ? 'bg-primary-soft font-medium text-primary'
                    : 'text-content-muted hover:bg-surface-muted',
                )}
              >
                <span className="truncate">{cat.name}</span>
                {typeof cat.productCount === 'number' && (
                  <span className="tabular text-xs text-content-subtle">{cat.productCount}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {brands && brands.length > 0 && (
        <div>
          <h3 className="mb-2.5 text-sm font-semibold text-content">Brand</h3>
          <ul className="space-y-1">
            <li>
              <button
                type="button"
                onClick={() => setParam({ brand: undefined })}
                className={cn(
                  'w-full rounded-lg px-2.5 py-1.5 text-left text-sm',
                  !brandId ? 'bg-primary-soft font-medium text-primary' : 'text-content-muted hover:bg-surface-muted',
                )}
              >
                All brands
              </button>
            </li>
            {brands.map((brand) => (
              <li key={brand.id}>
                <button
                  type="button"
                  onClick={() => setParam({ brand: brand.id })}
                  className={cn(
                    'w-full rounded-lg px-2.5 py-1.5 text-left text-sm',
                    brandId === brand.id
                      ? 'bg-primary-soft font-medium text-primary'
                      : 'text-content-muted hover:bg-surface-muted',
                  )}
                >
                  {brand.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2.5 text-sm font-semibold text-content">Availability</h3>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(e) => setParam({ inStock: e.target.checked ? 'true' : undefined })}
            className="h-4 w-4 rounded border-line accent-[rgb(var(--color-primary))]"
          />
          <span className="text-sm text-content">In stock only</span>
        </label>
      </div>

      {activeFilters > 0 && (
        <Button
          variant="outline"
          fullWidth
          size="sm"
          onClick={() => router.push('/products')}
          leftIcon={<X className="h-3.5 w-3.5" />}
        >
          Clear filters
        </Button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-content">
          {search
            ? `Results for “${search}”`
            : (activeCategory?.name ?? 'All products')}
        </h1>
        {data && (
          <p className="mt-1 text-sm text-content-muted tabular">
            {data.pagination.total} {data.pagination.total === 1 ? 'product' : 'products'}
          </p>
        )}
      </div>

      <div className="flex gap-8">
        <aside className="hidden w-56 shrink-0 lg:block">{filterPanel}</aside>

        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />}
              onClick={() => setFiltersOpen(true)}
              className="lg:hidden"
            >
              Filters{activeFilters > 0 ? ` (${activeFilters})` : ''}
            </Button>

            <Select
              className="ml-auto w-auto min-w-[170px]"
              value={sort}
              onChange={(e) => setParam({ sort: e.target.value })}
              options={SORTS}
              aria-label="Sort products"
            />
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : (data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon={<PackageSearch className="h-5 w-5" />}
              title="Nothing matches those filters"
              description={
                search
                  ? `We could not find anything for “${search}”. Try a different word.`
                  : 'Try widening your filters.'
              }
              action={
                <Button variant="outline" onClick={() => router.push('/products')}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {data!.items.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    currency={bootstrap.store.currency}
                  />
                ))}
              </div>

              <Pagination
                page={data!.pagination.page}
                totalPages={data!.pagination.totalPages}
                total={data!.pagination.total}
                limit={data!.pagination.limit}
                onPageChange={(p) => {
                  setParam({ page: String(p) });
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="mt-6 rounded-xl border border-line"
              />
            </>
          )}
        </div>
      </div>

      <Drawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        side="left"
        width="max-w-xs"
      >
        {filterPanel}
      </Drawer>
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-3 px-4 py-8 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      }
    >
      <ProductsView />
    </Suspense>
  );
}
