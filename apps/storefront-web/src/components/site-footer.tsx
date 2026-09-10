'use client';

import Link from 'next/link';
import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { cn } from '@retailos/ui';
import { useStore } from '@/lib/store-context';
import { useTemplate } from '@/templates/context';

/**
 * Storefront footer, in five arrangements.
 *
 * The contents are the shop's real details — categories, contact, address —
 * and are identical whichever template is active. What the template changes is
 * how much presence the footer has: an editorial design closes on a full-width
 * wordmark, a grocery design closes on four tight columns and gets out of the
 * way.
 */
export function SiteFooter() {
  const { bootstrap } = useStore();
  const { layout } = useTemplate();
  const { store, categories } = bootstrap;

  const address = [store.addressLine1, store.addressLine2, store.city, store.state, store.postalCode]
    .filter(Boolean)
    .join(', ');

  const variant = layout.footer;
  const compact = variant === 'compact';

  const shopLinks = (
    <FooterColumn title="Shop">
      <FooterLink href="/products">All products</FooterLink>
      {categories.slice(0, compact ? 4 : 5).map((cat) => (
        <FooterLink key={cat.id} href={`/products?category=${cat.slug}`}>
          {cat.name}
        </FooterLink>
      ))}
    </FooterColumn>
  );

  const accountLinks = (
    <FooterColumn title="Your account">
      <FooterLink href="/account/orders">Order history</FooterLink>
      <FooterLink href="/account/addresses">Addresses</FooterLink>
      <FooterLink href="/account/wishlist">Wishlist</FooterLink>
      <FooterLink href="/offers">Offers</FooterLink>
    </FooterColumn>
  );

  const contact = (
    <FooterColumn title="Get in touch">
      {store.contactPhone && (
        <li>
          <a href={`tel:${store.contactPhone}`} className="flex items-center gap-2 text-content-muted hover:text-primary">
            <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
            {store.contactPhone}
          </a>
        </li>
      )}
      {store.whatsappNumber && (
        <li>
          <a
            href={`https://wa.me/91${store.whatsappNumber}`}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-2 text-content-muted hover:text-primary"
          >
            <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            WhatsApp
          </a>
        </li>
      )}
      {store.contactEmail && (
        <li>
          <a
            href={`mailto:${store.contactEmail}`}
            className="flex items-center gap-2 break-all text-content-muted hover:text-primary"
          >
            <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
            {store.contactEmail}
          </a>
        </li>
      )}
      {address && (
        <li className="flex items-start gap-2 text-content-muted">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{address}</span>
        </li>
      )}
    </FooterColumn>
  );

  const legal = (
    <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-line pt-6 text-xs text-content-subtle sm:flex-row">
      <p>
        © {new Date().getFullYear()} {store.storeName}. All rights reserved.
      </p>
      {/* The shop's brand is the shop's. The platform's credit is a footnote. */}
      <p>
        Powered by <span className="font-medium text-content-muted">RetailOS</span>
      </p>
    </div>
  );

  // ── Editorial: the shop's name at full width, links beneath. ─────────────
  if (variant === 'editorial') {
    return (
      <footer className="mt-20 bg-content text-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <p className="heading text-4xl leading-none text-white/90 sm:text-6xl lg:text-7xl">
            {store.storeName}
          </p>
          {store.tagline && (
            <p className="mt-4 max-w-md text-sm text-white/60">{store.tagline}</p>
          )}

          <div className="mt-12 grid gap-8 border-t border-white/15 pt-10 text-sm sm:grid-cols-3 [&_a]:text-white/70 [&_a:hover]:text-white [&_h2]:text-white [&_li]:text-white/70">
            {shopLinks}
            {accountLinks}
            {contact}
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/15 pt-6 text-xs text-white/45 sm:flex-row">
            <p>
              © {new Date().getFullYear()} {store.storeName}. All rights reserved.
            </p>
            <p>Powered by RetailOS</p>
          </div>
        </div>
      </footer>
    );
  }

  // ── Statement: an oversized wordmark, a single line of links, and air.
  //    The luxury and premium templates close the way they opened — with
  //    type and nothing else. ────────────────────────────────────────────
  if (variant === 'statement') {
    return (
      <footer className="mt-24 border-t border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
          <p className="heading break-words text-center text-[clamp(2.25rem,11vw,7rem)] font-normal leading-[0.95] text-content">
            {store.storeName}
          </p>
          {store.tagline && (
            <p className="mx-auto mt-6 max-w-md text-center text-sm leading-relaxed text-content-muted">
              {store.tagline}
            </p>
          )}

          {/* One rail rather than columns: three headed lists under a wordmark
              this size would fight it for attention. */}
          <nav
            aria-label="Footer"
            className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-y border-line py-5 text-[11px] uppercase tracking-[0.18em] text-content-muted"
          >
            <Link href="/products" className="transition-colors hover:text-content">
              Shop
            </Link>
            {categories.slice(0, 5).map((cat) => (
              <Link
                key={cat.id}
                href={`/products?category=${cat.slug}`}
                className="transition-colors hover:text-content"
              >
                {cat.name}
              </Link>
            ))}
            <Link href="/account/orders" className="transition-colors hover:text-content">
              Orders
            </Link>
            <Link href="/offers" className="transition-colors hover:text-content">
              Offers
            </Link>
          </nav>

          <div className="mt-10 flex flex-col items-center gap-3 text-xs text-content-subtle sm:flex-row sm:justify-between">
            <p>
              © {new Date().getFullYear()} {store.storeName}
            </p>
            <span className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5">
              {store.contactPhone && (
                <a href={`tel:${store.contactPhone}`} className="hover:text-content">
                  {store.contactPhone}
                </a>
              )}
              {store.contactEmail && (
                <a href={`mailto:${store.contactEmail}`} className="hover:text-content">
                  {store.contactEmail}
                </a>
              )}
              {address && <span className="hidden lg:inline">{address}</span>}
            </span>
            <p>Powered by RetailOS</p>
          </div>
        </div>
      </footer>
    );
  }

  // ── Soft: rounded shoulder, warm ground, centred wordmark. ───────────────
  if (variant === 'soft') {
    return (
      <footer className="mt-16 rounded-t-[2.5rem] bg-primary-soft">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <div className="mb-10 text-center">
            <Wordmark store={store} rounded />
            {store.tagline && (
              <p className="mx-auto mt-3 max-w-sm text-sm text-content-muted">{store.tagline}</p>
            )}
          </div>
          <div className="grid gap-8 text-sm sm:grid-cols-3">
            {shopLinks}
            {accountLinks}
            {contact}
          </div>
          {legal}
        </div>
      </footer>
    );
  }

  // ── Columns and compact: the workhorse four-column footer. ───────────────
  return (
    <footer className={cn('border-t border-line bg-surface-muted', compact ? 'mt-10' : 'mt-16')}>
      <div className={cn('mx-auto max-w-7xl px-4 sm:px-6', compact ? 'py-8' : 'py-12')}>
        <div className={cn('grid gap-8 sm:grid-cols-2 lg:grid-cols-4', compact && 'gap-6')}>
          <div>
            <Wordmark store={store} />
            {store.tagline && <p className="mt-2.5 text-sm text-content-muted">{store.tagline}</p>}
          </div>
          {shopLinks}
          {accountLinks}
          {contact}
        </div>
        {legal}
      </div>
    </footer>
  );
}

function Wordmark({
  store,
  rounded,
}: {
  store: { logoUrl: string | null; storeName: string };
  rounded?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', rounded && 'justify-center')}>
      {store.logoUrl ? (
        <img
          src={store.logoUrl}
          alt=""
          className={cn('h-9 w-9 object-contain', rounded ? 'rounded-full' : 'rounded-[var(--radius)]')}
        />
      ) : (
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center bg-primary text-sm font-bold text-primary-fg',
            rounded ? 'rounded-full' : 'rounded-[var(--radius)]',
          )}
          aria-hidden="true"
        >
          {store.storeName.charAt(0)}
        </span>
      )}
      <span className="heading text-lg text-content">{store.storeName}</span>
    </div>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-content">{title}</h2>
      <ul className="space-y-2.5 text-sm">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-content-muted hover:text-primary">
        {children}
      </Link>
    </li>
  );
}
