'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Banknote, CreditCard, MapPin, Plus, Smartphone } from 'lucide-react';
import { formatMoney, INDIAN_STATES } from '@retailos/config';
import type { Address, PaymentMethod } from '@retailos/types';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Select,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';

/** Stable per-attempt key so a double submit cannot create two orders. */
function newIdempotencyKey(): string {
  return `chk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function CheckoutPage() {
  const { bootstrap, cart, customer, authLoading, refreshCart } = useStore();
  const router = useRouter();
  const toast = useToast();

  const store = bootstrap.store;
  const currency = store.currency;
  const money = (v: number) => formatMoney(v, currency);

  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [addingAddress, setAddingAddress] = useState(false);
  const [newAddress, setNewAddress] = useState({
    fullName: '',
    phone: '',
    line1: '',
    line2: '',
    landmark: '',
    city: '',
    state: 'Karnataka',
    postalCode: '',
  });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    store.codEnabled ? 'COD' : 'UPI',
  );
  const [notes, setNotes] = useState('');
  const [placing, setPlacing] = useState(false);
  // Generated once per page visit, reused across retries of the same attempt.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const { data: addresses, refetch: refetchAddresses } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api().storefront.addresses(),
    enabled: Boolean(customer),
  });

  // Preselect the default address, and open the form when there is none.
  useEffect(() => {
    if (!addresses) return;
    if (addresses.length === 0) {
      setAddingAddress(true);
      return;
    }
    if (!selectedAddressId) {
      setSelectedAddressId((addresses.find((a) => a.isDefault) ?? addresses[0]).id);
    }
  }, [addresses, selectedAddressId]);

  // Signed-out shoppers cannot check out.
  useEffect(() => {
    if (!authLoading && !customer) router.replace('/login?next=/checkout');
  }, [authLoading, customer, router]);

  const blocking = useMemo(
    () => (cart?.issues ?? []).filter((i) => i.code !== 'PRICE_CHANGED'),
    [cart],
  );

  if (authLoading || !cart) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-xl font-semibold text-content">Your bag is empty</h1>
        <p className="mt-1.5 text-sm text-content-muted">Add something before checking out.</p>
        <Link href="/products" className="mt-5 inline-block">
          <Button>Browse products</Button>
        </Link>
      </div>
    );
  }

  const saveAddress = async () => {
    try {
      const created = await api().storefront.createAddress({
        ...newAddress,
        line2: newAddress.line2 || null,
        landmark: newAddress.landmark || null,
        country: 'IN',
        isDefault: (addresses?.length ?? 0) === 0,
        type: 'HOME',
        label: null,
      });
      await refetchAddresses();
      setSelectedAddressId(created.id);
      setAddingAddress(false);
      toast.success('Address saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save this address');
    }
  };

  const placeOrder = async () => {
    if (!selectedAddressId) {
      toast.error('Choose a delivery address');
      return;
    }
    setPlacing(true);
    try {
      const result = await api().storefront.createOrder({
        shippingAddressId: selectedAddressId,
        paymentMethod,
        notes: notes.trim() || null,
        idempotencyKey,
      });

      await refreshCart();

      // COD is confirmed server-side straight away; online payments hand off to
      // the gateway (locally, the mock checkout page) before confirmation.
      if (result.payment?.checkoutUrl) {
        router.push(
          `${result.payment.checkoutUrl}&orderNumber=${encodeURIComponent(result.order.orderNumber)}`,
        );
        return;
      }

      router.push(`/order-confirmed/${result.order.orderNumber}`);
    } catch (err) {
      // A fresh key on failure prevents a stale key from returning a partially
      // created order on the next attempt.
      setIdempotencyKey(newIdempotencyKey());
      toast.error(err instanceof Error ? err.message : 'Could not place your order');
      setPlacing(false);
    }
  };

  const methods: { value: PaymentMethod; label: string; description: string; icon: React.ReactNode }[] =
    [
      ...(store.codEnabled
        ? [
            {
              value: 'COD' as PaymentMethod,
              label: 'Cash on delivery',
              description: 'Pay when your order arrives',
              icon: <Banknote className="h-4.5 w-4.5" />,
            },
          ]
        : []),
      ...(store.onlinePaymentEnabled
        ? [
            {
              value: 'UPI' as PaymentMethod,
              label: 'UPI',
              description: 'Google Pay, PhonePe, Paytm',
              icon: <Smartphone className="h-4.5 w-4.5" />,
            },
            {
              value: 'CARD' as PaymentMethod,
              label: 'Card',
              description: 'Credit or debit card',
              icon: <CreditCard className="h-4.5 w-4.5" />,
            },
          ]
        : []),
    ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-content">Checkout</h1>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Address */}
          <Card>
            <CardHeader
              title="Delivery address"
              action={
                !addingAddress &&
                (addresses?.length ?? 0) > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    leftIcon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => setAddingAddress(true)}
                  >
                    Add new
                  </Button>
                )
              }
            />
            <CardBody className="space-y-3">
              {!addingAddress &&
                addresses?.map((address: Address) => (
                  <label
                    key={address.id}
                    className={cn(
                      'flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors',
                      selectedAddressId === address.id
                        ? 'border-primary bg-primary-soft'
                        : 'border-line hover:border-content-subtle',
                    )}
                  >
                    <input
                      type="radio"
                      name="address"
                      checked={selectedAddressId === address.id}
                      onChange={() => setSelectedAddressId(address.id)}
                      className="mt-1 h-4 w-4 accent-[rgb(var(--color-primary))]"
                    />
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium text-content">{address.fullName}</span>
                      <span className="block text-content-muted">
                        {address.line1}
                        {address.line2 ? `, ${address.line2}` : ''}
                        {address.landmark ? `, ${address.landmark}` : ''}
                        <br />
                        {address.city}, {address.state} {address.postalCode}
                      </span>
                      <span className="mt-0.5 block text-content-muted tabular">
                        {address.phone}
                      </span>
                    </span>
                  </label>
                ))}

              {addingAddress && (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label="Full name"
                      required
                      value={newAddress.fullName}
                      onChange={(e) => setNewAddress({ ...newAddress, fullName: e.target.value })}
                    />
                    <Input
                      label="Mobile number"
                      required
                      value={newAddress.phone}
                      onChange={(e) => setNewAddress({ ...newAddress, phone: e.target.value })}
                      placeholder="9876543210"
                    />
                  </div>
                  <Input
                    label="Flat, house no., building"
                    required
                    value={newAddress.line1}
                    onChange={(e) => setNewAddress({ ...newAddress, line1: e.target.value })}
                  />
                  <Input
                    label="Area, street, sector"
                    value={newAddress.line2}
                    onChange={(e) => setNewAddress({ ...newAddress, line2: e.target.value })}
                  />
                  <Input
                    label="Landmark"
                    value={newAddress.landmark}
                    onChange={(e) => setNewAddress({ ...newAddress, landmark: e.target.value })}
                    hint="Helps the delivery agent find you."
                  />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Input
                      label="City"
                      required
                      value={newAddress.city}
                      onChange={(e) => setNewAddress({ ...newAddress, city: e.target.value })}
                    />
                    <Select
                      label="State"
                      value={newAddress.state}
                      onChange={(e) => setNewAddress({ ...newAddress, state: e.target.value })}
                      options={INDIAN_STATES.map((s) => ({ value: s, label: s }))}
                    />
                    <Input
                      label="PIN code"
                      required
                      value={newAddress.postalCode}
                      onChange={(e) => setNewAddress({ ...newAddress, postalCode: e.target.value })}
                      placeholder="560038"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    {(addresses?.length ?? 0) > 0 && (
                      <Button variant="outline" onClick={() => setAddingAddress(false)}>
                        Cancel
                      </Button>
                    )}
                    <Button onClick={() => void saveAddress()}>Save address</Button>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Payment */}
          <Card>
            <CardHeader title="Payment method" />
            <CardBody className="space-y-2.5">
              {methods.map((method) => (
                <label
                  key={method.value}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                    paymentMethod === method.value
                      ? 'border-primary bg-primary-soft'
                      : 'border-line hover:border-content-subtle',
                  )}
                >
                  <input
                    type="radio"
                    name="payment"
                    checked={paymentMethod === method.value}
                    onChange={() => setPaymentMethod(method.value)}
                    className="h-4 w-4 accent-[rgb(var(--color-primary))]"
                  />
                  <span className="text-content-muted">{method.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-content">{method.label}</span>
                    <span className="block text-xs text-content-muted">{method.description}</span>
                  </span>
                </label>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Order note" description="Optional — anything the store should know." />
            <CardBody>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Please deliver after 6pm"
              />
            </CardBody>
          </Card>
        </div>

        {/* Summary */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-md font-semibold text-content">
                {cart.totals.itemCount} item{cart.totals.itemCount === 1 ? '' : 's'}
              </h2>

              <ul className="max-h-52 space-y-2.5 overflow-y-auto scroll-slim">
                {cart.items.map((item) => (
                  <li key={item.id} className="flex gap-2.5">
                    {item.imageUrl && (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-lg border border-line object-cover"
                        loading="lazy"
                      />
                    )}
                    <span className="min-w-0 flex-1 text-xs">
                      <span className="block truncate text-content">{item.productName}</span>
                      <span className="block text-content-subtle">
                        {item.variantLabel} × {item.quantity}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-xs font-medium text-content">
                      {money(item.lineTotal)}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="space-y-2 border-t border-line pt-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-content-muted">Subtotal</dt>
                  <dd className="tabular text-content">{money(cart.totals.subtotal)}</dd>
                </div>
                {cart.totals.discount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-content-muted">Discount</dt>
                    <dd className="tabular text-success-600">−{money(cart.totals.discount)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-content-muted">Delivery</dt>
                  <dd className="tabular text-content">
                    {cart.totals.shipping === 0 ? 'Free' : money(cart.totals.shipping)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-line pt-3 text-base font-bold text-content">
                  <dt>Total</dt>
                  <dd className="tabular">{money(cart.totals.total)}</dd>
                </div>
              </dl>

              <Button
                size="lg"
                fullWidth
                loading={placing}
                disabled={!selectedAddressId || blocking.length > 0 || addingAddress}
                onClick={() => void placeOrder()}
              >
                {paymentMethod === 'COD'
                  ? `Place order · ${money(cart.totals.total)}`
                  : `Pay ${money(cart.totals.total)}`}
              </Button>

              <p className="flex items-center justify-center gap-1.5 text-center text-xs text-content-subtle">
                <MapPin className="h-3 w-3" />
                Delivered by {store.storeName}
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
