'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MapPin, Phone, User } from 'lucide-react';
import { formatDate, formatMoney, ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from '@retailos/config';
import { ORDER_STATUS_TRANSITIONS, Permission, type OrderStatus } from '@retailos/types';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  ErrorState,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
  useToast,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useErrorToast } from '@/lib/hooks';

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [notes, setNotes] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['order', params.id],
    queryFn: () => api().merchant.order(params.id),
    enabled: Boolean(params.id),
  });

  const changeStatus = useMutation({
    mutationFn: (status: OrderStatus) =>
      api().merchant.updateOrderStatus(params.id, { status }),
    onSuccess: (_, status) => {
      toast.success(`Order marked ${ORDER_STATUS_LABELS[status].toLowerCase()}`);
      void queryClient.invalidateQueries({ queryKey: ['order', params.id] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => showError(err, 'Could not update the order'),
  });

  const cancel = useMutation({
    mutationFn: () =>
      api().merchant.updateOrderStatus(params.id, {
        status: 'CANCELLED',
        reason: cancelReason,
      }),
    onSuccess: () => {
      toast.success('Order cancelled', 'Stock has been returned to inventory.');
      setCancelOpen(false);
      setCancelReason('');
      void queryClient.invalidateQueries({ queryKey: ['order', params.id] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => showError(err, 'Could not cancel this order'),
  });

  const saveNotes = useMutation({
    mutationFn: () => api().merchant.updateOrderNotes(params.id, notes),
    onSuccess: () => toast.success('Note saved'),
    onError: (err) => showError(err, 'Could not save the note'),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        title="Could not load this order"
        message={(error as Error)?.message}
        onRetry={() => void refetch()}
      />
    );
  }

  const money = (v: number) => formatMoney(v, data.currency);

  // Only transitions the state machine actually permits are offered, so the UI
  // can never present an action the API will reject.
  const nextStatuses = (ORDER_STATUS_TRANSITIONS[data.status] ?? []).filter(
    (s) => s !== 'CANCELLED' && s !== 'REFUNDED',
  );
  const canCancel = (ORDER_STATUS_TRANSITIONS[data.status] ?? []).includes('CANCELLED');

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={data.orderNumber}
        description={`Placed ${formatDate(data.placedAt, true)}`}
        breadcrumbs={[{ label: 'Orders', href: '/orders' }, { label: data.orderNumber }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ORDER_STATUS_TONES[data.status]} dot size="md">
              {ORDER_STATUS_LABELS[data.status]}
            </Badge>
            {can(Permission.ORDERS_UPDATE) &&
              nextStatuses.map((status) => (
                <Button
                  key={status}
                  size="sm"
                  onClick={() => changeStatus.mutate(status)}
                  loading={changeStatus.isPending}
                >
                  Mark {ORDER_STATUS_LABELS[status].toLowerCase()}
                </Button>
              ))}
            {can(Permission.ORDERS_CANCEL) && canCancel && (
              <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>
                Cancel
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Items" />
            <CardBody className="space-y-4">
              {data.items.map((item) => (
                <div key={item.id} className="flex gap-3">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover"
                    />
                  ) : (
                    <span className="h-14 w-14 shrink-0 rounded-lg bg-surface-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-content">{item.productName}</p>
                    <p className="text-xs text-content-subtle">
                      {item.variantLabel} · {item.sku}
                    </p>
                    <p className="mt-0.5 text-xs text-content-muted tabular">
                      {money(item.unitPrice)} × {item.quantity}
                    </p>
                  </div>
                  <span className="tabular shrink-0 text-sm font-semibold text-content">
                    {money(item.lineTotal)}
                  </span>
                </div>
              ))}

              <div className="space-y-1.5 border-t border-line pt-4 text-sm">
                <Row label="Subtotal" value={money(data.subtotal)} />
                {data.discountAmount > 0 && (
                  <Row
                    label={`Discount${data.couponCode ? ` (${data.couponCode})` : ''}`}
                    value={`−${money(data.discountAmount)}`}
                    tone="success"
                  />
                )}
                {!data.taxInclusive && data.taxAmount > 0 && (
                  <Row label="Tax" value={money(data.taxAmount)} />
                )}
                <Row
                  label="Delivery"
                  value={data.shippingAmount === 0 ? 'Free' : money(data.shippingAmount)}
                />
                <div className="flex items-center justify-between border-t border-line pt-2 text-base font-semibold text-content">
                  <span>Total</span>
                  <span className="tabular">{money(data.totalAmount)}</span>
                </div>
                {data.taxInclusive && data.taxAmount > 0 && (
                  <p className="pt-0.5 text-right text-xs text-content-subtle tabular">
                    Includes {money(data.taxAmount)} tax
                  </p>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Timeline" />
            <CardBody>
              <ol className="space-y-4">
                {data.statusHistory.map((entry, i) => (
                  <li key={entry.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-primary">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      {i < data.statusHistory.length - 1 && (
                        <span className="mt-1 w-px flex-1 bg-line" />
                      )}
                    </div>
                    <div className="pb-1">
                      <p className="text-sm font-medium text-content">
                        {ORDER_STATUS_LABELS[entry.toStatus]}
                      </p>
                      <p className="text-xs text-content-subtle">
                        {formatDate(entry.createdAt, true)} ·{' '}
                        {entry.changedByType === 'CUSTOMER'
                          ? 'by the customer'
                          : entry.changedByType === 'STAFF'
                            ? 'by your team'
                            : 'automatically'}
                      </p>
                      {entry.note && (
                        <p className="mt-0.5 text-xs text-content-muted">{entry.note}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          {can(Permission.ORDERS_UPDATE) && (
            <Card>
              <CardHeader
                title="Internal note"
                description="Only your team can see this — never shown to the customer."
              />
              <CardBody className="space-y-3">
                <Textarea
                  rows={3}
                  value={notes ?? data.internalNotes ?? ''}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Customer asked for delivery after 6pm…"
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => saveNotes.mutate()} loading={saveNotes.isPending}>
                    Save note
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Customer" />
            <CardBody className="space-y-2.5 text-sm">
              <p className="flex items-center gap-2 text-content">
                <User className="h-4 w-4 shrink-0 text-content-subtle" />
                {data.customerName}
              </p>
              {data.customerPhone && (
                <a
                  href={`tel:${data.customerPhone}`}
                  className="flex items-center gap-2 text-content hover:text-primary"
                >
                  <Phone className="h-4 w-4 shrink-0 text-content-subtle" />
                  {data.customerPhone}
                </a>
              )}
              {data.customerEmail && (
                <p className="truncate text-content-muted">{data.customerEmail}</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Delivery address" />
            <CardBody>
              <address className="flex gap-2 text-sm not-italic text-content-muted">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-content-subtle" />
                <span>
                  <span className="block font-medium text-content">
                    {data.shippingAddress.fullName}
                  </span>
                  {data.shippingAddress.line1}
                  {data.shippingAddress.line2 && <>, {data.shippingAddress.line2}</>}
                  {data.shippingAddress.landmark && <>, {data.shippingAddress.landmark}</>}
                  <br />
                  {data.shippingAddress.city}, {data.shippingAddress.state}{' '}
                  {data.shippingAddress.postalCode}
                  <br />
                  <span className="text-content">{data.shippingAddress.phone}</span>
                </span>
              </address>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payment" />
            <CardBody className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-content-muted">Method</span>
                <span className="font-medium text-content">{data.paymentMethod}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-content-muted">Status</span>
                <Badge
                  tone={
                    data.paymentStatus === 'PAID'
                      ? 'success'
                      : data.paymentStatus === 'FAILED'
                        ? 'danger'
                        : 'warning'
                  }
                  dot
                >
                  {data.paymentStatus.toLowerCase()}
                </Badge>
              </div>
              {data.payment?.providerPaymentId && (
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-content-muted">Reference</span>
                  <span className="truncate font-mono text-xs text-content-subtle">
                    {data.payment.providerPaymentId}
                  </span>
                </div>
              )}
              {data.payment?.paidAt && (
                <div className="flex items-center justify-between">
                  <span className="text-content-muted">Paid</span>
                  <span className="text-content">{formatDate(data.payment.paidAt, true)}</span>
                </div>
              )}
            </CardBody>
          </Card>

          {data.notes && (
            <Card>
              <CardHeader title="Customer note" />
              <CardBody>
                <p className="text-sm text-content-muted">{data.notes}</p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancel.mutate()}
        title="Cancel this order?"
        destructive
        confirmLabel="Cancel order"
        cancelLabel="Keep it"
        loading={cancel.isPending}
        message={
          <div className="space-y-3">
            <p>
              Reserved stock returns to inventory and any coupon use is reversed. The customer is
              notified automatically.
            </p>
            <Input
              label="Reason"
              required
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Out of stock / customer request"
            />
          </div>
        }
      />
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success';
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-content-muted">{label}</span>
      <span className={tone === 'success' ? 'tabular text-success-600' : 'tabular text-content'}>
        {value}
      </span>
    </div>
  );
}
