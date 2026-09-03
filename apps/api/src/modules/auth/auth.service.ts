import { Injectable } from '@nestjs/common';
import { storefrontUrl } from '@retailos/config';
import {
  AdminSessionResponse,
  AuditAction,
  AuthTokens,
  CustomerProfile,
  PlatformUserProfile,
  Role,
  TenantMembershipSummary,
  TokenAudience,
  permissionsForRole,
} from '@retailos/types';
import {
  type CustomerLoginInput,
  type LoginInput,
  type RegisterCustomerInput,
  type RegisterMerchantInput,
  normalisePhone,
} from '@retailos/validation';
import { AppConfigService } from '@/config/config.module';
import { Errors } from '@/common/errors/app.exception';
import { RequestContextService } from '@/core/context/request-context';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { AppLogger } from '@/core/logger/logger.service';
import { PasswordService } from '@/core/security/password.service';
import { MembershipService } from '@/core/tenant/membership.service';
import { AuditService } from '@/modules/audit/audit.service';
import { TenantsService } from '@/modules/tenants/tenants.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly memberships: MembershipService,
    private readonly tenants: TenantsService,
    private readonly config: AppConfigService,
    private readonly context: RequestContextService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('AuthService');
  }

  // =====================================================================
  //  Merchant / platform (audience: admin — identity in the master DB)
  // =====================================================================

  /**
   * Merchant self-signup.
   *
   * Creates the platform user and their tenant, then returns immediately with a
   * token — provisioning continues in the background, so the merchant lands in
   * the console watching a progress screen rather than a spinner on a POST.
   */
  async registerMerchant(input: RegisterMerchantInput) {
    const email = input.email.toLowerCase().trim();
    const phone = normalisePhone(input.phone);

    const existing = await this.master.user.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { id: true, email: true, phone: true },
    });
    if (existing) {
      throw Errors.duplicate('account', existing.email === email ? 'email' : 'phone number');
    }

    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.master.user.create({
      data: {
        email,
        phone,
        passwordHash,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        userType: 'MERCHANT',
        // MVP: the account is usable immediately and verification is a
        // follow-up nudge. See docs/DECISION_LOG.md ADR-012.
        emailVerified: false,
      },
    });

    const tenant = await this.tenants.createTenant({
      name: input.storeName,
      slug: input.storeSlug,
      ownerUserId: user.id,
      contactEmail: email,
      contactPhone: phone,
      businessCategory: input.businessCategory ?? null,
      planCode: input.planCode,
    });

    const tokens = await this.tokens.mint({
      userId: user.id,
      audience: TokenAudience.ADMIN,
      tenantId: tenant.tenantId,
      role: Role.OWNER,
      permissions: permissionsForRole(Role.OWNER),
      email: user.email,
      userAgent: this.context.get()?.userAgent,
      ipAddress: this.context.get()?.ip,
    });

    this.audit.record('platform', {
      action: 'MERCHANT_REGISTERED',
      userId: user.id,
      userEmail: email,
      tenantId: tenant.tenantId,
      resourceType: 'user',
      resourceId: user.id,
    });

    this.logger.info('Merchant registered', { userId: user.id, tenantId: tenant.tenantId });

    return {
      user: this.toUserProfile(user),
      tenant: {
        id: tenant.tenantId,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        storefrontUrl: tenant.storefrontUrl,
      },
      provisioningJobId: tenant.provisioningJobId,
      tokens,
    };
  }

  async login(input: LoginInput): Promise<{ tokens: AuthTokens; session: AdminSessionResponse }> {
    const email = input.email.toLowerCase().trim();
    const user = await this.master.user.findUnique({ where: { email } });

    // Always run a hash comparison, even when the user does not exist, so the
    // response time does not reveal which emails are registered.
    const valid = await this.passwords.verify(input.password, user?.passwordHash ?? null);

    if (!user || !valid) {
      if (user) await this.recordFailedLogin(user.id);
      this.audit.record('platform', {
        action: AuditAction.LOGIN_FAILED,
        userEmail: email,
        userId: user?.id ?? null,
      });
      throw Errors.invalidCredentials();
    }

    if (!user.isActive || user.deletedAt) {
      throw Errors.forbidden('This account has been disabled');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw Errors.forbidden(`Too many failed attempts. Try again in ${minutes} minute(s).`);
    }

    await this.master.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const memberships = await this.memberships.listForUser(user.id);

    // Which store do we drop them into? An explicit request wins, then their
    // default, then the first one they belong to.
    const target = input.tenantSlug
      ? memberships.find((m) => m.tenantSlug === input.tenantSlug)
      : (memberships.find((m) => m.isDefault) ?? memberships[0]);

    if (input.tenantSlug && !target) {
      throw Errors.forbidden('You do not have access to that store');
    }

    const role = user.isSuperAdmin ? Role.SUPER_ADMIN : (target?.role ?? Role.STAFF);
    const permissions = user.isSuperAdmin
      ? permissionsForRole(Role.SUPER_ADMIN)
      : (target?.permissions ?? []);

    if (!user.isSuperAdmin && memberships.length === 0) {
      throw Errors.forbidden('This account is not linked to any store');
    }

    const tokens = await this.tokens.mint({
      userId: user.id,
      audience: TokenAudience.ADMIN,
      tenantId: target?.tenantId ?? null,
      role,
      permissions,
      email: user.email,
      userAgent: this.context.get()?.userAgent,
      ipAddress: this.context.get()?.ip,
    });

    this.audit.record('platform', {
      action: AuditAction.LOGIN,
      userId: user.id,
      userEmail: user.email,
      tenantId: target?.tenantId ?? null,
    });

    return {
      tokens,
      session: {
        user: this.toUserProfile(user),
        memberships: memberships.map((m) => this.toMembershipSummary(m)),
        activeTenantId: target?.tenantId ?? null,
        permissions,
        role,
      },
    };
  }

  async adminSession(userId: string, activeTenantId: string | null): Promise<AdminSessionResponse> {
    const user = await this.master.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || user.deletedAt) throw Errors.unauthenticated();

    const memberships = await this.memberships.listForUser(userId);
    const active = activeTenantId
      ? memberships.find((m) => m.tenantId === activeTenantId)
      : (memberships.find((m) => m.isDefault) ?? memberships[0]);

    const role = user.isSuperAdmin ? Role.SUPER_ADMIN : (active?.role ?? Role.STAFF);

    return {
      user: this.toUserProfile(user),
      memberships: memberships.map((m) => this.toMembershipSummary(m)),
      activeTenantId: active?.tenantId ?? null,
      permissions: user.isSuperAdmin ? permissionsForRole(Role.SUPER_ADMIN) : (active?.permissions ?? []),
      role,
    };
  }

  /**
   * Re-mints a token scoped to a different store.
   *
   * The membership check here is the security boundary: a user can only switch
   * into a tenant they demonstrably belong to.
   */
  async switchTenant(
    userId: string,
    tenantId: string,
  ): Promise<{ tokens: AuthTokens; session: AdminSessionResponse }> {
    const user = await this.master.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw Errors.unauthenticated();

    let role: Role = Role.SUPER_ADMIN;
    let permissions: string[] = permissionsForRole(Role.SUPER_ADMIN);

    if (!user.isSuperAdmin) {
      const membership = await this.memberships.find(userId, tenantId);
      if (!membership) throw Errors.tenantMembershipRequired();
      role = membership.role;
      permissions = membership.permissions;
    }

    const tokens = await this.tokens.mint({
      userId,
      audience: TokenAudience.ADMIN,
      tenantId,
      role,
      permissions,
      email: user.email,
      userAgent: this.context.get()?.userAgent,
      ipAddress: this.context.get()?.ip,
    });

    return { tokens, session: await this.adminSession(userId, tenantId) };
  }

  // =====================================================================
  //  Customers (audience: customer — identity in the tenant DB)
  // =====================================================================

  async registerCustomer(
    tenantId: string,
    input: RegisterCustomerInput,
  ): Promise<{ tokens: AuthTokens; customer: CustomerProfile }> {
    const email = input.email?.toLowerCase().trim() ?? null;
    const phone = input.phone ? normalisePhone(input.phone) : null;

    const customer = await this.tenantDb.runFor(tenantId, async (db) => {
      const existing = await db.customer.findFirst({
        where: {
          OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
        },
        select: { id: true, email: true },
      });
      if (existing) {
        throw Errors.duplicate('account', existing.email === email ? 'email' : 'phone number');
      }

      return db.customer.create({
        data: {
          email,
          phone,
          passwordHash: await this.passwords.hash(input.password),
          firstName: input.firstName.trim(),
          lastName: input.lastName?.trim() ?? '',
        },
      });
    });

    const tokens = await this.tokens.mint({
      userId: customer.id,
      audience: TokenAudience.CUSTOMER,
      tenantId,
      role: Role.CUSTOMER,
      permissions: [],
      email: customer.email,
      userAgent: this.context.get()?.userAgent,
      ipAddress: this.context.get()?.ip,
    });

    this.audit.record('tenant', {
      action: 'CUSTOMER_REGISTERED',
      tenantId,
      userId: customer.id,
      resourceType: 'customer',
      resourceId: customer.id,
    });

    return { tokens, customer: this.toCustomerProfile(customer) };
  }

  async loginCustomer(
    tenantId: string,
    input: CustomerLoginInput,
  ): Promise<{ tokens: AuthTokens; customer: CustomerProfile }> {
    const identifier = input.identifier.trim();
    const asEmail = identifier.toLowerCase();
    const asPhone = normalisePhone(identifier);

    const customer = await this.tenantDb.runFor(tenantId, (db) =>
      db.customer.findFirst({
        where: {
          deletedAt: null,
          OR: [
            { email: asEmail },
            ...(asPhone.length === 10 ? [{ phone: asPhone }] : []),
          ],
        },
      }),
    );

    const valid = await this.passwords.verify(input.password, customer?.passwordHash ?? null);
    if (!customer || !valid) {
      if (customer) {
        await this.tenantDb.runFor(tenantId, (db) =>
          db.customer.update({
            where: { id: customer.id },
            data: { failedLoginAttempts: { increment: 1 } },
          }),
        );
      }
      throw Errors.invalidCredentials();
    }

    if (!customer.isActive) {
      throw Errors.forbidden('This account has been disabled by the store');
    }
    if (customer.lockedUntil && customer.lockedUntil > new Date()) {
      throw Errors.forbidden('Too many failed attempts. Please try again later.');
    }

    await this.tenantDb.runFor(tenantId, (db) =>
      db.customer.update({
        where: { id: customer.id },
        data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      }),
    );

    const tokens = await this.tokens.mint({
      userId: customer.id,
      audience: TokenAudience.CUSTOMER,
      tenantId,
      role: Role.CUSTOMER,
      permissions: [],
      email: customer.email,
      userAgent: this.context.get()?.userAgent,
      ipAddress: this.context.get()?.ip,
    });

    return { tokens, customer: this.toCustomerProfile(customer) };
  }

  async customerProfile(tenantId: string, customerId: string): Promise<CustomerProfile> {
    const customer = await this.tenantDb.runFor(tenantId, (db) =>
      db.customer.findFirst({ where: { id: customerId, deletedAt: null } }),
    );
    if (!customer) throw Errors.unauthenticated();
    return this.toCustomerProfile(customer);
  }

  // =====================================================================
  //  Shared
  // =====================================================================

  /**
   * Refresh + rotation.
   *
   * Permissions are re-read here rather than copied from the old token, so a
   * role change lands on the user's next refresh at the latest.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    return this.tokens.rotate(refreshToken, async (claims) => {
      if (claims.aud === TokenAudience.ADMIN) {
        const user = await this.master.user.findUnique({ where: { id: claims.sub } });
        if (!user || !user.isActive || user.deletedAt) throw Errors.unauthenticated();

        let role: Role = Role.SUPER_ADMIN;
        let permissions: string[] = permissionsForRole(Role.SUPER_ADMIN);

        if (!user.isSuperAdmin) {
          if (!claims.tid) throw Errors.unauthenticated();
          const membership = await this.memberships.find(user.id, claims.tid);
          if (!membership) throw Errors.tenantMembershipRequired();
          role = membership.role;
          permissions = membership.permissions;
        }

        return {
          userId: user.id,
          audience: TokenAudience.ADMIN,
          tenantId: claims.tid,
          role,
          permissions,
          email: user.email,
          userAgent: this.context.get()?.userAgent,
          ipAddress: this.context.get()?.ip,
        };
      }

      if (!claims.tid) throw Errors.unauthenticated();
      const customer = await this.tenantDb.runFor(claims.tid, (db) =>
        db.customer.findFirst({
          where: { id: claims.sub, deletedAt: null, isActive: true },
          select: { id: true, email: true },
        }),
      );
      if (!customer) throw Errors.unauthenticated();

      return {
        userId: customer.id,
        audience: TokenAudience.CUSTOMER,
        tenantId: claims.tid,
        role: Role.CUSTOMER,
        permissions: [],
        email: customer.email,
        userAgent: this.context.get()?.userAgent,
        ipAddress: this.context.get()?.ip,
      };
    });
  }

  async logout(): Promise<void> {
    const auth = this.context.auth;
    if (!auth) return;
    await this.tokens.revokeSession({
      audience: auth.audience,
      tenantId: auth.tokenTenantId,
      sessionId: auth.sessionId,
      userId: auth.userId,
    });
    this.audit.record('platform', {
      action: AuditAction.LOGOUT,
      userId: auth.userId,
      userEmail: auth.email,
    });
  }

  /** Changing a password ends every other session — the expected behaviour. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const auth = this.context.auth;
    if (!auth) throw Errors.unauthenticated();

    if (auth.audience === TokenAudience.ADMIN) {
      const user = await this.master.user.findUnique({ where: { id: auth.userId } });
      if (!user) throw Errors.unauthenticated();
      if (!(await this.passwords.verify(currentPassword, user.passwordHash))) {
        throw Errors.badRequest('Your current password is incorrect');
      }
      await this.master.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.passwords.hash(newPassword) },
      });
    } else {
      const tenantId = auth.tokenTenantId;
      if (!tenantId) throw Errors.unauthenticated();
      const customer = await this.tenantDb.runFor(tenantId, (db) =>
        db.customer.findUnique({ where: { id: auth.userId } }),
      );
      if (!customer) throw Errors.unauthenticated();
      if (!(await this.passwords.verify(currentPassword, customer.passwordHash))) {
        throw Errors.badRequest('Your current password is incorrect');
      }
      const passwordHash = await this.passwords.hash(newPassword);
      await this.tenantDb.runFor(tenantId, (db) =>
        db.customer.update({ where: { id: customer.id }, data: { passwordHash } }),
      );
    }

    await this.tokens.revokeAllForUser({
      audience: auth.audience,
      userId: auth.userId,
      tenantId: auth.tokenTenantId,
    });
  }

  async checkSlug(slug: string) {
    const result = await this.tenants.isSlugAvailable(slug);
    const suggestion = result.available ? undefined : await this.tenants.generateUniqueSlug(slug);
    return {
      slug,
      available: result.available,
      suggestion,
      storefrontUrl: storefrontUrl(result.available ? slug : (suggestion ?? slug), this.config.domain),
    };
  }

  // ------------------------------------------------------------- mappers --

  private toUserProfile(user: {
    id: string;
    email: string;
    phone: string | null;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    userType: string;
    isSuperAdmin: boolean;
    emailVerified: boolean;
    phoneVerified: boolean;
    createdAt: Date;
  }): PlatformUserProfile {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      avatarUrl: user.avatarUrl,
      userType: user.userType as PlatformUserProfile['userType'],
      isSuperAdmin: user.isSuperAdmin,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private toCustomerProfile(customer: {
    id: string;
    email: string | null;
    phone: string | null;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    emailVerified: boolean;
    phoneVerified: boolean;
    createdAt: Date;
  }): CustomerProfile {
    return {
      id: customer.id,
      email: customer.email,
      phone: customer.phone,
      firstName: customer.firstName,
      lastName: customer.lastName,
      fullName: `${customer.firstName} ${customer.lastName}`.trim(),
      avatarUrl: customer.avatarUrl,
      emailVerified: customer.emailVerified,
      phoneVerified: customer.phoneVerified,
      createdAt: customer.createdAt.toISOString(),
    };
  }

  private toMembershipSummary(m: {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    tenantStatus: string;
    role: Role;
    permissions: string[];
    isDefault: boolean;
  }): TenantMembershipSummary {
    return {
      tenantId: m.tenantId,
      tenantName: m.tenantName,
      tenantSlug: m.tenantSlug,
      tenantStatus: m.tenantStatus,
      storefrontUrl: storefrontUrl(m.tenantSlug, this.config.domain),
      logoUrl: null,
      role: m.role,
      permissions: m.permissions,
      isDefault: m.isDefault,
    };
  }

  /** Progressive lockout: N consecutive failures parks the account briefly. */
  private async recordFailedLogin(userId: string): Promise<void> {
    const user = await this.master.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });

    if (user.failedLoginAttempts >= this.config.auth.maxFailedLogins) {
      await this.master.user.update({
        where: { id: userId },
        data: {
          lockedUntil: new Date(Date.now() + this.config.auth.lockoutMinutes * 60_000),
          failedLoginAttempts: 0,
        },
      });
      this.logger.warn('Account locked after repeated failed logins', { userId });
    }
  }
}
