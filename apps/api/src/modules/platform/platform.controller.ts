import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { Permission, TokenAudience } from '@retailos/types';
import {
  auditLogQuerySchema,
  changeSubscriptionSchema,
  createTenantSchema,
  platformTenantQuerySchema,
  setEntitlementSchema,
  updateTenantStatusSchema,
  upsertPlanSchema,
} from '@retailos/validation';
import { Audience, RequirePermissions, SuperAdminOnly } from '@/common/decorators';
import { PlatformService } from './platform.service';

class TenantQueryDto extends createZodDto(platformTenantQuerySchema) {}
class CreateTenantDto extends createZodDto(createTenantSchema) {}
class UpdateStatusDto extends createZodDto(updateTenantStatusSchema) {}
class SetEntitlementDto extends createZodDto(setEntitlementSchema) {}
class ChangeSubscriptionDto extends createZodDto(changeSubscriptionSchema) {}
class UpsertPlanDto extends createZodDto(upsertPlanSchema) {}
class UpdatePlanDto extends createZodDto(upsertPlanSchema.partial()) {}
class AuditQueryDto extends createZodDto(auditLogQuerySchema) {}

/**
 * Platform super-admin console.
 *
 * `@SuperAdminOnly()` at the class level, plus explicit `platform.*` permissions
 * per route. Note this controller has **no** `@RequireTenant()`: it operates
 * across the whole fleet, and every tenant it touches is named explicitly in the
 * path — never inferred from a header a caller controls.
 */
@ApiTags('Platform (super admin)')
@Controller('platform')
@Audience(TokenAudience.ADMIN)
@SuperAdminOnly()
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('overview')
  @RequirePermissions(Permission.PLATFORM_TENANTS_READ)
  @ApiOperation({ summary: 'Fleet-wide counts, GMV and system health' })
  overview() {
    return this.platform.overview();
  }

  // ============================================================== tenants ==

  @Get('tenants')
  @RequirePermissions(Permission.PLATFORM_TENANTS_READ)
  @ApiOperation({ summary: 'List every store on the platform' })
  listTenants(@Query() query: TenantQueryDto) {
    return this.platform.listTenants(query);
  }

  @Get('tenants/:id')
  @RequirePermissions(Permission.PLATFORM_TENANTS_READ)
  @ApiOperation({ summary: 'Store detail: placement, owner, plan, jobs and live stats' })
  tenantDetail(@Param('id') id: string) {
    return this.platform.tenantDetail(id);
  }

  @Post('tenants')
  @RequirePermissions(Permission.PLATFORM_TENANTS_MANAGE)
  @ApiOperation({
    summary: 'Create a store on a merchant\'s behalf',
    description: 'Reserves the subdomain and queues database provisioning.',
  })
  createTenant(@Body() dto: CreateTenantDto) {
    return this.platform.createTenant(dto);
  }

  @Post('tenants/:id/status')
  @RequirePermissions(Permission.PLATFORM_TENANTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate, suspend or delete a store',
    description: 'Suspension takes effect immediately: routing caches and pooled connections are dropped.',
  })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.platform.updateTenantStatus(id, dto.status, dto.reason);
  }

  @Post('tenants/:id/provision')
  @RequirePermissions(Permission.PLATFORM_TENANTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run or resume provisioning',
    description:
      'Idempotent: completed steps are skipped, so this is the safe way to recover a ' +
      'partially failed provision.',
  })
  provision(@Param('id') id: string) {
    return this.platform.provision(id);
  }

  @Get('tenants/:id/provisioning-jobs')
  @RequirePermissions(Permission.PLATFORM_TENANTS_READ)
  @ApiOperation({ summary: 'Provisioning history for a store' })
  provisioningJobs(@Param('id') id: string) {
    return this.platform.provisioningJobs(id);
  }

  @Post('tenants/:id/migrate')
  @RequirePermissions(Permission.PLATFORM_TENANTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply pending schema migrations to one tenant database' })
  migrate(@Param('id') id: string) {
    return this.platform.migrateTenant(id);
  }

  @Post('tenants/:id/entitlements')
  @RequirePermissions(Permission.PLATFORM_TENANTS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Override a feature for one store',
    description: 'Overrides win over the plan and survive plan changes.',
  })
  async setEntitlement(@Param('id') id: string, @Body() dto: SetEntitlementDto): Promise<void> {
    await this.platform.setEntitlement(id, dto);
  }

  @Post('tenants/:id/subscription')
  @RequirePermissions(Permission.PLATFORM_TENANTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move a store to another plan' })
  changeSubscription(@Param('id') id: string, @Body() dto: ChangeSubscriptionDto) {
    return this.platform.changeSubscription(id, dto.planCode);
  }

  // ================================================================ plans ==

  @Get('plans')
  @RequirePermissions(Permission.PLATFORM_PLANS_MANAGE)
  listPlans() {
    return this.platform.listPlans();
  }

  @Post('plans')
  @RequirePermissions(Permission.PLATFORM_PLANS_MANAGE)
  createPlan(@Body() dto: UpsertPlanDto) {
    return this.platform.upsertPlan(dto);
  }

  @Patch('plans/:id')
  @RequirePermissions(Permission.PLATFORM_PLANS_MANAGE)
  updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.platform.updatePlan(id, dto as never);
  }

  @Delete('plans/:id')
  @RequirePermissions(Permission.PLATFORM_PLANS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePlan(@Param('id') id: string): Promise<void> {
    await this.platform.deletePlan(id);
  }

  // ================================================================== ops ==

  @Get('audit-logs')
  @RequirePermissions(Permission.PLATFORM_AUDIT_READ)
  @ApiOperation({ summary: 'Platform audit trail' })
  auditLogs(@Query() query: AuditQueryDto) {
    return this.platform.auditLogs(query);
  }

  @Get('system/health')
  @RequirePermissions(Permission.PLATFORM_SYSTEM_READ)
  @ApiOperation({ summary: 'Per-service health, pool usage and tenant schema drift' })
  systemHealth() {
    return this.platform.systemHealth();
  }

  @Get('system/queues')
  @RequirePermissions(Permission.PLATFORM_SYSTEM_READ)
  @ApiOperation({ summary: 'Background queue depths' })
  queues() {
    return this.platform.queueStats();
  }
}
