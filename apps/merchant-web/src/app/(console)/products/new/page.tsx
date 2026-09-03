'use client';

import { PageHeader } from '@retailos/ui';
import { ProductForm } from '@/components/product-form';

export default function NewProductPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Add product"
        description="Create a product with its variants, pricing and opening stock."
        breadcrumbs={[{ label: 'Products', href: '/products' }, { label: 'New' }]}
      />
      <ProductForm />
    </div>
  );
}
