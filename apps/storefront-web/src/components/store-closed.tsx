import { AlertTriangle, Store } from 'lucide-react';

/**
 * Rendered when a hostname does not resolve to a tenant.
 *
 * Deliberately vague about *why*: confirming "this subdomain exists but is
 * suspended" would let anyone enumerate the platform's merchants and their
 * account status.
 */
export function StoreClosed({ host }: { host: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400 dark:bg-neutral-800">
        <Store className="h-6 w-6" />
      </span>
      <h1 className="text-2xl font-bold tracking-tight text-content">No store here</h1>
      <p className="mt-2 max-w-sm text-sm text-content-muted">
        There is no shop at <span className="font-medium text-content">{host}</span>. Check the web
        address, or ask the shop owner for the right link.
      </p>
      <p className="mt-8 text-xs text-content-subtle">Powered by RetailOS</p>
    </main>
  );
}

/** Shown above the header while a merchant has taken their storefront offline. */
export function MaintenanceBanner() {
  return (
    <div className="bg-warning-500 px-4 py-2 text-center text-sm font-medium text-neutral-900">
      <span className="inline-flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        This store is not published yet — only you can see it.
      </span>
    </div>
  );
}
