'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformTemplate } from '@retailos/api-client';
import { Badge, Card, ConfirmDialog, Skeleton, Switch, Tabs, useToast } from '@retailos/ui';
import { PageHead } from '@/components/console/primitives';
import { api } from '@/lib/api';
import { useErrorToast } from '@/lib/hooks';

type Family = 'all' | PlatformTemplate['family'];

const FAMILY_LABEL: Record<PlatformTemplate['family'], string> = {
  standard: 'Standard',
  premium: 'Premium',
  '3d': '3D',
};

/**
 * The template catalogue, as the platform runs it.
 *
 * The designs themselves ship with the code; what an operator controls here
 * is whether each one is offered. Withdrawing a template stops new stores
 * adopting it — stores already on it keep it, because taking a design away
 * must never take a live shop down. Access per plan is by family and is set on
 * the plans, not here.
 */
export default function PlatformTemplatesPage() {
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const [family, setFamily] = useState<Family>('all');
  const [withdrawing, setWithdrawing] = useState<PlatformTemplate | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-templates'],
    queryFn: () => api().platform.templates(),
  });

  const toggle = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) =>
      api().platform.setTemplatePublished(id, published),
    onSuccess: (result) => {
      toast.success(result.isPublished ? 'Template published' : 'Template withdrawn');
      setWithdrawing(null);
      void queryClient.invalidateQueries({ queryKey: ['platform-templates'] });
    },
    onError: (err) => showError(err, 'Could not change the template'),
  });

  const rows = (data ?? []).filter((t) => family === 'all' || t.family === family);
  const count = (f: PlatformTemplate['family']) => (data ?? []).filter((t) => t.family === f).length;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHead
        title="Templates"
        description="Every storefront design in the catalogue, by family. Withdrawn designs stay live for stores already using them."
      />

      <Tabs
        tabs={[
          { id: 'all', label: 'All', count: data?.length },
          { id: 'standard', label: 'Standard', count: count('standard') },
          { id: 'premium', label: 'Premium', count: count('premium') },
          { id: '3d', label: '3D', count: count('3d') },
        ]}
        active={family}
        onChange={(id) => setFamily(id as Family)}
      />

      <Card>
        {isLoading ? (
          <div className="p-5">
            <Skeleton className="h-64" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-content-subtle">
                  <th className="px-5 py-2.5 font-medium">Template</th>
                  <th className="px-5 py-2.5 font-medium">Family</th>
                  <th className="px-5 py-2.5 font-medium">Industry</th>
                  <th className="px-5 py-2.5 font-medium">Version</th>
                  <th className="px-5 py-2.5 font-medium">Included from</th>
                  <th className="px-5 py-2.5 font-medium">Published</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((template) => (
                  <tr key={template.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex shrink-0 overflow-hidden rounded-md ring-1 ring-black/10" aria-hidden="true">
                          {template.swatches.map((colour) => (
                            <span key={colour} className="h-7 w-2.5" style={{ backgroundColor: colour }} />
                          ))}
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium text-content">{template.name}</p>
                          <p className="truncate text-xs text-content-subtle">{template.tagline}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={template.family === 'standard' ? 'neutral' : template.family === 'premium' ? 'primary' : 'info'}>
                        {FAMILY_LABEL[template.family]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-content-muted">{template.group}</td>
                    <td className="px-5 py-3 tabular text-content-muted">v{template.version}</td>
                    <td className="px-5 py-3 text-content-muted">{template.requiredPlan.charAt(0) + template.requiredPlan.slice(1).toLowerCase()}</td>
                    <td className="px-5 py-3">
                      <Switch
                        checked={template.published}
                        disabled={toggle.isPending}
                        onChange={(checked) => {
                          if (checked) toggle.mutate({ id: template.id, published: true });
                          else setWithdrawing(template);
                        }}
                        label={template.published ? 'Live' : 'Withdrawn'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={withdrawing !== null}
        onClose={() => setWithdrawing(null)}
        onConfirm={() => {
          if (withdrawing) toggle.mutate({ id: withdrawing.id, published: false });
        }}
        loading={toggle.isPending}
        title={`Withdraw ${withdrawing?.name ?? 'this template'}?`}
        message="It disappears from every store's gallery and no store can newly choose it. Stores already using it keep it, unchanged, until they pick another design."
        confirmLabel="Withdraw"
        destructive
      />
    </div>
  );
}
