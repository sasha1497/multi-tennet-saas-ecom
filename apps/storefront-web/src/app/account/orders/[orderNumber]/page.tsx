'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Circle, MapPin } from 'lucide-react';
import { formatDate, formatMoney, ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from '@retailos/config';
import { CUSTOMER_CANCELLABLE_STATUSES, type OrderStatus } from '@retailos/types';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  ErrorState,
  Input,
  SkeletonRows,
  cn,
  useToast,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';

export default function OrderTrackingPage() {
  const params = useParams<{ orderNumber: string }>();
  const { bootstrap } = useStore();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const { data: orders, isLoading, isError, refetch } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api().storefront.orders({ limit: 50 }),
  });

  const summary = orders?.items.find((o) => o.orderNumber === params.orderNumber);

  const { data: order } = useQuery({
    queryKey: ['order', summary?.id],
    queryFn: () => api().storefront.order(summary!.id),
    enabled: Boolean(summary),
  });

  const { data: tracking } = useQuery({
    queryKey: ['tracking', params.orderNumber],
    queryFn: () => api().storefront.tracking(params.orderNumber),
  });

  const cancel = useMutation({
    mutationFn: () => api().storefront.cancelOrder(summary!.id, reason),
    onSuccess: () => {
      toast.success('Order cancelled');
      setCancelling(false);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['tracking'] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not cancel this order'),
  });

  if (isLoading) return <SkeletonRows rows={4} />;

  if (isError || !summary) {
    return (
      <ErrorState
        title="Order not found"
        message="We could not find that order on your account."
        onRetry={() => void refetch()}
      />
    );
  }

  const currency = bootstrap.store.currency;
  const money = (v: number) => formatMoney(v, currency);
  const canCancel = CUSTOMER_CANCELLABLE_STATUSES.includes(summary.status as OrderStatus);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/account/orders" className="text-xs text-content-muted hover:text-primary">
            ← All orders
          </Link>
          <h2 className="mt-1 font-mono text-xl font-bold text-content">{summary.orderNumber}</h2>
          <p className="mt-0.5 text-sm text-content-muted">
            Placed {formatDate(summary.placedAt, true)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={ORDER_STATUS_TONES[summary.status]} dot size="md">
            {ORDER_STATUS_LABELS[summary.status]}
          </Badge>
          {canCancel && (
            <Button size="sm" variant="outline" onClick={() => setCancelling(true)}>
              Cancel order
            </Button>
          )}
        </div>
      </div>

      {/* Delivery timeline */}
      {tracking && (
        <Card>
          <CardHeader
            title="Delivery status"
            description={
              tracking.estimatedDeliveryAt && summary.status !== 'DELIVERED'
                ? `Estimated delivery by ${formatDate(tracking.estimatedDeliveryAt)}`
                : undefined
            }
          />
          <CardBody>
            <ol className="space-y-0">
              {tracking.timeline.map((step, i) => (
                <li key={step.status} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                        step.done
                          ? 'bg-primary text-primary-fg'
                          : 'border-2 border-line bg-surface text-content-subtle',
                      )}
                    >
                      {step.done ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-2 w-2 fill-current" />}
                    </span>
                    {i < tracking.timeline.length - 1 && (
                      <span
                        className={cn('w-0.5 flex-1', step.done ? 'bg-primary' : 'bg-line')}
                        style={{ minHeight: '28px' }}
                      />
                    )}
                  </div>
                  <div className="pb-6 last:pb-0">
                    <p
                      className={cn(
                        'text-sm font-medium',
                        step.done ? 'text-content' : 'text-content-subtle',
                      )}
                    >
                      {step.label}
                    </p>
                    {step.at && (
                      <p className="text-xs text-content-muted">{formatDate(step.at, true)}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}

      {order && (
        <>
          <Card>
            <CardHeader title="Items" />
            <CardBody className="space-y-4">
              {order.items.map((item) => (
                <div key={item.id} className="flex gap-3">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="h-14 w-14 shrink-0 rounded-lg bg-surface-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/products/${item.productSlug}`}
                      className="block truncate text-sm font-medium text-content hover:text-primary"
                    >
                      {item.productName}
                    </Link>
                    <p className="text-xs text-content-subtle">{item.variantLabel}</p>
                    <p className="mt-0.5 text-xs text-content-muted tabular">
                      {money(item.unitPrice)} × {item.quantity}
                    </p>
                  </div>
                  <span className="tabular shrink-0 text-sm font-semibold text-content">
                    {money(item.lineTotal)}
                  </span>
                </div>
              ))}

              <dl className="space-y-1.5 border-t border-line pt-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-content-muted">Subtotal</dt>
                  <dd className="tabular text-content">{money(order.subtotal)}</dd>
                </div>
                {order.discountAmount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-content-muted">
                      Discount{order.couponCode ? ` (${order.couponCode})` : ''}
                    </dt>
                    <dd className="tabular text-success-600">−{money(order.discountAmount)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-content-muted">Delivery</dt>
                  <dd className="tabular text-content">
                    {order.shippingAmount === 0 ? 'Free' : money(order.shippingAmount)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-line pt-2 text-base font-bold text-content">
                  <dt>Total</dt>
                  <dd className="tabular">{money(order.totalAmount)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Delivery address" />
            <CardBody>
              <address className="flex gap-2 text-sm not-italic text-content-muted">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-content-subtle" />
                <span>
                  <span className="block font-medium text-content">
                    {order.shippingAddress.fullName}
                  </span>
                  {order.shippingAddress.line1}
                  {order.shippingAddress.line2 && <>, {order.shippingAddress.line2}</>}
                  <br />
                  {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
                  {order.shippingAddress.postalCode}
                  <br />
                  <span className="tabular">{order.shippingAddress.phone}</span>
                </span>
              </address>
            </CardBody>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        onConfirm={() => cancel.mutate()}
        title="Cancel this order?"
        destructive
        confirmLabel="Cancel order"
        cancelLabel="Keep it"
        loading={cancel.isPending}
        message={
          <div className="space-y-3">
            <p>
              This cannot be undone. If you already paid, the amount is refunded to your original
              payment method.
            </p>
            <Input
              label="Why are you cancelling?"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ordered by mistake"
            />
          </div>
        }
      />
    </div>
  );
}
