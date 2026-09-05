'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Heart, Menu, Package, Search, ShoppingBag, User, X } from 'lucide-react';
import { formatMoney } from '@retailos/config';
import type { ProductListItem } from '@retailos/types';
import { Badge } from '@retailos/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';

/**
 * Storefront header: brand, category navigation, search and the bag.
 *
 * Everything shown here — the name, the logo, the colours, the categories —
 * comes from the tenant resolved on the server, so the same component renders a
 * different shop on every subdomain.
 */
export function SiteHeader() {
  const { bootstrap, itemCount, customer } = useStore();
  const { store, categories } = bootstrap;
  const router = useRouter();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductListItem[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Type-ahead search, debounced so typing does not hammer the API.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setResults(await api().storefront.search(query.trim(), 6));
        setSearchOpen(true);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchOpen(false);
    router.push(`/products?search=${encodeURIComponent(query.trim())}`);
  };

  return (
    <header className="sticky top-0 z-[1100] border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="rounded-lg p-2 text-content-muted hover:bg-surface-muted lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          {store.logoUrl ? (
            <img src={store.logoUrl} alt="" className="h-8 w-8 rounded-lg object-contain" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-fg">
              {store.storeName.charAt(0)}
            </span>
          )}
          <span className="hidden text-base font-bold tracking-tight text-content sm:block">
            {store.storeName}
          </span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Categories">
          {categories.slice(0, 5).map((cat) => (
            <Link
              key={cat.id}
              href={`/products?category=${cat.slug}`}
              className="rounded-lg px-3 py-2 text-sm font-medium text-content-muted transition-colors hover:bg-surface-muted hover:text-content"
            >
              {cat.name}
            </Link>
          ))}
        </nav>

        <div ref={searchRef} className="relative ml-auto max-w-md flex-1">
          <form onSubmit={submitSearch}>
            <label className="sr-only" htmlFor="site-search">
              Search products
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle" />
            <input
              id="site-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => results.length > 0 && setSearchOpen(true)}
              placeholder={`Search ${store.storeName}…`}
              className="h-10 w-full rounded-full border border-line bg-surface-muted pl-9 pr-3 text-sm text-content placeholder:text-content-subtle focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </form>

          {searchOpen && results.length > 0 && (
            <div className="absolute left-0 right-0 top-12 z-10 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
              {results.map((product) => (
                <Link
                  key={product.id}
                  href={`/products/${product.slug}`}
                  onClick={() => setSearchOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-muted"
                >
                  {product.primaryImageUrl && (
                    <img
                      src={product.primaryImageUrl}
                      alt=""
                      className="h-10 w-10 rounded-lg object-cover"
                      loading="lazy"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-content">{product.name}</span>
                    <span className="block text-xs text-content-muted tabular">
                      {formatMoney(product.priceFrom, store.currency)}
                    </span>
                  </span>
                </Link>
              ))}
              <button
                type="button"
                onClick={submitSearch}
                className="block w-full border-t border-line px-3 py-2.5 text-left text-sm font-medium text-primary hover:bg-surface-muted"
              >
                See all results for “{query}”
              </button>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Link
            href="/account/wishlist"
            className="hidden rounded-lg p-2 text-content-muted hover:bg-surface-muted hover:text-content sm:block"
            aria-label="Wishlist"
          >
            <Heart className="h-5 w-5" />
          </Link>
          <Link
            href={customer ? '/account' : '/login'}
            className="rounded-lg p-2 text-content-muted hover:bg-surface-muted hover:text-content"
            aria-label={customer ? 'Your account' : 'Sign in'}
          >
            <User className="h-5 w-5" />
          </Link>
          <Link
            href="/cart"
            className="relative rounded-lg p-2 text-content-muted hover:bg-surface-muted hover:text-content"
            aria-label={`Bag, ${itemCount} item${itemCount === 1 ? '' : 's'}`}
          >
            <ShoppingBag className="h-5 w-5" />
            {itemCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-fg tabular">
                {itemCount > 99 ? '99+' : itemCount}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[1200] lg:hidden">
          <div
            className="absolute inset-0 bg-neutral-950/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <nav
            className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-surface p-4 animate-slide-in-right"
            aria-label="Categories"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold text-content">{store.storeName}</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-1.5 text-content-subtle hover:bg-surface-muted"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="space-y-0.5">
              <li>
                <Link
                  href="/products"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-content hover:bg-surface-muted"
                >
                  <Package className="h-4 w-4" />
                  All products
                </Link>
              </li>
              {categories.map((cat) => (
                <li key={cat.id}>
                  <Link
                    href={`/products?category=${cat.slug}`}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-content hover:bg-surface-muted"
                  >
                    {cat.name}
                    {typeof cat.productCount === 'number' && cat.productCount > 0 && (
                      <Badge tone="neutral">{cat.productCount}</Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </header>
  );
}
