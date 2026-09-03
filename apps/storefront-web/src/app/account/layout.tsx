'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Heart, LogOut, MapPin, Package, User } from 'lucide-react';
import { Spinner, cn } from '@retailos/ui';
import { useStore } from '@/lib/store-context';

const NAV = [
  { href: '/account', label: 'Profile', icon: User, exact: true },
  { href: '/account/orders', label: 'Orders', icon: Package },
  { href: '/account/addresses', label: 'Addresses', icon: MapPin },
  { href: '/account/wishlist', label: 'Wishlist', icon: Heart },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { customer, authLoading, logout } = useStore();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !customer) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [authLoading, customer, router, pathname]);

  if (authLoading || !customer) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-content">
          Hello, {customer.firstName}
        </h1>
        <p className="mt-1 text-sm text-content-muted">{customer.email ?? customer.phone}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Account" className="lg:sticky lg:top-24 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto scroll-slim lg:flex-col lg:overflow-visible">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:w-full',
                      active
                        ? 'bg-primary-soft text-primary'
                        : 'text-content-muted hover:bg-surface-muted hover:text-content',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <li className="shrink-0">
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-content-muted transition-colors hover:bg-surface-muted hover:text-danger-600"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                Sign out
              </button>
            </li>
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
