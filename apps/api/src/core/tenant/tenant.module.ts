import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '@/config/config.module';
import { TenantResolverMiddleware } from './tenant-resolver.middleware';
import { TenantResolverService } from './tenant-resolver.service';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [TenantResolverService, TenantResolverMiddleware],
  exports: [TenantResolverService, TenantResolverMiddleware],
})
export class TenantModule {}
