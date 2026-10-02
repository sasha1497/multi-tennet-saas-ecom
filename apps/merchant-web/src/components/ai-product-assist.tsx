'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Sparkles } from 'lucide-react';
import { isApiClientError, type ProductSuggestionResponse } from '@retailos/api-client';
import { Button, Input, cn } from '@retailos/ui';
import { ButtonLink } from '@/components/console/primitives';
import { api } from '@/lib/api';
import { useErrorToast } from '@/lib/hooks';

/**
 * Smart Product Upload: draft the listing from the product photo.
 *
 * The merchant stays the author. The draft fills the form; nothing is saved
 * until they press Save, and every field stays editable. The monthly allowance
 * is shown up front so a generation is never a surprise charge — and an
 * identical request is served from the cache by the API at no cost.
 */
export function AiProductAssist({
  objectKey,
  onApply,
}: {
  /** The key of the photo to read — the first uploaded image. Null until one exists. */
  objectKey: string | null;
  onApply: (suggestion: ProductSuggestionResponse['suggestion']) => void;
}) {
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const [hint, setHint] = useState('');
  const [lastCached, setLastCached] = useState<boolean | null>(null);

  const { data: usage } = useQuery({
    queryKey: ['ai-usage'],
    queryFn: () => api().merchant.aiUsage(),
  });

  const generate = useMutation({
    mutationFn: () => api().merchant.suggestProduct(objectKey!, hint.trim() || undefined),
    onSuccess: (result) => {
      onApply(result.suggestion);
      setLastCached(result.cached);
      queryClient.setQueryData(['ai-usage'], (prev: typeof usage) =>
        prev ? { ...prev, ...result.usage } : prev,
      );
    },
    onError: (err) => {
      void queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
      showError(err, 'Could not draft details from this photo');
    },
  });

  if (!usage) return null;

  const notInPlan = usage.limit === 0;
  const exhausted = !notInPlan && usage.used >= usage.limit;
  const planError =
    isApiClientError(generate.error) &&
    (generate.error.code === 'FEATURE_NOT_ENTITLED' || generate.error.code === 'PLAN_LIMIT_REACHED');

  return (
    <div className="mt-4 rounded-xl border border-primary/25 bg-primary-soft/60 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-fg">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-content">Write the details from the photo</p>
          <p className="mt-0.5 text-xs leading-relaxed text-content-muted">
            Name, description, category, tags and search text, drafted from your first photo. You
            review everything before it is saved.
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular',
            exhausted ? 'bg-warning-50 text-warning-700' : 'bg-surface text-content-muted',
          )}
        >
          {notInPlan ? 'Not in your plan' : `${usage.used} / ${usage.limit} this month`}
        </span>
      </div>

      {notInPlan || exhausted || planError ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-content-muted">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {notInPlan
              ? 'AI product upload is not included in your current plan.'
              : `You have used this month's AI generations. They reset on ${new Date(usage.resetsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.`}
          </span>
          <ButtonLink href="/subscription" size="sm" variant="outline">
            See plans
          </ButtonLink>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Input
              label="Anything the photo can't show? (optional)"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="e.g. brand, material, size range"
              maxLength={300}
            />
          </div>
          <Button
            type="button"
            onClick={() => generate.mutate()}
            loading={generate.isPending}
            disabled={!objectKey || !usage.available}
            leftIcon={<Sparkles className="h-4 w-4" />}
            className="shrink-0"
          >
            {objectKey ? 'Draft details' : 'Add a photo first'}
          </Button>
        </div>
      )}

      {lastCached !== null && !generate.isPending && (
        <p className="mt-2 text-[11px] text-content-subtle" role="status">
          Draft added to the form above — check it before saving.
          {lastCached ? ' Reused from an earlier identical request, so it was not counted.' : ''}
        </p>
      )}
    </div>
  );
}
