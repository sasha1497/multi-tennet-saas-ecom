import { Global, Module } from '@nestjs/common';
import { TenantDeletionService } from './tenant-deletion.service';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantsService } from './tenants.service';

@Global()
@Module({
  providers: [TenantsService, TenantProvisioningService, TenantDeletionService],
  exports: [TenantsService, TenantProvisioningService, TenantDeletionService],
})
export class TenantsModule {}
