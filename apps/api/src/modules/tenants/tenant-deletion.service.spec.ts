import { AppException } from '@/common/errors/app.exception';
import { TenantDeletionService } from './tenant-deletion.service';

/**
 * Tenant deletion, against fakes for the three systems it touches.
 *
 * The interesting behaviour is not "does it call delete" — it is what happens
 * when one of three non-transactional systems fails half way, and whether the
 * blast radius is genuinely one tenant. Those are the two things tested here.
 */

const TENANT_A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'kickzone', name: 'KickZone' };
const TENANT_B = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  slug: 'abcstore',
  name: 'ABC Store',
};

/** Minimal stand-in for the master Prisma client, recording what it was asked. */
function makeMaster() {
  const state = {
    tenants: new Map<string, Record<string, unknown>>([
      [
        TENANT_A.id,
        { ...TENANT_A, status: 'ACTIVE', database: { databaseName: 'tenant_kickzone' } },
      ],
      [
        TENANT_B.id,
        { ...TENANT_B, status: 'ACTIVE', database: { databaseName: 'tenant_abcstore' } },
      ],
    ]),
    databases: new Map<string, Record<string, unknown>>([
      [TENANT_A.id, { databaseName: 'tenant_kickzone', username: 'tu_kickzone' }],
      [TENANT_B.id, { databaseName: 'tenant_abcstore', username: 'tu_abcstore' }],
    ]),
    jobs: [] as Record<string, unknown>[],
    sessionsRevoked: [] as string[],
    sessionsDeleted: [] as string[],
    migrationRecordsDeleted: [] as string[],
    membershipsDeactivated: [] as string[],
    usersDeleted: [] as string[],
  };

  let jobSeq = 0;

  const master = {
    state,
    tenant: {
      findUnique: async ({ where }: never) =>
        state.tenants.get((where as { id: string }).id) ?? null,
      update: async ({ where, data }: never) => {
        const w = where as { id: string };
        const row = { ...state.tenants.get(w.id), ...(data as object) };
        state.tenants.set(w.id, row);
        return row;
      },
      delete: async ({ where }: never) => {
        const w = where as { id: string };
        state.tenants.delete(w.id);
        // Prisma cascades take the registry row with it.
        state.databases.delete(w.id);
        return {};
      },
    },
    tenantDatabase: {
      findUnique: async ({ where }: never) =>
        state.databases.get((where as { tenantId: string }).tenantId) ?? null,
    },
    tenantDeletionJob: {
      findFirst: async ({ where }: never) => {
        const w = where as { tenantId: string };
        return [...state.jobs].reverse().find((j) => j.tenantId === w.tenantId) ?? null;
      },
      findMany: async ({ where }: never) => {
        const w = where as { tenantId: string };
        return state.jobs.filter((j) => j.tenantId === w.tenantId);
      },
      create: async ({ data }: never) => {
        const job = {
          id: `job-${++jobSeq}`,
          status: 'PENDING',
          currentStep: null,
          completedSteps: [] as string[],
          attempts: 0,
          objectsDeleted: 0,
          lastError: null,
          startedAt: null,
          finishedAt: null,
          ...(data as object),
        };
        state.jobs.push(job);
        return job;
      },
      update: async ({ where, data }: never) => {
        const w = where as { id: string };
        const job = state.jobs.find((j) => j.id === w.id)!;
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
          job[key] =
            value && typeof value === 'object' && 'increment' in value
              ? ((job[key] as number) ?? 0) + (value as { increment: number }).increment
              : value;
        }
        return job;
      },
    },
    session: {
      updateMany: async ({ where }: never) => {
        state.sessionsRevoked.push((where as { tenantId: string }).tenantId);
        return { count: 2 };
      },
      deleteMany: async ({ where }: never) => {
        state.sessionsDeleted.push((where as { tenantId: string }).tenantId);
        return { count: 2 };
      },
    },
    tenantUser: {
      findMany: async () => [{ userId: 'user-1' }],
      updateMany: async ({ where }: never) => {
        state.membershipsDeactivated.push((where as { tenantId: string }).tenantId);
        return { count: 1 };
      },
    },
    tenantMigrationRecord: {
      deleteMany: async ({ where }: never) => {
        state.migrationRecordsDeleted.push((where as { tenantId: string }).tenantId);
        return { count: 3 };
      },
    },
    user: {
      findMany: async () => [{ id: 'user-1' }],
      deleteMany: async ({ where }: never) => {
        state.usersDeleted.push(...(where as { id: { in: string[] } }).id.in);
        return { count: 1 };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(master),
  };

  return master;
}

function makeStorage() {
  const objects = new Map<string, true>([
    [`tenants/${TENANT_A.id}/products/p1/a.webp`, true],
    [`tenants/${TENANT_A.id}/store/logo/b.png`, true],
    [`tenants/${TENANT_B.id}/products/p9/c.webp`, true],
    // Not under `tenants/` at all — a platform asset, which must survive.
    ['platform/email/header.png', true],
  ]);

  return {
    objects,
    purgeTenant: jest.fn(async (tenantId: string) => {
      const prefix = `tenants/${tenantId}/`;
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
      for (const key of keys) objects.delete(key);
      return keys.length;
    }),
    listTenantObjects: jest.fn(async (tenantId: string) =>
      [...objects.keys()].filter((k) => k.startsWith(`tenants/${tenantId}/`)),
    ),
  };
}

function build(overrides: Record<string, unknown> = {}) {
  const master = makeMaster();
  const storage = makeStorage();
  const ddl = {
    dropTenantDatabase: jest.fn(async () => undefined),
    databaseNameFor: (slug: string) => `tenant_${slug}`,
    usernameFor: (slug: string) => `tu_${slug}`,
  };
  const connections = { evict: jest.fn(async () => undefined) };
  const media = { forgetTenant: jest.fn() };
  const cache = { invalidateTenant: jest.fn(async () => undefined) };
  const resolver = { invalidateTenantCompletely: jest.fn(async () => undefined) };
  const context = { get: () => ({ auth: { userId: 'admin-1', email: 'admin@retailos.dev' } }) };
  const audit = { record: jest.fn() };
  const logger = {
    withContext: () => ({
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }),
  };

  const service = new TenantDeletionService(
    master as never,
    ddl as never,
    connections as never,
    (overrides.storage ?? storage) as never,
    media as never,
    cache as never,
    resolver as never,
    context as never,
    audit as never,
    logger as never,
  );

  return { service, master, storage, ddl, connections, media, cache, resolver, audit };
}

describe('TenantDeletionService', () => {
  describe('confirmation', () => {
    it('refuses without the store slug', async () => {
      const { service, master } = build();
      await expect(service.deleteTenant(TENANT_A.id, 'yes')).rejects.toThrow(AppException);
      // Nothing started: no job, and the tenant is still ACTIVE.
      expect(master.state.jobs).toHaveLength(0);
      expect(master.state.tenants.get(TENANT_A.id)?.status).toBe('ACTIVE');
    });

    it('refuses another tenant slug, even a real one', async () => {
      const { service, storage } = build();
      await expect(service.deleteTenant(TENANT_A.id, TENANT_B.slug)).rejects.toThrow(AppException);
      expect(storage.purgeTenant).not.toHaveBeenCalled();
    });

    it('accepts the slug case-insensitively — operators type it in caps', async () => {
      const { service } = build();
      const result = await service.deleteTenant(TENANT_A.id, 'KICKZONE');
      expect(result.status).toBe('COMPLETED');
    });

    it('404s for a tenant that does not exist', async () => {
      const { service } = build();
      await expect(service.deleteTenant('nope', 'nope')).rejects.toThrow(AppException);
    });
  });

  describe('a successful deletion', () => {
    it('runs every step and reports what it removed', async () => {
      const { service } = build();
      const result = await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      expect(result.status).toBe('COMPLETED');
      expect(result.completedSteps).toEqual([
        'REVOKE_ACCESS',
        'PURGE_STORAGE',
        'DROP_DATABASE',
        'PURGE_MASTER_RECORDS',
        'FINALISE',
      ]);
      expect(result.objectsDeleted).toBe(2);
    });

    it('revokes access before destroying anything', async () => {
      const order: string[] = [];
      const { service, storage, ddl, resolver } = build();
      resolver.invalidateTenantCompletely.mockImplementation(async () => {
        order.push('revoke');
      });
      storage.purgeTenant.mockImplementation(async () => {
        order.push('storage');
        return 0;
      });
      ddl.dropTenantDatabase.mockImplementation(async () => {
        order.push('database');
      });

      await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      // The ordering is the safety property: a failure after step one still
      // leaves a tenant that cannot authenticate or be routed to.
      expect(order).toEqual(['revoke', 'storage', 'database']);
    });

    it('drops the tenant database and its role', async () => {
      const { service, ddl } = build();
      await service.deleteTenant(TENANT_A.id, TENANT_A.slug);
      expect(ddl.dropTenantDatabase).toHaveBeenCalledWith('tenant_kickzone', 'tu_kickzone');
    });

    it('signs the tenant out and removes its control-plane rows', async () => {
      const { service, master } = build();
      await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      expect(master.state.sessionsRevoked).toContain(TENANT_A.id);
      expect(master.state.membershipsDeactivated).toContain(TENANT_A.id);
      expect(master.state.migrationRecordsDeleted).toContain(TENANT_A.id);
      expect(master.state.tenants.has(TENANT_A.id)).toBe(false);
    });

    it('removes accounts left with no store at all', async () => {
      const { service, master } = build();
      await service.deleteTenant(TENANT_A.id, TENANT_A.slug);
      expect(master.state.usersDeleted).toEqual(['user-1']);
    });

    it('writes a TENANT_DELETED audit entry', async () => {
      const { service, audit } = build();
      await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      expect(audit.record).toHaveBeenCalledWith(
        'platform',
        expect.objectContaining({ action: 'TENANT_DELETED', tenantId: TENANT_A.id }),
      );
    });
  });

  /** The promise the whole platform rests on, applied to its most dangerous op. */
  describe('blast radius', () => {
    it('leaves the other tenant completely untouched', async () => {
      const { service, master, storage, ddl } = build();
      await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      expect(master.state.tenants.has(TENANT_B.id)).toBe(true);
      expect(storage.objects.has(`tenants/${TENANT_B.id}/products/p9/c.webp`)).toBe(true);
      expect(ddl.dropTenantDatabase).not.toHaveBeenCalledWith('tenant_abcstore', expect.anything());
      expect(master.state.sessionsRevoked).not.toContain(TENANT_B.id);
    });

    it('leaves shared platform assets in place', async () => {
      const { service, storage } = build();
      await service.deleteTenant(TENANT_A.id, TENANT_A.slug);
      expect(storage.objects.has('platform/email/header.png')).toBe(true);
    });
  });

  /**
   * Three systems, no shared transaction. What matters is that a failure is a
   * *known* state that can be resumed, not an unknown one.
   */
  describe('partial failure and retry', () => {
    it('stops at the failing step and names it, without going further', async () => {
      const { service, storage, ddl } = build();
      storage.purgeTenant.mockRejectedValueOnce(new Error('MinIO unreachable'));

      const result = await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      expect(result.status).toBe('FAILED');
      expect(result.currentStep).toBe('PURGE_STORAGE');
      expect(result.error).toContain('MinIO unreachable');
      expect(result.completedSteps).toEqual(['REVOKE_ACCESS']);
      // Crucially, the database was NOT dropped — the pipeline stopped.
      expect(ddl.dropTenantDatabase).not.toHaveBeenCalled();
    });

    it('leaves the tenant unusable even when it fails immediately after', async () => {
      const { service, master, storage } = build();
      storage.purgeTenant.mockRejectedValueOnce(new Error('MinIO unreachable'));

      await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      // DELETING is refused by TenantGuard exactly as DELETED is, so a
      // half-deleted store cannot authenticate or mint a presigned URL.
      expect(master.state.tenants.get(TENANT_A.id)?.status).toBe('DELETING');
    });

    it('records the failure for the audit trail', async () => {
      const { service, storage, audit } = build();
      storage.purgeTenant.mockRejectedValueOnce(new Error('MinIO unreachable'));
      await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      expect(audit.record).toHaveBeenCalledWith(
        'platform',
        expect.objectContaining({ action: 'TENANT_DELETION_FAILED' }),
      );
    });

    it('resumes from the failed step rather than redoing the finished ones', async () => {
      const { service, storage, resolver } = build();
      storage.purgeTenant.mockRejectedValueOnce(new Error('MinIO unreachable'));
      await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      const revokeCallsAfterFirstRun = resolver.invalidateTenantCompletely.mock.calls.length;

      const retry = await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      expect(retry.status).toBe('COMPLETED');
      expect(retry.completedSteps).toContain('PURGE_STORAGE');
      // REVOKE_ACCESS was already recorded, so it is skipped on the retry.
      expect(resolver.invalidateTenantCompletely).toHaveBeenCalledTimes(revokeCallsAfterFirstRun);
    });

    it('resumes a database drop after the registry row is already gone', async () => {
      const { service, master, ddl } = build();
      ddl.dropTenantDatabase.mockRejectedValueOnce(new Error('database is being accessed'));
      await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      // Simulate the registry row having been lost with a previous partial run.
      master.state.databases.delete(TENANT_A.id);

      const retry = await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      expect(retry.status).toBe('COMPLETED');
      // The name was captured on the job when it was created, so the drop
      // still targets the right database.
      expect(ddl.dropTenantDatabase).toHaveBeenLastCalledWith('tenant_kickzone', 'tu_kickzone');
    });

    it('is idempotent once complete — a repeat deletes nothing further', async () => {
      const { service, storage, ddl } = build();
      await service.deleteTenant(TENANT_A.id, TENANT_A.slug);
      const dropsAfterFirst = ddl.dropTenantDatabase.mock.calls.length;

      // The tenant row is gone, so a second attempt cannot even be confirmed —
      // which is itself the right answer.
      await expect(service.deleteTenant(TENANT_A.id, TENANT_A.slug)).rejects.toThrow(AppException);
      expect(ddl.dropTenantDatabase).toHaveBeenCalledTimes(dropsAfterFirst);
      expect(storage.purgeTenant).toHaveBeenCalledTimes(1);
    });
  });

  describe('final verification', () => {
    it('fails rather than reporting success when objects survive the purge', async () => {
      const { service, storage } = build();
      // Storage claims success but leaves something behind — a silently
      // partial delete is exactly what the verification step exists to catch.
      storage.purgeTenant.mockResolvedValueOnce(0);

      const result = await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      expect(result.status).toBe('FAILED');
      expect(result.currentStep).toBe('FINALISE');
      expect(result.error).toContain('remain in storage');
    });
  });

  describe('history', () => {
    it('keeps the job after the tenant it deleted is gone', async () => {
      const { service, master } = build();
      await service.deleteTenant(TENANT_A.id, TENANT_A.slug);

      expect(master.state.tenants.has(TENANT_A.id)).toBe(false);
      const jobs = await service.jobs(TENANT_A.id);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].status).toBe('COMPLETED');
    });
  });
});
