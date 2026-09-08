'use client';

import { ArrowRight, Check } from 'lucide-react';
import type { TemplateDefinition } from '@retailos/templates';
import { Button, Modal } from '@retailos/ui';

/**
 * What actually happens when a merchant changes their storefront design.
 *
 * A shop owner with three hundred products and two years of orders is right to
 * hesitate here — "change my whole website" sounds like it could cost them
 * something. So the dialog says plainly what is kept, because everything is:
 * the switch writes three presentation columns and touches no business data.
 *
 * The list is not reassurance copy. It is the actual guarantee, enforced in
 * `StoreService.updateTemplate` and covered by tests in `@retailos/templates`.
 */
const PRESERVED = [
  'Products and variants',
  'Categories and brands',
  'Orders and order history',
  'Customers and their accounts',
  'Payments and transactions',
  'Inventory and stock levels',
  'Coupons and discounts',
  'Your logo, colours and store details',
];

export function SwitchTemplateDialog({
  open,
  from,
  to,
  onCancel,
  onConfirm,
  busy,
}: {
  open: boolean;
  from: TemplateDefinition | null;
  to: TemplateDefinition | null;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  if (!to) return null;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Switch your storefront design?"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} loading={busy}>
            Switch to {to.name}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-muted p-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-content-subtle">
            Currently
          </p>
          <p className="truncate text-sm font-semibold text-content">{from?.name ?? 'No design'}</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-content-subtle" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-content-subtle">
            Switching to
          </p>
          <p className="truncate text-sm font-semibold text-primary">{to.name}</p>
        </div>
      </div>

      <p className="mt-4 text-sm text-content">
        Only your storefront&apos;s visual design changes. Everything in your business stays exactly
        as it is:
      </p>

      <ul className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {PRESERVED.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-content-muted">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>

      <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2.5 text-xs text-content-muted">
        You can switch back at any time, and switching back restores the layout you had — your
        section choices are remembered per design.
      </p>
    </Modal>
  );
}
