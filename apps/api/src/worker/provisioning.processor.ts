import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES, adminUrl } from '@retailos/config';
import { NotificationTemplate } from '@retailos/types';
import { AppConfigService } from '@/config/config.module';
import { RequestContextService, createRequestContext } from '@/core/context/request-context';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { AppLogger } from '@/core/logger/logger.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { TenantProvisioningService } from '@/modules/tenants/tenant-provisioning.service';
import type { DeprovisionTenantJob, ProvisionTenantJob } from '@/core/queue/queue.types';

/**
 * Tenant provisioning worker.
 *
 * Creating a database, running migrations and seeding takes seconds — far too
 * long to hold an HTTP request open, and it must survive an API restart. Doing
 * it here means a merchant's signup returns instantly while their store builds
 * in the background, and a crashed attempt is retried by BullMQ rather than lost.
 *
 * The provisioner itself is idempotent and takes a distributed lock, so a retry
 * resumes from the last completed step instead of starting over.
 */
@Processor(QUEUE_NAMES.PROVISIONING, { concurrency: 2 })
export class ProvisioningProcessor extends WorkerHost {
  private readonly logger: AppLogger;

  constructor(
    private readonly provisioning: TenantProvisioningService,
    private readonly master: MasterPrismaService,
    private readonly notifications: NotificationsService,
    private readonly context: RequestContextService,
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    super();
    this.logger = logger.withContext('ProvisioningWorker');
  }

  async process(job: Job): Promise<void> {
    const data = job.data as { requestId?: string };

    await this.context.run(
      createRequestContext({
        requestId: data.requestId ?? `job:${job.id}`,
        method: 'JOB',
        path: `${job.queueName}/${job.name}`,
      }),
      async () => {
        switch (job.name) {
          case JOB_NAMES.PROVISION_TENANT:
            return this.provision(job.data as ProvisionTenantJob, job);
          case JOB_NAMES.DEPROVISION_TENANT:
            return this.deprovision(job.data as DeprovisionTenantJob);
          default:
            this.logger.warn('Unknown provisioning job', { name: job.name });
        }
      },
    );
  }

  private async provision(data: ProvisionTenantJob, job: Job): Promise<void> {
    this.logger.info('Provisioning tenant', {
      tenantId: data.tenantId,
      attempt: job.attemptsMade + 1,
    });

    const result = await this.provisioning.provision(data.tenantId, data.jobId);

    const tenant = await this.master.tenant.findUnique({
      where: { id: data.tenantId },
      select: { slug: true, contactEmail: true, owner: { select: { firstName: true } } },
    });

    if (tenant?.contactEmail) {
      await this.notifications.deliver({
        tenantId: data.tenantId,
        template: NotificationTemplate.TENANT_READY,
        channels: ['EMAIL'],
        email: tenant.contactEmail,
        data: {
          firstName: tenant.owner?.firstName ?? 'there',
          consoleUrl: adminUrl(this.config.domain),
        },
      });
    }

    this.logger.info('Tenant provisioning finished', {
      tenantId: data.tenantId,
      steps: result.completedSteps,
      databaseName: result.databaseName,
    });
  }

  private async deprovision(data: DeprovisionTenantJob): Promise<void> {
    // Belt and braces: the queue payload must carry the confirmation string, so
    // a malformed or replayed message can never drop a merchant's database.
    if (data.confirm !== 'DELETE_TENANT_DATA') {
      this.logger.error('Refusing deprovision without explicit confirmation', undefined, {
        tenantId: data.tenantId,
      });
      return;
    }
    await this.provisioning.deprovision(data.tenantId, data.confirm);
  }
}
