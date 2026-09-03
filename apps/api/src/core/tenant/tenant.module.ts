import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '@/config/config.module';
import { MembershipService } from './membership.service';
import { TenantResolverMiddleware } from './tenant-resolver.middleware';
import { TenantResolverService } from './tenant-resolver.service';

/**
 * Tenant identity: hostname resolution and membership verification.
 *
 * Global because the guards, and almost every feature module, depend on these
 * two services — repeating them in each module's provider list would be noise
 * with an easy failure mode (a missing entry only shows up at boot).
 */
@Global()
@Module({
  imports: [AppConfigModule],
  providers: [TenantResolverService, TenantResolverMiddleware, MembershipService],
  exports: [TenantResolverService, TenantResolverMiddleware, MembershipService],
})
export class TenantModule {}
