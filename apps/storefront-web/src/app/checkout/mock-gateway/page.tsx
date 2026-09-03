'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CreditCard, Lock, ShieldAlert } from 'lucide-react';
import { Button, Card, CardBody, Spinner, useToast } from '@retailos/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';

/**
 * Local-development stand-in for a hosted payment page.
 *
 * It does **not** fake success. Choosing "Pay" calls the mock provider's
 * simulate endpoint, which produces a genuine HMAC signature and feeds it
 * through the same `/payments/verify` path a real gateway callback would use —
 * so the signature verification, the order confirmation and the stock commit
 * are all the production code paths, exercised end to end without credentials.
 */
function MockGateway() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { bootstrap, refreshCart } = useStore();

  const paymentId = params.get('paymentId') ?? '';
  const orderNumber = params.get('orderNumber') ?? '';
  const [processing, setProcessing] = useState<'success' | 'failure' | null>(null);

  const simulate = async (outcome: 'success' | 'failure') => {
    if (!paymentId) return;
    setProcessing(outcome);
    try {
      const result = await api().storefront.simulatePayment(paymentId, outcome);
      await refreshCart();
      if (result.status === 'PAID') {
        router.replace(`/order-confirmed/${result.orderNumber}`);
      } else {
        toast.error('Payment failed', 'Your items have been returned to stock.');
        router.replace('/cart');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Payment could not be processed');
      setProcessing(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <div className="mb-5 flex items-center gap-2 rounded-full bg-warning-50 px-3 py-1.5 text-xs font-medium text-warning-700 dark:bg-warning-700/20 dark:text-warning-100">
        <ShieldAlert className="h-3.5 w-3.5" />
        Development payment simulator
      </div>

      <Card className="w-full">
        <CardBody className="space-y-5">
          <div className="text-center">
            <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <CreditCard className="h-5 w-5" />
            </span>
            <h1 className="text-lg font-bold text-content">
              Pay {bootstrap.store.storeName}
            </h1>
            {orderNumber && (
              <p className="mt-1 text-sm text-content-muted">Order {orderNumber}</p>
            )}
          </div>

          <p className="rounded-lg bg-surface-muted p-3 text-xs leading-relaxed text-content-muted">
            No real gateway is configured, so this page stands in for one. Either choice runs the
            real verification path — a valid signature is generated for success, and a failure
            releases the stock your order was holding.
          </p>

          <div className="space-y-2.5">
            <Button
              size="lg"
              fullWidth
              loading={processing === 'success'}
              disabled={processing !== null}
              onClick={() => void simulate('success')}
              leftIcon={<Lock className="h-4 w-4" />}
            >
              Pay now
            </Button>
            <Button
              size="lg"
              variant="outline"
              fullWidth
              loading={processing === 'failure'}
              disabled={processing !== null}
              onClick={() => void simulate('failure')}
            >
              Simulate a failed payment
            </Button>
          </div>

          <p className="text-center text-xs text-content-subtle">
            Payment reference <code className="font-mono">{paymentId.slice(0, 8)}…</code>
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

export default function MockGatewayPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      }
    >
      <MockGateway />
    </Suspense>
  );
}
