import { Injectable } from '@nestjs/common';
import { ASSIGNABLE_STAFF_ROLES, AuditAction, LimitKey, Role, permissionsForRole } from '@retailos/types';
import type { InviteStaffInput } from '@retailos/validation';
import { normalisePhone } from '@retailos/validation';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import { RequestContextService } from '@/core/context/request-context';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { AppLogger } from '@/core/logger/logger.service';
import { QueueService } from '@/core/queue/queue.service';
import { PasswordService } from '@/core/security/password.service';
import { MembershipService } from '@/core/tenant/membership.service';
import { AuditService } from '@/modules/audit/audit.service';
import { EntitlementsService } from '@/modules/entitlements/entitlements.service';

export interface StaffMember {
  id: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  role: string;
  permissions: string[];
  extraPermissions: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/**
 * Staff management for a merchant.
 *
 * Identity is master-side (a `users` row plus a `tenant_users` membership),
 * mirrored into the tenant database as a `staff_profiles` row so order history
 * and audit entries can show a name without a cross-database join.
 *
 * Two guard rails that matter:
 *   • a merchant can only assign MANAGER or STAFF — never OWNER, and certainly
 *     never SUPER_ADMIN, so privilege escalation through this endpoint is
 *     structurally impossible
 *   • extra permissions are intersected with what the merchant's own role holds,
 *     so an OWNER cannot grant a capability they do not themselves have
 */
@Injectable()
export class StaffService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly passwords: PasswordService,
    private readonly memberships: MembershipService,
    private readonly entitlements: EntitlementsService,
    private readonly queue: QueueService,
    private readonly context: RequestContextService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('StaffService');
  }

  async list(): Promise<StaffMember[]> {
    const tenantId = this.tenantDb.tenantId;

    const rows = await this.master.tenantUser.findMany({
      where: { tenantId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            lastLoginAt: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      userId: row.user.id,
      email: row.user.email,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      fullName: `${row.user.firstName} ${row.user.lastName}`.trim(),
      phone: row.user.phone,
      role: row.role,
      permissions: permissionsForRole(row.role as Role, row.extraPermissions),
      extraPermissions: row.extraPermissions,
      isActive: row.isActive,
      lastLoginAt: row.user.lastLoginAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async invite(input: InviteStaffInput): Promise<StaffMember & { temporaryPassword?: string }> {
    const tenantId = this.tenantDb.tenantId;
    const email = input.email.toLowerCase().trim();

    if (!ASSIGNABLE_STAFF_ROLES.includes(input.role as Role)) {
      throw Errors.forbidden('You can only invite managers and staff');
    }

    const currentCount = await this.master.tenantUser.count({
      where: { tenantId, isActive: true },
    });
    await this.entitlements.assertWithinLimit(tenantId, LimitKey.MAX_STAFF, currentCount);

    const extraPermissions = this.filterGrantablePermissions(input.extraPermissions ?? []);

    // An existing platform user is reused: one person can work at two stores
    // with a single login, which is the whole point of master-side identity.
    let user = await this.master.user.findUnique({ where: { email } });
    let temporaryPassword: string | undefined;

    if (!user) {
      temporaryPassword = this.passwords.generateTemporary();
      user = await this.master.user.create({
        data: {
          email,
          phone: input.phone ? normalisePhone(input.phone) : null,
          passwordHash: await this.passwords.hash(temporaryPassword),
          firstName: input.firstName.trim(),
          lastName: input.lastName?.trim() ?? '',
          userType: 'MERCHANT',
        },
      });
    }

    const existingMembership = await this.master.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
    });
    if (existingMembership?.isActive) {
      throw Errors.duplicate('team member', 'email');
    }

    const membership = await this.master.tenantUser.upsert({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      create: {
        tenantId,
        userId: user.id,
        role: input.role,
        extraPermissions,
        isActive: true,
        invitedByUserId: this.context.userId,
        joinedAt: new Date(),
      },
      update: {
        role: input.role,
        extraPermissions,
        isActive: true,
        invitedByUserId: this.context.userId,
        joinedAt: new Date(),
      },
    });

    await this.syncProfile(tenantId, {
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: input.role,
      isActive: true,
    });

    await this.memberships.invalidate(user.id, tenantId);

    await this.queue.notify({
      tenantId,
      template: 'staff.invite',
      channels: ['EMAIL'],
      email: user.email,
      data: {
        firstName: user.firstName,
        role: input.role,
        consoleUrl: this.config.adminConsoleUrl,
        temporaryPassword,
      },
    });

    this.audit.record('both', {
      action: AuditAction.STAFF_INVITED,
      resourceType: 'staff',
      resourceId: user.id,
      metadata: { email, role: input.role },
    });

    this.logger.info('Staff member invited', { tenantId, userId: user.id, role: input.role });

    return {
      id: membership.id,
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      phone: user.phone,
      role: membership.role,
      permissions: permissionsForRole(membership.role as Role, membership.extraPermissions),
      extraPermissions: membership.extraPermissions,
      isActive: membership.isActive,
      lastLoginAt: null,
      createdAt: membership.createdAt.toISOString(),
      // Shown once, in the invite response, so the owner can pass it on.
      temporaryPassword,
    };
  }

  async update(
    membershipId: string,
    input: { role?: 'MANAGER' | 'STAFF'; extraPermissions?: string[]; isActive?: boolean },
  ): Promise<StaffMember> {
    const tenantId = this.tenantDb.tenantId;

    const membership = await this.master.tenantUser.findFirst({
      where: { id: membershipId, tenantId },
      include: { user: true },
    });
    if (!membership) throw Errors.notFound('Team member', membershipId);

    // The owner is the account's anchor; demoting or disabling them through the
    // staff screen would be a way to lock a store out of itself.
    if (membership.role === 'OWNER') {
      throw Errors.forbidden('The store owner cannot be modified here');
    }
    if (membership.userId === this.context.userId) {
      throw Errors.forbidden('You cannot change your own role');
    }

    const updated = await this.master.tenantUser.update({
      where: { id: membershipId },
      data: {
        ...(input.role ? { role: input.role } : {}),
        ...(input.extraPermissions
          ? { extraPermissions: this.filterGrantablePermissions(input.extraPermissions) }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      include: { user: true },
    });

    await this.syncProfile(tenantId, {
      userId: updated.userId,
      email: updated.user.email,
      firstName: updated.user.firstName,
      lastName: updated.user.lastName,
      phone: updated.user.phone,
      role: updated.role,
      isActive: updated.isActive,
    });

    await this.memberships.invalidate(updated.userId, tenantId);

    this.audit.record('both', {
      action: AuditAction.STAFF_UPDATED,
      resourceType: 'staff',
      resourceId: updated.userId,
      metadata: { role: updated.role, isActive: updated.isActive },
    });

    return {
      id: updated.id,
      userId: updated.userId,
      email: updated.user.email,
      firstName: updated.user.firstName,
      lastName: updated.user.lastName,
      fullName: `${updated.user.firstName} ${updated.user.lastName}`.trim(),
      phone: updated.user.phone,
      role: updated.role,
      permissions: permissionsForRole(updated.role as Role, updated.extraPermissions),
      extraPermissions: updated.extraPermissions,
      isActive: updated.isActive,
      lastLoginAt: updated.user.lastLoginAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  /**
   * Removes a staff member from this store.
   *
   * The membership is deleted, not the user: they may still work at another
   * merchant, and their name must remain resolvable on past orders.
   */
  async remove(membershipId: string): Promise<void> {
    const tenantId = this.tenantDb.tenantId;

    const membership = await this.master.tenantUser.findFirst({
      where: { id: membershipId, tenantId },
    });
    if (!membership) throw Errors.notFound('Team member', membershipId);
    if (membership.role === 'OWNER') {
      throw Errors.forbidden('The store owner cannot be removed');
    }
    if (membership.userId === this.context.userId) {
      throw Errors.forbidden('You cannot remove yourself');
    }

    await this.master.tenantUser.delete({ where: { id: membershipId } });
    await this.memberships.invalidate(membership.userId, tenantId);

    await this.tenantDb
      .run((db) =>
        db.staffProfile.updateMany({
          where: { userId: membership.userId },
          data: { isActive: false },
        }),
      )
      .catch(() => undefined);

    this.audit.record('both', {
      action: AuditAction.STAFF_REMOVED,
      resourceType: 'staff',
      resourceId: membership.userId,
    });
  }

  /** Keeps the tenant-side read-model in step with the master membership. */
  async syncProfile(
    tenantId: string,
    profile: {
      userId: string;
      email: string;
      firstName: string;
      lastName: string;
      phone: string | null;
      role: string;
      isActive: boolean;
    },
  ): Promise<void> {
    await this.tenantDb
      .runFor(tenantId, (db) =>
        db.staffProfile.upsert({
          where: { userId: profile.userId },
          create: profile,
          update: profile,
        }),
      )
      .catch((err) =>
        // A mirror failure must not break the authoritative master-side write.
        this.logger.warn('Failed to sync staff profile into tenant DB', {
          tenantId,
          userId: profile.userId,
          error: (err as Error).message,
        }),
      );
  }

  /**
   * Prevents privilege escalation: you cannot grant what you do not hold.
   * A super admin is exempt because they hold everything by definition.
   */
  private filterGrantablePermissions(requested: string[]): string[] {
    const auth = this.context.auth;
    if (!auth) return [];
    if (auth.isSuperAdmin) return requested;
    return requested.filter((p) => auth.permissions.includes(p));
  }
}
