'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Trash2 } from 'lucide-react';
import { INDIAN_STATES } from '@retailos/config';
import type { Address } from '@retailos/types';
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  Select,
  SkeletonRows,
  useToast,
} from '@retailos/ui';
import { api } from '@/lib/api';

const EMPTY = {
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  landmark: '',
  city: '',
  state: 'Karnataka',
  postalCode: '',
  isDefault: false,
};

export default function AddressesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<Address | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Address | null>(null);
  const [form, setForm] = useState(EMPTY);

  const { data, isLoading } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api().storefront.addresses(),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['addresses'] });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        line2: form.line2 || null,
        landmark: form.landmark || null,
        country: 'IN',
        type: 'HOME' as const,
        label: null,
      };
      return editing
        ? api().storefront.updateAddress(editing.id, payload)
        : api().storefront.createAddress(payload);
    },
    onSuccess: () => {
      toast.success(editing ? 'Address updated' : 'Address added');
      invalidate();
      setCreating(false);
      setEditing(null);
      setForm(EMPTY);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not save this address'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api().storefront.deleteAddress(id),
    onSuccess: () => {
      toast.success('Address removed');
      invalidate();
      setDeleting(null);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not remove it'),
  });

  const openEdit = (address: Address) => {
    setEditing(address);
    setForm({
      fullName: address.fullName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2 ?? '',
      landmark: address.landmark ?? '',
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      isDefault: address.isDefault,
    });
  };

  if (isLoading) return <SkeletonRows rows={3} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          leftIcon={<Plus className="h-4 w-4" />}
          onClick={() => {
            setForm(EMPTY);
            setCreating(true);
          }}
        >
          Add address
        </Button>
      </div>

      {(data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={<MapPin className="h-5 w-5" />}
            title="No saved addresses"
            description="Add one to make checkout faster next time."
            action={
              <Button
                onClick={() => {
                  setForm(EMPTY);
                  setCreating(true);
                }}
              >
                Add address
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data!.map((address) => (
            <Card key={address.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-content">{address.fullName}</p>
                  {address.isDefault && <Badge tone="primary">Default</Badge>}
                </div>
                <p className="mt-1.5 text-sm text-content-muted">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ''}
                  {address.landmark ? `, ${address.landmark}` : ''}
                  <br />
                  {address.city}, {address.state} {address.postalCode}
                </p>
                <p className="mt-1 text-sm text-content-muted tabular">{address.phone}</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(address)}>
                    Edit
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete address"
                    onClick={() => setDeleting(address)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? 'Edit address' : 'Add an address'}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Full name"
              required
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
            <Input
              label="Mobile number"
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <Input
            label="Flat, house no., building"
            required
            value={form.line1}
            onChange={(e) => setForm({ ...form, line1: e.target.value })}
          />
          <Input
            label="Area, street, sector"
            value={form.line2}
            onChange={(e) => setForm({ ...form, line2: e.target.value })}
          />
          <Input
            label="Landmark"
            value={form.landmark}
            onChange={(e) => setForm({ ...form, landmark: e.target.value })}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="City"
              required
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
            <Select
              label="State"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
              options={INDIAN_STATES.map((s) => ({ value: s, label: s }))}
            />
            <Input
              label="PIN code"
              required
              value={form.postalCode}
              onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              className="h-4 w-4 rounded border-line accent-[rgb(var(--color-primary))]"
            />
            <span className="text-sm text-content">Use as my default address</span>
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
        title="Remove this address?"
        message="Past orders keep the address they were delivered to."
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
      />
    </div>
  );
}
