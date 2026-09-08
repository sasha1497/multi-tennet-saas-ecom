'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Heart, Menu, Package, Search, ShoppingBag, User, X } from 'lucide-react';
import { formatMoney } from '@retailos/config';
import type { HeaderVariant } from '@retailos/templates';
import type { ProductListItem } from '@retailos/types';
import { Badge, cn } from '@retailos/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { useTemplate } from '@/templates/context';

/**
 * Storefront header, in five arrangements.
 *
 * Everything shown — the name, the logo, the colours, the categories — comes
 * from the tenant resolved on the server, and the *arrangement* comes from the
 * active template. The behaviour underneath (type-ahead search, the bag count,
 * the mobile drawer) is identical in all five: a template changes how a shop
 * looks, never what it can do.
 */
export function SiteHeader() {
  const { bootstrap, itemCount, customer } = useStore();
  const { layout } = useTemplate();
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

  const variant = layout.header;
  // Editorial and classic put the wordmark on its own line with navigation
  // beneath it; the other three run everything along one utility bar.
  const stacked = variant === 'editorial' || variant === 'classic';

  const brand = (
    <Link href="/" className="flex shrink-0 items-center gap-2.5">
      {store.logoUrl ? (
        <img
          src={store.logoUrl}
          alt=""
          className={cn('object-contain', stacked ? 'h-9 w-9' : 'h-8 w-8', roundedFor(variant))}
        />
      ) : (
        <span
          className={cn(
            'flex items-center justify-center bg-primary font-bold text-primary-fg',
            stacked ? 'h-9 w-9 text-base' : 'h-8 w-8 text-sm',
            roundedFor(variant),
          )}
          aria-hidden="true"
        >
          {store.storeName.charAt(0)}
        </span>
      )}
      <span
        className={cn(
          'heading truncate text-content',
          stacked ? 'text-lg sm:text-xl' : 'hidden text-base sm:block',
        )}
      >
        {store.storeName}
      </span>
    </Link>
  );

  const search = (
    <div ref={searchRef} className={cn('relative', stacked ? 'w-full max-w-xs' : 'ml-auto max-w-md flex-1')}>
      <form onSubmit={submitSearch}>
        <label className="sr-only" htmlFor="site-search">
          Search products
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle"
          aria-hidden="true"
        />
        <input
          id="site-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setSearchOpen(true)}
          placeholder={`Search ${store.storeName}…`}
          className={cn(
            'h-10 w-full border border-line bg-surface-muted pl-9 pr-3 text-sm text-content placeholder:text-content-subtle',
            'focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20',
            variant === 'editorial' ? 'rounded-none' : 'rounded-full',
          )}
        />
      </form>

      {searchOpen && results.length > 0 && (
        <div className="absolute left-0 right-0 top-12 z-10 overflow-hidden rounded-[var(--radius)] border border-line bg-surface shadow-lg">
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
  );

  const actions = (
    <div className="flex shrink-0 items-center gap-0.5">
      <Link
        href="/account/wishlist"
        className="hidden rounded-[var(--radius)] p-2 text-content-muted hover:bg-surface-muted hover:text-content sm:block"
        aria-label="Wishlist"
      >
        <Heart className="h-5 w-5" aria-hidden="true" />
      </Link>
      <Link
        href={customer ? '/account' : '/login'}
        className="rounded-[var(--radius)] p-2 text-content-muted hover:bg-surface-muted hover:text-content"
        aria-label={customer ? 'Your account' : 'Sign in'}
      >
        <User className="h-5 w-5" aria-hidden="true" />
      </Link>
      <Link
        href="/cart"
        className="relative rounded-[var(--radius)] p-2 text-content-muted hover:bg-surface-muted hover:text-content"
        aria-label={`Bag, ${itemCount} item${itemCount === 1 ? '' : 's'}`}
      >
        <ShoppingBag className="h-5 w-5" aria-hidden="true" />
        {itemCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-fg tabular">
            {itemCount > 99 ? '99+' : itemCount}
          </span>
        )}
      </Link>
    </div>
  );

  const navLinks = categories.slice(0, stacked ? 7 : 5).map((cat) => (
    <Link
      key={cat.id}
      href={`/products?category=${cat.slug}`}
      className={cn(
        'transition-colors',
        variant === 'editorial'
          ? 'text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted hover:text-content'
          : variant === 'classic'
            ? 'text-[13px] font-medium text-content-muted hover:text-primary'
            : 'rounded-[var(--radius)] px-3 py-2 text-sm font-medium text-content-muted hover:bg-surface-muted hover:text-content',
      )}
    >
      {cat.name}
    </Link>
  ));

  const menuButton = (
    <button
      type="button"
      onClick={() => setMobileOpen(true)}
      className="rounded-[var(--radius)] p-2 text-content-muted hover:bg-surface-muted lg:hidden"
      aria-label="Open menu"
    >
      <Menu className="h-5 w-5" aria-hidden="true" />
    </button>
  );

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-[1100] border-b border-line backdrop-blur',
          variant === 'playful' ? 'bg-surface/95' : 'bg-surface/95',
        )}
      >
        {stacked ? (
          // ── Two rows: wordmark centred, navigation beneath. ──────────────
          <>
            <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
              {menuButton}
              <div className="flex flex-1 justify-center lg:justify-start">{brand}</div>
              <div className="hidden lg:flex lg:flex-1 lg:justify-center">{search}</div>
              {actions}
            </div>
            <nav
              className="hidden border-t border-line lg:block"
              aria-label="Categories"
            >
              <div className="scroll-slim mx-auto flex max-w-7xl items-center justify-center gap-7 overflow-x-auto px-4 py-3 sm:px-6">
                <Link
                  href="/products"
                  className={cn(
                    variant === 'editorial'
                      ? 'text-[11px] font-semibold uppercase tracking-[0.18em] text-content hover:text-primary'
                      : 'text-[13px] font-medium text-content hover:text-primary',
                  )}
                >
                  All
                </Link>
                {navLinks}
              </div>
            </nav>
            <div className="border-t border-line px-4 py-2.5 lg:hidden">{search}</div>
          </>
        ) : (
          // ── One row: search-forward utility bar. ─────────────────────────
          <>
            <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
              {menuButton}
              {brand}
              <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Categories">
                {navLinks}
              </nav>
              <div className="hidden flex-1 sm:block">{search}</div>
              {actions}
            </div>
            <div className="border-t border-line px-4 py-2.5 sm:hidden">{search}</div>
          </>
        )}
      </header>

      {/* Mobile navigation drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[1200] lg:hidden">
          <div
            className="absolute inset-0 bg-neutral-950/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <nav
            className="animate-slide-in-right absolute inset-y-0 left-0 w-72 overflow-y-auto bg-surface p-4"
            aria-label="Categories"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="heading text-content">{store.storeName}</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-[var(--radius)] p-1.5 text-content-subtle hover:bg-surface-muted"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <ul className="space-y-0.5">
              <li>
                <Link
                  href="/products"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-2.5 rounded-[var(--radius)] px-3 py-2.5 text-sm font-medium text-content hover:bg-surface-muted"
                >
                  <Package className="h-4 w-4" aria-hidden="true" />
                  All products
                </Link>
              </li>
              {categories.map((cat) => (
                <li key={cat.id}>
                  <Link
                    href={`/products?category=${cat.slug}`}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-between rounded-[var(--radius)] px-3 py-2.5 text-sm text-content hover:bg-surface-muted"
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
    </>
  );
}

/** Corner treatment for the logo mark, matching the template's shape language. */
function roundedFor(variant: HeaderVariant): string {
  if (variant === 'editorial') return 'rounded-none';
  if (variant === 'playful' || variant === 'soft') return 'rounded-full';
  return 'rounded-[var(--radius)]';
}
