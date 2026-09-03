'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { ErrorState, PageHeader, Skeleton } from '@retailos/ui';
import { ProductForm } from '@/components/product-form';
import { api } from '@/lib/api';

export default function EditProductPage() {
  const params = useParams<{ id: string }>();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['product', params.id],
    queryFn: () => api().merchant.product(params.id),
    enabled: Boolean(params.id),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-52 rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        title="Could not load this product"
        message={(error as Error)?.message}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={data.name}
        description={`${data.variants.length} variant${data.variants.length === 1 ? '' : 's'} · ${data.totalStock} in stock`}
        breadcrumbs={[{ label: 'Products', href: '/products' }, { label: data.name }]}
      />
      {/* `key` forces a fresh form when navigating between two products. */}
      <ProductForm key={data.id} product={data} />
    </div>
  );
}
