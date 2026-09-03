'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Star, X } from 'lucide-react';
import { formatDate } from '@retailos/config';
import { Permission } from '@retailos/types';
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Tabs,
  useToast,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useErrorToast } from '@/lib/hooks';

export default function ReviewsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'approved'>('pending');

  const { data, isLoading } = useQuery({
    queryKey: ['reviews', tab],
    queryFn: () => api().merchant.reviews({ isApproved: tab === 'approved' }),
  });

  const moderate = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      api().merchant.moderateReview(id, approved),
    onSuccess: (_, vars) => {
      toast.success(vars.approved ? 'Review published' : 'Review hidden');
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
    onError: (err) => showError(err, 'Could not update this review'),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Reviews"
        description="Customer reviews stay hidden until you approve them."
      />

      <Tabs
        tabs={[
          { id: 'pending', label: 'Awaiting approval' },
          { id: 'approved', label: 'Published' },
        ]}
        active={tab}
        onChange={(id) => setTab(id as 'pending' | 'approved')}
        className="mb-4"
      />

      {isLoading ? (
        <SkeletonRows rows={4} />
      ) : (data?.items.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={<Star className="h-5 w-5" />}
            title={tab === 'pending' ? 'Nothing waiting' : 'No published reviews yet'}
            description={
              tab === 'pending'
                ? 'New reviews will appear here for you to approve.'
                : 'Approved reviews show on your product pages.'
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {data!.items.map((review) => (
            <Card key={review.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex" aria-label={`${review.rating} out of 5 stars`}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={
                              i < review.rating
                                ? 'h-4 w-4 fill-warning-500 text-warning-500'
                                : 'h-4 w-4 text-neutral-300 dark:text-neutral-700'
                            }
                            aria-hidden="true"
                          />
                        ))}
                      </span>
                      {review.isVerifiedPurchase && (
                        <Badge tone="success" dot>
                          Verified purchase
                        </Badge>
                      )}
                    </div>
                    {review.title && (
                      <p className="mt-1.5 font-medium text-content">{review.title}</p>
                    )}
                    {review.comment && (
                      <p className="mt-1 text-sm text-content-muted">{review.comment}</p>
                    )}
                    <p className="mt-1.5 text-xs text-content-subtle">
                      {review.customerName} · {formatDate(review.createdAt)}
                    </p>
                  </div>

                  {can(Permission.REVIEWS_MODERATE) && (
                    <div className="flex shrink-0 gap-2">
                      {!review.isApproved ? (
                        <Button
                          size="sm"
                          leftIcon={<Check className="h-3.5 w-3.5" />}
                          onClick={() => moderate.mutate({ id: review.id, approved: true })}
                          loading={moderate.isPending}
                        >
                          Publish
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          leftIcon={<X className="h-3.5 w-3.5" />}
                          onClick={() => moderate.mutate({ id: review.id, approved: false })}
                          loading={moderate.isPending}
                        >
                          Hide
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
