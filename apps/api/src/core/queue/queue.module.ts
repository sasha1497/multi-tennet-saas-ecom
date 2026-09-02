import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@retailos/config';
import { AppConfigModule, AppConfigService } from '@/config/config.module';
import { buildRedisOptions } from '@/core/cache/cache.service';
import { QueueService } from './queue.service';

const QUEUES = Object.values(QUEUE_NAMES);

/**
 * BullMQ wiring, shared by the API (producers) and the worker (consumers).
 *
 * `prefix` namespaces every key so several environments can share one Redis
 * instance without colliding — which is exactly what the cheap single-VM
 * deployment in docs/STARTUP_DEPLOYMENT.md does.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: buildRedisOptions(config),
        prefix: `{${config.queue.prefix}}`,
        defaultJobOptions: {
          attempts: config.queue.attempts,
          backoff: { type: 'exponential', delay: config.queue.backoffMs },
          removeOnComplete: { age: 3600, count: 500 },
          removeOnFail: { age: 86_400, count: 1000 },
        },
      }),
    }),
    ...QUEUES.map((name) => BullModule.registerQueue({ name })),
  ],
  providers: [QueueService],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
