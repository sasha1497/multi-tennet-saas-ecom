'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  CreditCard,
  KeyRound,
  ShieldCheck,
  Undo2,
  Wallet,
} from 'lucide-react';
import { formatMoney } from '@retailos/config';
import type { PaymentSetupStatus, StorePayment } from '@retailos/api-client';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  Select,
  Skeleton,
  cn,
  useToast,
} from '@retailos/ui';
import { PageHead } from '@/components/console/primitives';
import { api } from '@/lib/api';
import { paiseToRupees, rupeesToPaise, useErrorToast } from '@/lib/hooks';

/**
 * How this store's customers pay it.
 *
 * Not the RetailOS subscription — that is what the store pays us, and it lives
 * on the Subscription page. Here the store connects its OWN Razorpay account:
 * customer payments are created on that account and Razorpay settles them to
 * the store's bank. RetailOS never holds the money.
 *
 * Everything shown (connected or not, whether checkout will offer online
 * payment) comes from the API. The page only asks; the server decides.
 */
export default function PaymentsSettingsPage() {
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [refunding, setRefunding] = useState<StorePayment | null>(null);

  const { data: setup, isLoading } = useQuery({
    queryKey: ['payment-setup'],
    queryFn: () => api().merchant.paymentSetup(),
  });
  const { data: payments } = useQuery({
    queryKey: ['store-payments'],
    queryFn: () => api().merchant.storePayments(20),
  });

  const connect = useMutation({
    mutationFn: () => api().merchant.connectRazorpay(),
    // Off to Razorpay's own page; it sends the merchant back to the callback.
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
    onError: (err) => showError(err, 'Could not start connecting Razorpay'),
  });

  const disconnect = useMutation({
    mutationFn: () => api().merchant.disconnectRazorpay(),
    onSuccess: () => {
      toast.success('Razorpay disconnected', 'Online payments are off. Existing orders are unchanged.');
      setConfirmDisconnect(false);
      void queryClient.invalidateQueries({ queryKey: ['payment-setup'] });
    },
    onError: (err) => showError(err, 'Could not disconnect'),
  });

  if (isLoading || !setup) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const oauthConnected = setup.connectionType === 'oauth' && setup.status === 'CONNECTED';

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHead
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Payments' }]}
        title="Payments"
        description="How your customers pay you. Money goes to your own Razorpay account and settles to your bank."
      />

      {/* ── Setup ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Payment setup" />
        <CardBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatusRow label="Status" status={setup.status} />
            <div>
              <p className="eyebrow">Online payments</p>
              <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-content">
                {setup.onlinePaymentsAvailable ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-success-600" aria-hidden="true" /> Enabled
                  </>
                ) : (
                  <>
                    <CircleSlash className="h-4 w-4 text-content-subtle" aria-hidden="true" /> Disabled
                  </>
                )}
              </p>
              {!setup.onlinePaymentsSwitchedOn && (
                <p className="mt-1 text-xs text-content-muted">
                  Switched off in{' '}
                  <Link href="/store/settings" className="font-medium text-primary hover:underline">
                    Store settings
                  </Link>
                  .
                </p>
              )}
            </div>
          </div>

          {setup.accountId && (
            <p className="text-sm text-content-muted">
              Razorpay account <span className="font-mono text-content">{setup.accountId}</span>
              {setup.environment === 'test' && <Badge tone="warning" className="ml-2">Test mode</Badge>}
            </p>
          )}

          {setup.reason && (
            <p className="flex items-start gap-2 rounded-lg border border-warning-500/40 bg-warning-50 px-3 py-2.5 text-sm text-warning-700 dark:bg-warning-700/15 dark:text-warning-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {setup.reason}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            {oauthConnected ? (
              <Button variant="outline" onClick={() => setConfirmDisconnect(true)}>
                Disconnect Razorpay
              </Button>
            ) : setup.oauthAvailable ? (
              <Button onClick={() => connect.mutate()} loading={connect.isPending} leftIcon={<Wallet className="h-4 w-4" />}>
                {setup.status === 'NOT_CONNECTED' ? 'Connect Razorpay' : 'Complete setup'}
              </Button>
            ) : (
              <p className="text-sm text-content-muted">
                Connecting with one click is not available on this deployment yet. You can enter your own
                Razorpay API keys below.
              </p>
            )}
            {!oauthConnected && setup.oauthAvailable && (
              <p className="text-xs text-content-subtle">
                You approve RetailOS on Razorpay&apos;s own page. No passwords or API secrets are shared.
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      <p className="flex items-start gap-2 rounded-lg border border-line bg-surface-muted px-4 py-3 text-xs text-content-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" aria-hidden="true" />
        Customer payments are created on your Razorpay account and settled to your bank by Razorpay.
        RetailOS takes no share. Your RetailOS plan is billed separately, on the Subscription page.
      </p>

      {/* ── Manual keys (fallback) ────────────────────────────────────── */}
      {!oauthConnected && <ManualKeys />}

      {/* ── Recent payments ───────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Recent payments" description="Online payments from your customers." />
        {!payments || payments.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<CreditCard className="h-5 w-5" />}
              title="No online payments yet"
              description="Payments appear here as customers pay at checkout."
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-content-subtle">
                  <th className="px-5 py-2.5 font-medium">Order</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Payment ID</th>
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const refundable = p.amount - p.refundedAmount;
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0">
                      <td className="px-5 py-3">
                        <Link href={`/orders/${p.orderId}`} className="font-medium text-content hover:text-primary">
                          {p.orderNumber}
                        </Link>
                        <p className="text-xs text-content-subtle">{p.customerName}</p>
                      </td>
                      <td className="px-5 py-3 text-right tabular text-content">
                        {formatMoney(p.amount, p.currency)}
                        {p.refundedAmount > 0 && (
                          <p className="text-xs text-content-subtle">−{formatMoney(p.refundedAmount, p.currency)} refunded</p>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <PaymentBadge status={p.status} />
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-content-muted">{p.providerPaymentId ?? '—'}</td>
                      <td className="px-5 py-3 tabular text-content-muted">
                        {new Date(p.paidAt ?? p.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {(p.status === 'PAID' || p.status === 'PARTIALLY_REFUNDED') && refundable > 0 && (
                          <Button size="sm" variant="ghost" leftIcon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setRefunding(p)}>
                            Refund
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() => {
          disconnect.mutate();
        }}
        loading={disconnect.isPending}
        title="Disconnect Razorpay?"
        message="Customers will no longer be able to pay online until you connect again. Orders and payments already taken are not affected, and refunds for them still work from your Razorpay dashboard."
        confirmLabel="Disconnect"
        destructive
      />

      <RefundModal payment={refunding} onClose={() => setRefunding(null)} />
    </div>
  );
}

function StatusRow({ label, status }: { label: string; status: PaymentSetupStatus['status'] }) {
  const map = {
    CONNECTED: { text: 'Connected', tone: 'success' as const },
    NOT_CONNECTED: { text: 'Not connected', tone: 'neutral' as const },
    ACTION_REQUIRED: { text: 'Action required', tone: 'warning' as const },
    REVOKED: { text: 'Access removed', tone: 'danger' as const },
  }[status];
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="mt-1.5">
        <Badge tone={map.tone} dot>
          {map.text}
        </Badge>
      </p>
    </div>
  );
}

function PaymentBadge({ status }: { status: string }) {
  const tone =
    status === 'PAID'
      ? 'success'
      : status === 'FAILED'
        ? 'danger'
        : status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED'
          ? 'info'
          : 'neutral';
  const text = status === 'PARTIALLY_REFUNDED' ? 'Part refunded' : status.charAt(0) + status.slice(1).toLowerCase();
  return (
    <Badge tone={tone} dot>
      {text}
    </Badge>
  );
}

/**
 * The original "paste your own keys" flow, kept as a fallback for stores that
 * already use it. Secrets are write-only: they are never shown again.
 */
function ManualKeys() {
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: gateways } = useQuery({
    queryKey: ['payment-gateways'],
    queryFn: () => api().merchant.paymentGateways(),
  });
  const existing = gateways?.find((g) => g.provider === 'razorpay');
  const [form, setForm] = useState({ keyId: '', secret: '', webhookSecret: '', environment: 'test' as 'test' | 'live' });

  const save = useMutation({
    mutationFn: () =>
      api().merchant.savePaymentGateway({
        provider: 'razorpay',
        enabled: true,
        environment: form.environment,
        publicKey: form.keyId.trim() || existing?.publicKey || null,
        ...(form.secret ? { secretKey: form.secret } : {}),
        ...(form.webhookSecret ? { webhookSecret: form.webhookSecret } : {}),
      }),
    onSuccess: () => {
      toast.success('Razorpay keys saved');
      setForm((f) => ({ ...f, secret: '', webhookSecret: '' }));
      void queryClient.invalidateQueries({ queryKey: ['payment-setup'] });
      void queryClient.invalidateQueries({ queryKey: ['payment-gateways'] });
    },
    onError: (err) => showError(err, 'Could not save the keys'),
  });

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <KeyRound className="h-4 w-4 text-content-subtle" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-content">Use your own API keys instead</span>
          <span className="block text-xs text-content-muted">
            {existing?.configured ? 'Keys saved — your account is in use.' : 'For stores that already manage their Razorpay keys.'}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-content-subtle transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <CardBody className="space-y-4 border-t border-line">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Key ID"
              value={form.keyId}
              placeholder={existing?.publicKey ?? 'rzp_test_…'}
              onChange={(e) => setForm({ ...form, keyId: e.target.value })}
            />
            <Select
              label="Mode"
              value={form.environment}
              onChange={(e) => setForm({ ...form, environment: e.target.value as 'test' | 'live' })}
              options={[
                { value: 'test', label: 'Test' },
                { value: 'live', label: 'Live' },
              ]}
            />
            <Input
              label="Key secret"
              type="password"
              autoComplete="off"
              value={form.secret}
              placeholder={existing?.configured ? 'Saved — leave blank to keep' : ''}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
            />
            <Input
              label="Webhook secret"
              type="password"
              autoComplete="off"
              value={form.webhookSecret}
              placeholder={existing?.configured ? 'Leave blank to keep' : ''}
              onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
            />
          </div>
          <p className="text-xs text-content-muted">
            Secrets are encrypted and never shown again. Point your Razorpay webhook at{' '}
            <span className="font-mono">/api/v1/webhooks/payments/razorpay</span>.
          </p>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save keys
          </Button>
        </CardBody>
      )}
    </Card>
  );
}

function RefundModal({ payment, onClose }: { payment: StorePayment | null; onClose: () => void }) {
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const refundable = payment ? payment.amount - payment.refundedAmount : 0;

  const refund = useMutation({
    mutationFn: () =>
      api().merchant.refundOrder(payment!.orderId, {
        reason: reason.trim(),
        ...(amount.trim() ? { amount: rupeesToPaise(amount) } : {}),
      }),
    onSuccess: (result) => {
      toast.success(
        result.status === 'PROCESSED' ? 'Refund sent' : 'Refund started',
        'The money is returned from your Razorpay account to the customer.',
      );
      setAmount('');
      setReason('');
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['store-payments'] });
    },
    onError: (err) => showError(err, 'Could not refund'),
  });

  return (
    <Modal
      open={payment !== null}
      onClose={onClose}
      title={payment ? `Refund ${payment.orderNumber}` : 'Refund'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={refund.isPending}>
            Cancel
          </Button>
          <Button onClick={() => refund.mutate()} loading={refund.isPending} disabled={reason.trim().length < 2}>
            Refund {amount.trim() ? `₹${amount}` : payment ? formatMoney(refundable, payment.currency) : ''}
          </Button>
        </>
      }
    >
      {payment && (
        <div className="space-y-4">
          <Input
            label="Amount (₹)"
            type="number"
            min="1"
            step="0.01"
            value={amount}
            placeholder={paiseToRupees(refundable)}
            hint={`Leave blank to refund everything still refundable (${formatMoney(refundable, payment.currency)}).`}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong size" />
        </div>
      )}
    </Modal>
  );
}
