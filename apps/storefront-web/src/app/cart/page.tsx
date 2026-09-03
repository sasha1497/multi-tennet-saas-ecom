'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, Minus, Plus, ShoppingBag, Tag, Trash2, X } from 'lucide-react';
import { formatMoney } from '@retailos/config';
import { Badge, Button, Card, CardBody, EmptyState, Input, Spinner } from '@retailos/ui';
import { useStore } from '@/lib/store-context';

export default function CartPage() {
  const {
    bootstrap,
    cart,
    cartLoading,
    updateCartItem,
    removeCartItem,
    applyCoupon,
    removeCoupon,
    customer,
  } = useStore();
  const router = useRouter();

  const [couponCode, setCouponCode] = useState('');
  const [applyingCoupon, setApplyingCoupon] = useState(false);

  const currency = bootstrap.store.currency;
  const money = (v: number) => formatMoney(v, currency);

  if (!cart) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState
          icon={<ShoppingBag className="h-6 w-6" />}
          title="Your bag is empty"
          description="Browse the store and add something you like."
          action={
            <Link href="/products">
              <Button size="lg">Start shopping</Button>
            </Link>
          }
        />
      </div>
    );
  }

  // Issues that must be resolved before checkout can succeed.
  const blocking = cart.issues.filter((i) => i.code !== 'PRICE_CHANGED');

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-content">
        Your bag{' '}
        <span className="text-base font-normal text-content-muted tabular">
          ({cart.totals.itemCount} item{cart.totals.itemCount === 1 ? '' : 's'})
        </span>
      </h1>

      {cart.issues.length > 0 && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-warning-200 bg-warning-50 p-4 dark:border-warning-700/40 dark:bg-warning-700/15"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-warning-700 dark:text-warning-100">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Please review your bag
          </p>
          <ul className="mt-1.5 space-y-0.5 pl-6 text-sm text-warning-700 dark:text-warning-100">
            {cart.issues.map((issue, i) => (
              <li key={i} className="list-disc">
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {cart.items.map((item) => {
            const itemIssue = cart.issues.find((i) => i.itemId === item.id);
            return (
              <Card key={item.id}>
                <CardBody className="flex gap-4">
                  <Link
                    href={`/products/${item.productSlug}`}
                    className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-muted"
                  >
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : null}
                  </Link>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/products/${item.productSlug}`}
                          className="block truncate font-medium text-content hover:text-primary"
                        >
                          {item.productName}
                        </Link>
                        <p className="text-xs text-content-subtle">{item.variantLabel}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeCartItem(item.id)}
                        className="shrink-0 rounded-lg p-1.5 text-content-subtle hover:bg-surface-muted hover:text-danger-600"
                        aria-label={`Remove ${item.productName}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {itemIssue && (
                      <Badge
                        tone={itemIssue.code === 'PRICE_CHANGED' ? 'info' : 'danger'}
                        dot
                        className="mt-1.5"
                      >
                        {itemIssue.code === 'PRICE_CHANGED' ? 'Price updated' : itemIssue.message}
                      </Badge>
                    )}

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center rounded-lg border border-line">
                        <button
                          type="button"
                          onClick={() => void updateCartItem(item.id, item.quantity - 1)}
                          disabled={cartLoading}
                          className="p-2 text-content-muted hover:text-content disabled:opacity-40"
                          aria-label="Decrease quantity"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-9 text-center text-sm font-medium text-content tabular">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => void updateCartItem(item.id, item.quantity + 1)}
                          disabled={cartLoading || item.quantity >= item.availableStock}
                          className="p-2 text-content-muted hover:text-content disabled:opacity-40"
                          aria-label="Increase quantity"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="text-right">
                        <p className="font-semibold text-content tabular">{money(item.lineTotal)}</p>
                        {item.mrp > item.unitPrice && (
                          <p className="text-xs text-content-subtle line-through tabular">
                            {money(item.mrp * item.quantity)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>

        {/* Summary */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-md font-semibold text-content">Order summary</h2>

              {/* Coupon */}
              {cart.coupon ? (
                <div className="flex items-center justify-between rounded-lg bg-success-50 px-3 py-2 dark:bg-success-700/15">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-success-700 dark:text-success-100">
                    <Tag className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate font-medium">{cart.coupon.code}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeCoupon()}
                    className="shrink-0 rounded p-1 text-success-700 hover:bg-success-100 dark:text-success-100"
                    aria-label="Remove coupon"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <form
                  className="flex gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!couponCode.trim()) return;
                    setApplyingCoupon(true);
                    try {
                      await applyCoupon(couponCode.trim());
                      setCouponCode('');
                    } catch {
                      /* toast raised by the store context */
                    } finally {
                      setApplyingCoupon(false);
                    }
                  }}
                >
                  <Input
                    containerClassName="flex-1"
                    placeholder="Coupon code"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    className="uppercase"
                    aria-label="Coupon code"
                  />
                  <Button type="submit" variant="outline" loading={applyingCoupon}>
                    Apply
                  </Button>
                </form>
              )}

              <dl className="space-y-2 border-t border-line pt-4 text-sm">
                <Row label="Subtotal" value={money(cart.totals.subtotal)} />
                {cart.totals.discount > 0 && (
                  <Row label="Discount" value={`−${money(cart.totals.discount)}`} tone="success" />
                )}
                {!bootstrap.store.taxInclusivePricing && cart.totals.tax > 0 && (
                  <Row label="Tax" value={money(cart.totals.tax)} />
                )}
                <Row
                  label="Delivery"
                  value={cart.totals.shipping === 0 ? 'Free' : money(cart.totals.shipping)}
                  tone={cart.totals.shipping === 0 ? 'success' : undefined}
                />
                <div className="flex items-center justify-between border-t border-line pt-3 text-base font-bold text-content">
                  <dt>Total</dt>
                  <dd className="tabular">{money(cart.totals.total)}</dd>
                </div>
                {bootstrap.store.taxInclusivePricing && cart.totals.tax > 0 && (
                  <p className="text-right text-xs text-content-subtle tabular">
                    Includes {money(cart.totals.tax)} tax
                  </p>
                )}
              </dl>

              {bootstrap.store.freeShippingThreshold > 0 &&
                cart.totals.shipping > 0 &&
                cart.totals.subtotal < bootstrap.store.freeShippingThreshold && (
                  <p className="rounded-lg bg-primary-soft px-3 py-2 text-xs text-primary">
                    Add {money(bootstrap.store.freeShippingThreshold - cart.totals.subtotal)} more
                    for free delivery.
                  </p>
                )}

              <Button
                size="lg"
                fullWidth
                rightIcon={<ArrowRight className="h-4 w-4" />}
                disabled={blocking.length > 0}
                onClick={() => router.push(customer ? '/checkout' : '/login?next=/checkout')}
              >
                {customer ? 'Checkout' : 'Sign in to checkout'}
              </Button>

              {blocking.length > 0 && (
                <p className="text-center text-xs text-danger-600">
                  Resolve the issues above to continue.
                </p>
              )}

              <Link
                href="/products"
                className="block text-center text-sm text-content-muted hover:text-primary"
              >
                Continue shopping
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
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
      <dt className="text-content-muted">{label}</dt>
      <dd className={tone === 'success' ? 'tabular text-success-600' : 'tabular text-content'}>
        {value}
      </dd>
    </div>
  );
}
