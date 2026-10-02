'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner, useToast } from '@retailos/ui';
import { ButtonLink } from '@/components/console/primitives';
import { api } from '@/lib/api';

/**
 * Where Razorpay sends the merchant back after they approve RetailOS.
 *
 * Hands `code` and `state` to the API, which checks the state belongs to this
 * store and this user before exchanging the code. Nothing is decided here.
 */
export default function RazorpayCallbackPage() {
  return (
    <Suspense fallback={<Waiting />}>
      <Callback />
    </Suspense>
  );
}

function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const code = params.get('code');
    const state = params.get('state');
    if (params.get('error') || !code || !state) {
      setError('Razorpay was not connected. You can try again from Payments.');
      return;
    }

    api()
      .merchant.completeRazorpay(code, state)
      .then(() => {
        toast.success('Razorpay connected', 'Customers can now pay online. Money settles to your Razorpay account.');
        router.replace('/settings/payments');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Razorpay could not be connected.'));
  }, [params, router, toast]);

  if (!error) return <Waiting />;
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-lg font-semibold text-content">Not connected</h1>
      <p className="mt-2 text-sm text-content-muted">{error}</p>
      <ButtonLink href="/settings/payments" className="mt-6">
        Back to Payments
      </ButtonLink>
    </div>
  );
}

function Waiting() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-sm text-content-muted">
      <Spinner />
      Connecting your Razorpay account…
    </div>
  );
}
