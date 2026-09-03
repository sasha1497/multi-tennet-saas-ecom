'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Plus, Trash2, Upload } from 'lucide-react';
import type { CreateProductRequest, Product, ProductStatus } from '@retailos/types';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Select,
  Textarea,
  useToast,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { paiseToRupees, rupeesToPaise, useErrorToast } from '@/lib/hooks';

interface VariantRow {
  id?: string;
  sku: string;
  optionValues: string[];
  price: string;
  mrp: string;
  stock: string;
  lowStockThreshold: string;
}

interface OptionRow {
  name: string;
  values: string;
}

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const editing = Boolean(product);

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api().merchant.categories(),
  });
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: () => api().merchant.brands(),
  });

  const [basics, setBasics] = useState({
    name: product?.name ?? '',
    shortDescription: product?.shortDescription ?? '',
    description: product?.description ?? '',
    categoryId: product?.categoryId ?? '',
    brandId: product?.brandId ?? '',
    status: (product?.status ?? 'DRAFT') as ProductStatus,
    isFeatured: product?.isFeatured ?? false,
    taxRateBps: product?.taxRateBps != null ? String(product.taxRateBps / 100) : '',
    hsnCode: product?.hsnCode ?? '',
    tags: (product?.tags ?? []).join(', '),
  });

  const [images, setImages] = useState<string[]>(product?.images.map((i) => i.url) ?? []);
  const [uploading, setUploading] = useState(false);

  const [options, setOptions] = useState<OptionRow[]>(
    product?.options.length
      ? product.options.map((o) => ({ name: o.name, values: o.values.join(', ') }))
      : [],
  );

  const [variants, setVariants] = useState<VariantRow[]>(
    product?.variants.length
      ? product.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          optionValues: product.options.map((o) => v.options[o.name] ?? ''),
          price: paiseToRupees(v.price),
          mrp: paiseToRupees(v.mrp),
          stock: String(v.stock.quantity),
          lowStockThreshold: String(v.stock.lowStockThreshold),
        }))
      : [{ sku: '', optionValues: [], price: '', mrp: '', stock: '0', lowStockThreshold: '5' }],
  );

  const [errors, setErrors] = useState<Record<string, string>>({});

  const optionNames = useMemo(
    () => options.map((o) => o.name.trim()).filter(Boolean),
    [options],
  );

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const result = await api().merchant.uploadFile(file, file.name);
      setImages((list) => [...list, result.url]);
    } catch (err) {
      showError(err, 'Could not upload the image');
    } finally {
      setUploading(false);
    }
  };

  const buildPayload = (): CreateProductRequest => ({
    name: basics.name.trim(),
    shortDescription: basics.shortDescription.trim() || null,
    description: basics.description.trim() || null,
    status: basics.status,
    categoryId: basics.categoryId || null,
    brandId: basics.brandId || null,
    isFeatured: basics.isFeatured,
    // The form takes a percentage; the API stores basis points.
    taxRateBps: basics.taxRateBps ? Math.round(Number(basics.taxRateBps) * 100) : null,
    hsnCode: basics.hsnCode.trim() || null,
    tags: basics.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    images: images.map((url, i) => ({ url, isPrimary: i === 0 })),
    options: options
      .filter((o) => o.name.trim() && o.values.trim())
      .map((o) => ({
        name: o.name.trim(),
        values: o.values
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      })),
    variants: variants.map((v) => ({
      id: v.id,
      sku: v.sku.trim().toUpperCase(),
      options: Object.fromEntries(
        optionNames.map((name, i) => [name, v.optionValues[i] ?? '']).filter(([, val]) => val),
      ),
      price: rupeesToPaise(v.price),
      mrp: rupeesToPaise(v.mrp || v.price),
      initialStock: Number(v.stock) || 0,
      lowStockThreshold: Number(v.lowStockThreshold) || 5,
      isActive: true,
    })),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      return editing
        ? api().merchant.updateProduct(product!.id, payload)
        : api().merchant.createProduct(payload);
    },
    onSuccess: (saved) => {
      toast.success(editing ? 'Product updated' : 'Product created');
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      router.push(`/products/${saved.id}`);
    },
    onError: (err) => {
      const fieldErrors =
        err && typeof err === 'object' && 'fieldErrors' in err
          ? (err as { fieldErrors: Record<string, string> }).fieldErrors
          : {};
      setErrors(fieldErrors);
      showError(err, 'Could not save this product');
    },
  });

  const addVariant = () =>
    setVariants((list) => [
      ...list,
      { sku: '', optionValues: [], price: '', mrp: '', stock: '0', lowStockThreshold: '5' },
    ]);

  const updateVariant = (index: number, patch: Partial<VariantRow>) =>
    setVariants((list) => list.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  return (
    <form
      className="mx-auto max-w-4xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      noValidate
    >
      <Card>
        <CardHeader title="Basics" description="What the product is and where it sits in your catalog." />
        <CardBody className="space-y-4">
          <Input
            label="Product name"
            required
            value={basics.name}
            onChange={(e) => setBasics({ ...basics, name: e.target.value })}
            error={errors.name}
            placeholder="Velocity Pace 3 Running Shoes"
          />

          <Input
            label="Short description"
            value={basics.shortDescription}
            onChange={(e) => setBasics({ ...basics, shortDescription: e.target.value })}
            hint="One line shown on product cards and search results."
          />

          <Textarea
            label="Full description"
            rows={5}
            value={basics.description}
            onChange={(e) => setBasics({ ...basics, description: e.target.value })}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Category"
              value={basics.categoryId}
              onChange={(e) => setBasics({ ...basics, categoryId: e.target.value })}
              placeholder="No category"
              options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
            <Select
              label="Brand"
              value={basics.brandId}
              onChange={(e) => setBasics({ ...basics, brandId: e.target.value })}
              placeholder="No brand"
              options={(brands ?? []).map((b) => ({ value: b.id, label: b.name }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="Status"
              value={basics.status}
              onChange={(e) => setBasics({ ...basics, status: e.target.value as ProductStatus })}
              options={[
                { value: 'DRAFT', label: 'Draft — not visible' },
                { value: 'PUBLISHED', label: 'Published — on sale' },
              ]}
            />
            <Input
              label="GST rate (%)"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={basics.taxRateBps}
              onChange={(e) => setBasics({ ...basics, taxRateBps: e.target.value })}
              hint="Blank uses the store default."
            />
            <Input
              label="HSN code"
              value={basics.hsnCode}
              onChange={(e) => setBasics({ ...basics, hsnCode: e.target.value })}
            />
          </div>

          <Input
            label="Tags"
            value={basics.tags}
            onChange={(e) => setBasics({ ...basics, tags: e.target.value })}
            hint="Comma separated. Used by search."
            placeholder="running, lightweight, daily"
          />

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={basics.isFeatured}
              onChange={(e) => setBasics({ ...basics, isFeatured: e.target.checked })}
              className="h-4 w-4 rounded border-line accent-[rgb(var(--color-primary))]"
            />
            <span className="text-sm text-content">Feature on the storefront home page</span>
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Images"
          description="The first image is used as the main product photo."
        />
        <CardBody>
          <div className="flex flex-wrap gap-3">
            {images.map((url, i) => (
              <div key={url} className="group relative">
                <img
                  src={url}
                  alt=""
                  className="h-24 w-24 rounded-lg border border-line object-cover"
                />
                {i === 0 && (
                  <span className="absolute left-1 top-1 rounded bg-neutral-900/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    Main
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setImages((list) => list.filter((u) => u !== url))}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-danger-600 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Remove image"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}

            <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-content-subtle hover:border-primary hover:text-primary">
              {uploading ? (
                <Upload className="h-5 w-5 animate-pulse" />
              ) : (
                <ImagePlus className="h-5 w-5" />
              )}
              <span className="text-[11px]">{uploading ? 'Uploading…' : 'Add image'}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-content-subtle">
            JPEG, PNG, WebP or AVIF · up to 5 MB each.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Options"
          description="Axes like Size or Colour. Leave empty for a product with a single variant."
          action={
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setOptions((list) => [...list, { name: '', values: '' }])}
              disabled={options.length >= 3}
            >
              Add option
            </Button>
          }
        />
        {options.length > 0 && (
          <CardBody className="space-y-3">
            {options.map((opt, i) => (
              <div key={i} className="flex items-end gap-3">
                <Input
                  containerClassName="w-40"
                  label="Name"
                  value={opt.name}
                  onChange={(e) =>
                    setOptions((list) =>
                      list.map((o, idx) => (idx === i ? { ...o, name: e.target.value } : o)),
                    )
                  }
                  placeholder="Size"
                />
                <Input
                  containerClassName="flex-1"
                  label="Values"
                  value={opt.values}
                  onChange={(e) =>
                    setOptions((list) =>
                      list.map((o, idx) => (idx === i ? { ...o, values: e.target.value } : o)),
                    )
                  }
                  placeholder="7, 8, 9, 10"
                  hint="Comma separated"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="mb-6"
                  aria-label="Remove option"
                  onClick={() => setOptions((list) => list.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Variants & pricing"
          description="Every sellable combination, with its own SKU, price and stock."
          action={
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={addVariant}
            >
              Add variant
            </Button>
          }
        />
        <CardBody>
          {errors.variants && (
            <p className="mb-3 text-sm text-danger-600" role="alert">
              {errors.variants}
            </p>
          )}
          <div className="scroll-slim overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-content-muted">
                  <th className="pb-2 pr-3">SKU</th>
                  {optionNames.map((name) => (
                    <th key={name} className="pb-2 pr-3">
                      {name}
                    </th>
                  ))}
                  <th className="pb-2 pr-3">Price (₹)</th>
                  <th className="pb-2 pr-3">MRP (₹)</th>
                  <th className="pb-2 pr-3">Stock</th>
                  <th className="pb-2 pr-3">Low at</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {variants.map((variant, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3">
                      <input
                        value={variant.sku}
                        onChange={(e) => updateVariant(i, { sku: e.target.value })}
                        placeholder="KZ-PACE3-9"
                        className="h-9 w-32 rounded-lg border border-line bg-surface px-2 text-sm uppercase"
                      />
                    </td>
                    {optionNames.map((name, oi) => (
                      <td key={name} className="py-2 pr-3">
                        <input
                          value={variant.optionValues[oi] ?? ''}
                          onChange={(e) => {
                            const next = [...variant.optionValues];
                            next[oi] = e.target.value;
                            updateVariant(i, { optionValues: next });
                          }}
                          className="h-9 w-20 rounded-lg border border-line bg-surface px-2 text-sm"
                        />
                      </td>
                    ))}
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={variant.price}
                        onChange={(e) => updateVariant(i, { price: e.target.value })}
                        className="tabular h-9 w-24 rounded-lg border border-line bg-surface px-2 text-sm"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={variant.mrp}
                        onChange={(e) => updateVariant(i, { mrp: e.target.value })}
                        className="tabular h-9 w-24 rounded-lg border border-line bg-surface px-2 text-sm"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min="0"
                        value={variant.stock}
                        disabled={Boolean(variant.id)}
                        title={variant.id ? 'Change stock from the Inventory page' : undefined}
                        onChange={(e) => updateVariant(i, { stock: e.target.value })}
                        className="tabular h-9 w-20 rounded-lg border border-line bg-surface px-2 text-sm disabled:bg-surface-muted disabled:text-content-subtle"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min="0"
                        value={variant.lowStockThreshold}
                        onChange={(e) => updateVariant(i, { lowStockThreshold: e.target.value })}
                        className="tabular h-9 w-20 rounded-lg border border-line bg-surface px-2 text-sm"
                      />
                    </td>
                    <td className="py-2">
                      {variants.length > 1 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Remove variant"
                          onClick={() => setVariants((list) => list.filter((_, idx) => idx !== i))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editing && (
            <p className="mt-3 text-xs text-content-subtle">
              Stock for existing variants is managed on the Inventory page, so every change is
              recorded in the stock ledger.
            </p>
          )}
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-2 pb-4">
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {editing ? 'Save changes' : 'Create product'}
        </Button>
      </div>
    </form>
  );
}
