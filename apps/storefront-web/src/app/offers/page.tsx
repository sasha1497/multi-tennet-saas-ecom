'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BadgePercent, Copy } from 'lucide-react';
import { formatDate, formatMoney } from '@retailos/config';
import { Button, Card, CardBody, EmptyState, SkeletonRows, useToast } from '@retailos/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';

export default function OffersPage() {
  const { bootstrap } = useStore();
  const toast = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['offers'],
    queryFn: () => api().storefront.availableCoupons(),
  });

  const currency = bootstrap.store.currency;

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`${code} copied`, 'Paste it in your bag at checkout.');
    } catch {
      toast.info(`Use code ${code} at checkout`);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-content">Offers</h1>
      <p className="mt-1.5 text-sm text-content-muted">
        Coupons you can use at {bootstrap.store.storeName}.
      </p>

      <div className="mt-6">
        {isLoading ? (
          <SkeletonRows rows={3} />
        ) : !data || data.length === 0 ? (
          <Card>
            <EmptyState
              icon={<BadgePercent className="h-5 w-5" />}
              title="No offers right now"
              description="Check back soon — this store runs promotions from time to time."
              action={
                <Link href="/products">
                  <Button>Browse products</Button>
                </Link>
              }
            />
          </Card>
        ) : (
          <ul className="space-y-3">
            {data.map((coupon) => (
              <li key={coupon.id}>
                <Card>
                  <CardBody className="flex flex-wrap items-center gap-4">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brandAccent/10 text-brandAccent">
                      <BadgePercent className="h-5 w-5" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="text-md font-semibold text-content">
                        {coupon.discountType === 'PERCENTAGE'
                          ? `${coupon.discountValue}% off`
                          : `${formatMoney(coupon.discountValue, currency)} off`}
                        {coupon.maxDiscountAmount
                          ? ` (up to ${formatMoney(coupon.maxDiscountAmount, currency)})`
                          : ''}
                      </p>
                      {coupon.description && (
                        <p className="text-sm text-content-muted">{coupon.description}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-content-subtle">
                        {coupon.minOrderAmount > 0 && (
                          <span>
                            Min order {formatMoney(coupon.minOrderAmount, currency, { hideDecimals: true })}
                          </span>
                        )}
                        {coupon.endsAt && <span>· Valid until {formatDate(coupon.endsAt)}</span>}
                        {coupon.perCustomerLimit === 1 && <span>· One use per customer</span>}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <code className="rounded-lg border border-dashed border-line bg-surface-muted px-3 py-1.5 font-mono text-sm font-semibold text-content">
                        {coupon.code}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        leftIcon={<Copy className="h-3.5 w-3.5" />}
                        onClick={() => void copy(coupon.code)}
                      >
                        Copy
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
