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

  useEffect(() => {
    if (!loading && !session) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, session, router, pathname]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return <ConsoleShell>{children}</ConsoleShell>;
}
