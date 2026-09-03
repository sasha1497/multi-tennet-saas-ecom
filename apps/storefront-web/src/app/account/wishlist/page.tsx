'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, X } from 'lucide-react';
import { Button, Card, EmptyState, useToast } from '@retailos/ui';
import { ProductCard, ProductCardSkeleton } from '@/components/product-card';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';

export default function WishlistPage() {
  const { bootstrap } = useStore();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['wishlist'],
    queryFn: () => api().storefront.wishlist(),
  });

  const remove = useMutation({
    mutationFn: (productId: string) => api().storefront.removeFromWishlist(productId),
    onSuccess: () => {
      toast.success('Removed from wishlist');
      void queryClient.invalidateQueries({ queryKey: ['wishlist'] });
    },
    onError: () => toast.error('Could not remove this item'),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Heart className="h-5 w-5" />}
          title="Your wishlist is empty"
          description="Tap the heart on any product to save it for later."
          action={
            <Link href="/products">
              <Button>Browse products</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {data.map((item) => (
        <div key={item.id} className="relative">
          <ProductCard product={item.product} currency={bootstrap.store.currency} />
          <button
            type="button"
            onClick={() => remove.mutate(item.productId)}
            className="absolute right-2 top-2 rounded-full bg-surface/90 p-1.5 text-content-muted shadow-sm backdrop-blur hover:text-danger-600"
            aria-label={`Remove ${item.product.name} from wishlist`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
