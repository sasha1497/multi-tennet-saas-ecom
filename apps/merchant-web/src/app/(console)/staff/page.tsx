'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, UsersRound } from 'lucide-react';
import { formatDate } from '@retailos/config';
import { PERMISSION_GROUPS, Permission } from '@retailos/types';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  useToast,
  type Column,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useErrorToast } from '@/lib/hooks';

type StaffMember = Awaited<ReturnType<ReturnType<typeof api>['merchant']['staff']>>[number];

export default function StaffPage() {
  const { can, session } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<StaffMember | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['staff'],
    queryFn: () => api().merchant.staff(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api().merchant.removeStaff(id),
    onSuccess: () => {
      toast.success('Team member removed');
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      setRemoving(null);
    },
    onError: (err) => showError(err, 'Could not remove this team member'),
  });

  const columns: Column<StaffMember>[] = [
    {
      key: 'name',
      header: 'Member',
      cell: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.fullName} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-content">
              {row.fullName}
              {row.userId === session?.user.id && (
                <span className="ml-1.5 text-xs font-normal text-content-subtle">(you)</span>
              )}
            </p>
            <p className="truncate text-xs text-content-subtle">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (row) => (
        <Badge tone={row.role === 'OWNER' ? 'primary' : row.role === 'MANAGER' ? 'info' : 'neutral'}>
          {row.role.charAt(0) + row.role.slice(1).toLowerCase()}
        </Badge>
      ),
    },
    {
      key: 'permissions',
      header: 'Access',
      hideBelowMd: true,
      cell: (row) => (
        <span className="text-xs text-content-muted tabular">
          {row.permissions.length} permission{row.permissions.length === 1 ? '' : 's'}
        </span>
      ),
    },
    {
      key: 'lastLogin',
      header: 'Last seen',
      hideBelowMd: true,
      cell: (row) => (
        <span className="text-content-muted">
          {row.lastLoginAt ? formatDate(row.lastLoginAt) : 'Never signed in'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge tone={row.isActive ? 'success' : 'neutral'} dot>
          {row.isActive ? 'Active' : 'Disabled'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) =>
        can(Permission.STAFF_MANAGE) && row.role !== 'OWNER' && row.userId !== session?.user.id ? (
          <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => setRemoving(row)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Team"
        description="Who can manage this store, and what they are allowed to do."
        actions={
          can(Permission.STAFF_MANAGE) && (
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setInviting(true)}>
              Invite member
            </Button>
          )
        }
      />

      <Card>
        <DataTable
          columns={columns}
          rows={data ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<UsersRound className="h-5 w-5" />}
              title="Just you so far"
              description="Invite a manager or shop assistant to help run the store."
            />
          }
        />
      </Card>

      <InviteModal open={inviting} onClose={() => setInviting(false)} />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
        title="Remove from this store?"
        message={
          <>
            <strong>{removing?.fullName}</strong> will immediately lose access to this store. Their
            RetailOS account and any other stores they work at are unaffected.
          </>
        }
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
      />
    </div>
  );
}

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { permissions, isSuperAdmin } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: 'STAFF' as 'MANAGER' | 'STAFF',
  });
  const [extra, setExtra] = useState<string[]>([]);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () =>
      api().merchant.inviteStaff({
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim() || undefined,
        role: form.role,
        extraPermissions: extra,
      }),
    onSuccess: (member) => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      if (member.temporaryPassword) {
        // Shown once — we store only a hash, so it cannot be retrieved later.
        setTempPassword(member.temporaryPassword);
      } else {
        toast.success('Invitation sent', 'They can sign in with their existing account.');
        onClose();
      }
    },
    onError: (err) => showError(err, 'Could not invite this person'),
  });

  const close = () => {
    setTempPassword(null);
    setForm({ email: '', firstName: '', lastName: '', role: 'STAFF' });
    setExtra([]);
    onClose();
  };

  if (tempPassword) {
    return (
      <Modal
        open={open}
        onClose={close}
        title="Invitation created"
        footer={<Button onClick={close}>Done</Button>}
      >
        <div className="space-y-3">
          <p className="text-sm text-content-muted">
            An email is on its way. If it does not arrive, share this one-time password — it is shown
            only now and cannot be retrieved again.
          </p>
          <div className="rounded-lg border border-line bg-surface-muted p-3 text-center">
            <code className="font-mono text-lg font-semibold tracking-wider text-content">
              {tempPassword}
            </code>
          </div>
          <p className="text-xs text-content-subtle">
            Ask them to change it as soon as they sign in.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite a team member"
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={() => invite.mutate()}
            loading={invite.isPending}
            disabled={!form.email.trim() || !form.firstName.trim()}
          >
            Send invitation
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="First name"
            required
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
          <Input
            label="Last name"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </div>

        <Input
          label="Email address"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />

        <Select
          label="Role"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as 'MANAGER' | 'STAFF' })}
          options={[
            { value: 'STAFF', label: 'Staff — orders and stock' },
            { value: 'MANAGER', label: 'Manager — everything except the team' },
          ]}
          hint="Only the owner can change billing or remove the store."
        />

        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium text-content">
            Extra permissions
          </summary>
          <p className="mb-3 mt-2 text-xs text-content-muted">
            Grant individual capabilities beyond the role. You can only grant what you hold yourself.
          </p>
          <div className="space-y-4">
            {PERMISSION_GROUPS.map((group) => {
              const grantable = group.permissions.filter(
                (p) => isSuperAdmin || permissions.includes(p),
              );
              if (grantable.length === 0) return null;
              return (
                <div key={group.label}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-subtle">
                    {group.label}
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {grantable.map((permission) => (
                      <Checkbox
                        key={permission}
                        label={<span className="font-mono text-xs">{permission}</span>}
                        checked={extra.includes(permission)}
                        onChange={(e) =>
                          setExtra((list) =>
                            e.target.checked
                              ? [...list, permission]
                              : list.filter((p) => p !== permission),
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      </div>
    </Modal>
  );
}
