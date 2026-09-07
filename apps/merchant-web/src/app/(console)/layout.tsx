'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Spinner } from '@retailos/ui';
import { ConsoleShell } from '@/components/shell';
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
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return <ConsoleShell>{children}</ConsoleShell>;
}
