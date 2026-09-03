'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Plus, Trash2 } from 'lucide-react';
import { formatDate, formatMoney } from '@retailos/config';
import { Permission, type Coupon } from '@retailos/types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
  useToast,
  type Column,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { rupeesToPaise, useErrorToast } from '@/lib/hooks';

export default function CouponsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Coupon | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['coupons'],
    queryFn: () => api().merchant.coupons({ limit: 50 }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api().merchant.deleteCoupon(id),
    onSuccess: () => {
      toast.success('Coupon removed');
      void queryClient.invalidateQueries({ queryKey: ['coupons'] });
      setDeleting(null);
    },
    onError: (err) => showError(err, 'Could not remove this coupon'),
  });

  const columns: Column<Coupon>[] = [
    {
      key: 'code',
      header: 'Code',
      cell: (row) => (
        <div>
          <p className="font-mono font-semibold text-content">{row.code}</p>
          {row.description && <p className="text-xs text-content-subtle">{row.description}</p>}
        </div>
      ),
    },
    {
      key: 'discount',
      header: 'Discount',
      cell: (row) => (
        <span className="text-content">
          {row.discountType === 'PERCENTAGE'
            ? `${row.discountValue}%`
            : formatMoney(row.discountValue)}
          {row.maxDiscountAmount ? (
            <span className="block text-xs text-content-subtle">
              max {formatMoney(row.maxDiscountAmount)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'minOrder',
      header: 'Min order',
      align: 'right',
      hideBelowMd: true,
      cell: (row) => (
        <span className="tabular text-content-muted">
          {row.minOrderAmount > 0 ? formatMoney(row.minOrderAmount) : '—'}
        </span>
      ),
    },
    {
      key: 'usage',
      header: 'Used',
      align: 'right',
      cell: (row) => (
        <span className="tabular text-content-muted">
          {row.usageCount}
          {row.usageLimit ? ` / ${row.usageLimit}` : ''}
        </span>
      ),
    },
    {
      key: 'window',
      header: 'Valid until',
      hideBelowMd: true,
      cell: (row) => (
        <span className="text-content-muted">{row.endsAt ? formatDate(row.endsAt) : 'No expiry'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => {
        const expired = row.endsAt ? new Date(row.endsAt) < new Date() : false;
        const exhausted = row.usageLimit !== null && row.usageCount >= row.usageLimit;
        return (
          <Badge
            tone={!row.isActive ? 'neutral' : expired || exhausted ? 'warning' : 'success'}
            dot
          >
            {!row.isActive ? 'Off' : expired ? 'Expired' : exhausted ? 'Used up' : 'Active'}
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) =>
        can(Permission.COUPONS_MANAGE) ? (
          <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => setDeleting(row)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Coupons"
        description="Discount codes shoppers can apply at checkout."
        actions={
          can(Permission.COUPONS_MANAGE) && (
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New coupon
            </Button>
          )
        }
      />

      <Card>
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<BadgePercent className="h-5 w-5" />}
              title="No coupons yet"
              description="Create a code to run a promotion or win back customers."
              action={
                can(Permission.COUPONS_MANAGE) && (
                  <Button onClick={() => setCreating(true)}>New coupon</Button>
                )
              }
            />
          }
        />
      </Card>

      <CouponModal open={creating} onClose={() => setCreating(false)} />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
        title="Remove this coupon?"
        message={
          <>
            <strong>{deleting?.code}</strong> will stop working immediately. Orders that already used
            it are unaffected.
          </>
        }
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
      />
    </div>
  );
}

function CouponModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    code: '',
    description: '',
    discountType: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED',
    discountValue: '',
    maxDiscountAmount: '',
    minOrderAmount: '',
    usageLimit: '',
    perCustomerLimit: '',
    endsAt: '',
  });

  const save = useMutation({
    mutationFn: () =>
      api().merchant.createCoupon({
        code: form.code.trim().toUpperCase(),
        description: form.description.trim() || null,
        discountType: form.discountType,
        // Percentage is a whole number; a fixed amount is entered in rupees.
        discountValue:
          form.discountType === 'PERCENTAGE'
            ? Number(form.discountValue)
            : rupeesToPaise(form.discountValue),
        maxDiscountAmount: form.maxDiscountAmount ? rupeesToPaise(form.maxDiscountAmount) : null,
        minOrderAmount: form.minOrderAmount ? rupeesToPaise(form.minOrderAmount) : 0,
        usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
        perCustomerLimit: form.perCustomerLimit ? Number(form.perCustomerLimit) : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        isActive: true,
      }),
    onSuccess: () => {
      toast.success('Coupon created');
      void queryClient.invalidateQueries({ queryKey: ['coupons'] });
      onClose();
      setForm({
        code: '',
        description: '',
        discountType: 'PERCENTAGE',
        discountValue: '',
        maxDiscountAmount: '',
        minOrderAmount: '',
        usageLimit: '',
        perCustomerLimit: '',
        endsAt: '',
      });
    },
    onError: (err) => showError(err, 'Could not create this coupon'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New coupon"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!form.code.trim() || !form.discountValue}
          >
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Code"
          required
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          placeholder="WELCOME10"
          hint="Shoppers type this at checkout."
          className="font-mono uppercase"
        />
        <Textarea
          label="Description"
          rows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="10% off your first order"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Type"
            value={form.discountType}
            onChange={(e) =>
              setForm({ ...form, discountType: e.target.value as 'PERCENTAGE' | 'FIXED' })
            }
            options={[
              { value: 'PERCENTAGE', label: 'Percentage off' },
              { value: 'FIXED', label: 'Fixed amount off' },
            ]}
          />
          <Input
            label={form.discountType === 'PERCENTAGE' ? 'Percent off' : 'Amount off (₹)'}
            type="number"
            min="1"
            required
            value={form.discountValue}
            onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
          />
        </div>
        {form.discountType === 'PERCENTAGE' && (
          <Input
            label="Maximum discount (₹)"
            type="number"
            value={form.maxDiscountAmount}
            onChange={(e) => setForm({ ...form, maxDiscountAmount: e.target.value })}
            hint="Caps a percentage discount on large orders. Leave blank for no cap."
          />
        )}
        <Input
          label="Minimum order value (₹)"
          type="number"
          value={form.minOrderAmount}
          onChange={(e) => setForm({ ...form, minOrderAmount: e.target.value })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Total uses"
            type="number"
            value={form.usageLimit}
            onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
            hint="Blank = unlimited"
          />
          <Input
            label="Uses per customer"
            type="number"
            value={form.perCustomerLimit}
            onChange={(e) => setForm({ ...form, perCustomerLimit: e.target.value })}
            hint="Blank = unlimited"
          />
        </div>
        <Input
          label="Expires on"
          type="date"
          value={form.endsAt}
          onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
        />
      </div>
    </Modal>
  );
}
