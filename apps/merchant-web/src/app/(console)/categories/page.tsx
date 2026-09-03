'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { Permission, type Brand, type Category } from '@retailos/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  Tabs,
  Textarea,
  useToast,
  type Column,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useErrorToast } from '@/lib/hooks';

export default function CategoriesPage() {
  const [tab, setTab] = useState<'categories' | 'brands'>('categories');

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Categories & brands"
        description="How your catalog is organised for shoppers."
      />
      <Tabs
        tabs={[
          { id: 'categories', label: 'Categories' },
          { id: 'brands', label: 'Brands' },
        ]}
        active={tab}
        onChange={(id) => setTab(id as 'categories' | 'brands')}
        className="mb-4"
      />
      {tab === 'categories' ? <CategoriesTab /> : <BrandsTab />}
    </div>
  );
}

function CategoriesTab() {
  const { can } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api().merchant.categories(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api().merchant.deleteCategory(id),
    onSuccess: () => {
      toast.success('Category removed', 'Its products were kept and are now uncategorised.');
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      setDeleting(null);
    },
    onError: (err) => showError(err, 'Could not remove this category'),
  });

  const columns: Column<Category>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (row) => (
        <div className="flex items-center gap-3">
          {row.imageUrl ? (
            <img src={row.imageUrl} alt="" className="h-8 w-8 rounded-lg object-cover" loading="lazy" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-muted text-content-subtle">
              <Tags className="h-3.5 w-3.5" />
            </span>
          )}
          <div>
            <p className="font-medium text-content">{row.name}</p>
            <p className="text-xs text-content-subtle">/{row.slug}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'products',
      header: 'Products',
      align: 'right',
      cell: (row) => <span className="tabular">{row.productCount ?? 0}</span>,
    },
    {
      key: 'status',
      header: 'Visible',
      cell: (row) => (
        <Badge tone={row.isActive ? 'success' : 'neutral'} dot>
          {row.isActive ? 'Yes' : 'Hidden'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) =>
        can(Permission.CATEGORIES_MANAGE) ? (
          <div className="flex justify-end gap-1">
            <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(row)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => setDeleting(row)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <Card>
        <CardHeader
          title="Categories"
          description="Shoppers browse your store by these."
          action={
            can(Permission.CATEGORIES_MANAGE) && (
              <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
                Add category
              </Button>
            )
          }
        />
        <DataTable
          columns={columns}
          rows={data ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<Tags className="h-5 w-5" />}
              title="No categories yet"
              description="Group your products so customers can find them."
              action={
                can(Permission.CATEGORIES_MANAGE) && (
                  <Button onClick={() => setCreating(true)}>Add category</Button>
                )
              }
            />
          }
        />
      </Card>

      <CategoryModal
        open={creating || editing !== null}
        category={editing}
        parents={data ?? []}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
        title="Remove this category?"
        message={
          <>
            <strong>{deleting?.name}</strong> will be removed from your storefront navigation. Its{' '}
            {deleting?.productCount ?? 0} product(s) are kept and become uncategorised.
          </>
        }
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}

function CategoryModal({
  open,
  category,
  parents,
  onClose,
}: {
  open: boolean;
  category: Category | null;
  parents: Category[];
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: category?.name ?? '',
    description: category?.description ?? '',
    parentId: category?.parentId ?? '',
    sortOrder: String(category?.sortOrder ?? 0),
    isActive: category?.isActive ?? true,
  });

  // Reset the form whenever the modal is opened for a different record.
  const [lastId, setLastId] = useState<string | null>(null);
  if (open && (category?.id ?? null) !== lastId) {
    setLastId(category?.id ?? null);
    setForm({
      name: category?.name ?? '',
      description: category?.description ?? '',
      parentId: category?.parentId ?? '',
      sortOrder: String(category?.sortOrder ?? 0),
      isActive: category?.isActive ?? true,
    });
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        parentId: form.parentId || null,
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
      };
      return category
        ? api().merchant.updateCategory(category.id, payload)
        : api().merchant.createCategory(payload);
    },
    onSuccess: () => {
      toast.success(category ? 'Category updated' : 'Category created');
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
    onError: (err) => showError(err, 'Could not save this category'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={category ? 'Edit category' : 'New category'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.name.trim()}>
            {category ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Running shoes"
        />
        <Textarea
          label="Description"
          rows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <Select
          label="Parent category"
          value={form.parentId}
          onChange={(e) => setForm({ ...form, parentId: e.target.value })}
          placeholder="None (top level)"
          options={parents
            .filter((c) => c.id !== category?.id)
            .map((c) => ({ value: c.id, label: c.name }))}
        />
        <Input
          label="Sort order"
          type="number"
          value={form.sortOrder}
          onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
          hint="Lower numbers appear first."
        />
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            className="h-4 w-4 rounded border-line accent-[rgb(var(--color-primary))]"
          />
          <span className="text-sm text-content">Show on the storefront</span>
        </label>
      </div>
    </Modal>
  );
}

function BrandsTab() {
  const { can } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<Brand | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: () => api().merchant.brands(),
  });

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api().merchant.updateBrand(editing.id, { name: name.trim() })
        : api().merchant.createBrand({ name: name.trim() }),
    onSuccess: () => {
      toast.success(editing ? 'Brand updated' : 'Brand created');
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      setCreating(false);
      setEditing(null);
      setName('');
    },
    onError: (err) => showError(err, 'Could not save this brand'),
  });

  const columns: Column<Brand>[] = [
    { key: 'name', header: 'Brand', cell: (row) => <span className="font-medium">{row.name}</span> },
    {
      key: 'products',
      header: 'Products',
      align: 'right',
      cell: (row) => <span className="tabular">{row.productCount ?? 0}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) =>
        can(Permission.BRANDS_MANAGE) ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Edit"
            onClick={() => {
              setEditing(row);
              setName(row.name);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <Card>
        <CardHeader
          title="Brands"
          action={
            can(Permission.BRANDS_MANAGE) && (
              <Button
                size="sm"
                leftIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => {
                  setCreating(true);
                  setName('');
                }}
              >
                Add brand
              </Button>
            )
          }
        />
        <DataTable
          columns={columns}
          rows={data ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          empty={<EmptyState title="No brands yet" description="Brands are optional but help shoppers filter." />}
        />
      </Card>

      <Modal
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? 'Edit brand' : 'New brand'}
        size="sm"
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
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
              Save
            </Button>
          </>
        }
      >
        <Input label="Brand name" required value={name} onChange={(e) => setName(e.target.value)} />
      </Modal>
    </>
  );
}
