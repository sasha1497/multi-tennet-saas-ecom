'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Spinner } from '@retailos/ui';
import { ConsoleShell } from '@/components/shell';
import { Logo } from '@/components/console/logo';
import { useAuth } from '@/lib/auth-context';

/**
 * Authenticated shell.
 *
 * This is a convenience redirect, not the security boundary — the API rejects
 * every unauthenticated request regardless of what the browser renders. Its job
 * is to avoid flashing an empty console at a signed-out visitor.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  /**
   * A platform super admin belongs to no store, so every merchant route has no
   * tenant to act on and the API correctly answers "No store selected" — which
   * arrives as a broken dashboard rather than an explanation. The platform
   * surface is their actual home, so send them there instead.
   *
   * Deliberately keyed on having no store at all, not on being a super admin: a
   * merchant whose last membership was revoked lands in the same state, and
   * showing them the platform page (which they cannot read) is better than a
   * dashboard that can only ever error.
   */
  const hasNoStore = Boolean(session) && !session?.activeTenantId && session?.memberships.length === 0;
  const onPlatform = pathname.startsWith('/platform');

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (hasNoStore && !onPlatform) {
      router.replace('/platform');
    }
  }, [loading, session, hasNoStore, onPlatform, router, pathname]);

  if (loading || !session || (hasNoStore && !onPlatform)) {
    return <ConsoleBoot />;
  }

  return (
    <>
      {/* First tab stop on every console page: the rail is long, and keyboard
          users should not have to walk it to reach the screen they opened. */}
      <a
        href="#main"
        className="sr-only z-[1700] rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <ConsoleShell>{children}</ConsoleShell>
    </>
  );
}

/**
 * The gap between "page loaded" and "we know who you are".
 *
 * Branded rather than a bare spinner: this is the first frame of the product on
 * every cold load, and a lone grey circle on white is the cheapest-looking
 * moment an app can have.
 */
function ConsoleBoot() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-muted">
      <Logo className="h-11 w-11 animate-fade-in" title="RetailOS" />
      <span className="flex items-center gap-2 text-sm text-content-muted">
        <Spinner className="h-3.5 w-3.5" />
        Loading your console
      </span>
    </div>
  );
}
