'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Package, Truck } from 'lucide-react';
import { formatDate, formatMoney } from '@retailos/config';
import { Button, Card, CardBody, Spinner } from '@retailos/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';

export default function OrderConfirmedPage() {
  const params = useParams<{ orderNumber: string }>();
  const { bootstrap } = useStore();

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders', 'recent'],
    queryFn: () => api().storefront.orders({ limit: 5 }),
  });

  const order = orders?.items.find((o) => o.orderNumber === params.orderNumber);
  const currency = bootstrap.store.currency;

  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-success-50 text-success-600 dark:bg-success-700/20">
        <CheckCircle2 className="h-8 w-8" />
      </span>

      <h1 className="text-2xl font-bold tracking-tight text-content">Order confirmed</h1>
      <p className="mt-2 text-sm text-content-muted">
        Thank you! {bootstrap.store.storeName} is preparing your order.
      </p>

      <Card className="mt-7 text-left">
        <CardBody className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Spinner className="h-5 w-5 text-primary" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-content-muted">Order number</span>
                <span className="font-mono font-semibold text-content">{params.orderNumber}</span>
              </div>
              {order && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-content-muted">Total</span>
                    <span className="font-semibold text-content tabular">
                      {formatMoney(order.totalAmount, currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-content-muted">Payment</span>
                    <span className="text-sm text-content">
                      {order.paymentMethod === 'COD' ? 'Cash on delivery' : order.paymentMethod}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-content-muted">Placed</span>
                    <span className="text-sm text-content">{formatDate(order.placedAt, true)}</span>
                  </div>
                </>
              )}

              <div className="flex items-start gap-2.5 rounded-lg bg-surface-muted p-3 text-left">
                <Truck className="mt-0.5 h-4 w-4 shrink-0 text-content-subtle" />
                <p className="text-xs text-content-muted">
                  You will get an update by email as soon as your order is packed and on its way.
                </p>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
        <Link href={`/account/orders/${params.orderNumber}`}>
          <Button size="lg" leftIcon={<Package className="h-4 w-4" />} fullWidth>
            Track this order
          </Button>
        </Link>
        <Link href="/products">
          <Button size="lg" variant="outline" fullWidth>
            Continue shopping
          </Button>
        </Link>
      </div>
    </div>
  );
}
