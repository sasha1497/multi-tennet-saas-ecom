'use client';

import Link from 'next/link';
import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { useStore } from '@/lib/store-context';

export function SiteFooter() {
  const { bootstrap } = useStore();
  const { store, categories } = bootstrap;

  const address = [store.addressLine1, store.addressLine2, store.city, store.state, store.postalCode]
    .filter(Boolean)
    .join(', ');

  return (
    <footer className="mt-16 border-t border-line bg-surface-muted">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              {store.logoUrl ? (
                <img src={store.logoUrl} alt="" className="h-8 w-8 rounded-lg object-contain" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-fg">
                  {store.storeName.charAt(0)}
                </span>
              )}
              <span className="font-bold text-content">{store.storeName}</span>
            </div>
            {store.tagline && (
              <p className="mt-2.5 text-sm text-content-muted">{store.tagline}</p>
            )}
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-content">Shop</h2>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/products" className="text-content-muted hover:text-primary">
                  All products
                </Link>
              </li>
              {categories.slice(0, 5).map((cat) => (
                <li key={cat.id}>
                  <Link
                    href={`/products?category=${cat.slug}`}
                    className="text-content-muted hover:text-primary"
                  >
                    {cat.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-content">Your account</h2>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/account/orders" className="text-content-muted hover:text-primary">
                  Order history
                </Link>
              </li>
              <li>
                <Link href="/account/addresses" className="text-content-muted hover:text-primary">
                  Addresses
                </Link>
              </li>
              <li>
                <Link href="/account/wishlist" className="text-content-muted hover:text-primary">
                  Wishlist
                </Link>
              </li>
              <li>
                <Link href="/offers" className="text-content-muted hover:text-primary">
                  Offers
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-content">Get in touch</h2>
            <ul className="space-y-2.5 text-sm text-content-muted">
              {store.contactPhone && (
                <li>
                  <a href={`tel:${store.contactPhone}`} className="flex items-center gap-2 hover:text-primary">
                    <Phone className="h-4 w-4 shrink-0" />
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
                    className="flex items-center gap-2 hover:text-primary"
                  >
                    <MessageCircle className="h-4 w-4 shrink-0" />
                    WhatsApp
                  </a>
                </li>
              )}
              {store.contactEmail && (
                <li>
                  <a
                    href={`mailto:${store.contactEmail}`}
                    className="flex items-center gap-2 break-all hover:text-primary"
                  >
                    <Mail className="h-4 w-4 shrink-0" />
                    {store.contactEmail}
                  </a>
                </li>
              )}
              {address && (
                <li className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{address}</span>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-line pt-6 text-xs text-content-subtle sm:flex-row">
          <p>
            © {new Date().getFullYear()} {store.storeName}. All rights reserved.
          </p>
          <p>
            Powered by <span className="font-medium text-content-muted">RetailOS</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
