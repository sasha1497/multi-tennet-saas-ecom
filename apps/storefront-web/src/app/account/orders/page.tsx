'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Package } from 'lucide-react';
import { formatDate, formatMoney, ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from '@retailos/config';
import { Badge, Button, Card, CardBody, EmptyState, SkeletonRows } from '@retailos/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';

export default function OrdersPage() {
  const { bootstrap } = useStore();

  const { data, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api().storefront.orders({ limit: 25 }),
  });

  if (isLoading) return <SkeletonRows rows={4} />;

  if (!data || data.items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Package className="h-5 w-5" />}
          title="No orders yet"
          description="When you buy something, it will show up here."
          action={
            <Link href="/products">
              <Button>Start shopping</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {data.items.map((order) => (
        <Link key={order.id} href={`/account/orders/${order.orderNumber}`} className="block">
          <Card className="transition-shadow hover:shadow-md">
            <CardBody className="flex items-center gap-4">
              {order.thumbnailUrl ? (
                <img
                  src={order.thumbnailUrl}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-content-subtle">
                  <Package className="h-5 w-5" />
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-content">
                    {order.orderNumber}
                  </span>
                  <Badge tone={ORDER_STATUS_TONES[order.status]} dot>
                    {ORDER_STATUS_LABELS[order.status]}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-content-muted">
                  {formatDate(order.placedAt)} · {order.itemCount} item
                  {order.itemCount === 1 ? '' : 's'}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="font-semibold text-content tabular">
                  {formatMoney(order.totalAmount, bootstrap.store.currency)}
                </p>
              </div>

              <ChevronRight className="h-4 w-4 shrink-0 text-content-subtle" />
            </CardBody>
          </Card>
        </Link>
      ))}
    </div>
  );
}
