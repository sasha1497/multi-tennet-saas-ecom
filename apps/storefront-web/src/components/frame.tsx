'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@retailos/ui';
import type { StorefrontBootstrap } from '@retailos/types';
import { StoreProvider } from '@/lib/store-context';
import { SiteHeader } from './site-header';
import { SiteFooter } from './site-footer';
import { MaintenanceBanner } from './store-closed';

/**
 * Client shell for the storefront.
 *
 * Kept separate from `layout.tsx` so the layout can stay a server component and
 * resolve the tenant from the Host header before anything renders.
 */
export function StorefrontFrame({
  bootstrap,
  children,
}: {
  bootstrap: StorefrontBootstrap;
  children: ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Catalog data is public and changes slowly; a minute of staleness
            // keeps navigation instant without showing an old price at checkout
            // (which the server re-validates anyway).
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <StoreProvider bootstrap={bootstrap}>
          <div className="flex min-h-screen flex-col">
            {!bootstrap.store.isPublished && <MaintenanceBanner />}
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
        </StoreProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
