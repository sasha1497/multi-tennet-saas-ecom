import { Global, Module, type Provider } from '@nestjs/common';
import { AppConfigModule, AppConfigService } from '@/config/config.module';
import { AppLogger } from '@/core/logger/logger.service';
import { MediaUrlService } from './media-url.service';
import { LocalStorageProvider } from './providers/local.provider';
import { MinioStorageProvider } from './providers/minio.provider';
import { S3StorageProvider } from './providers/s3.provider';
import { StorageService } from './storage.service';
import { STORAGE_PROVIDER_TOKEN, type StorageProvider } from './storage.provider';

/**
 * The one place that decides which storage backend the application talks to.
 *
 * Everything else injects `StorageService`. This factory is the only code that
 * knows MinIO or S3 exist, which is what makes the deployment target a
 * configuration change rather than a code change.
 */
const storageProviderFactory: Provider = {
  provide: STORAGE_PROVIDER_TOKEN,
  inject: [AppConfigService, AppLogger],
  useFactory: (config: AppConfigService, logger: AppLogger): StorageProvider => {
    const log = logger.withContext('Storage');
    const s = config.storage;

    switch (s.provider) {
      case 'minio': {
        const provider = new MinioStorageProvider({
          bucket: s.bucket,
          region: s.region,
          endpoint: s.endpoint,
          publicEndpoint: s.publicEndpoint,
          accessKey: s.accessKey,
          secretKey: s.secretKey,
        });
        log.info('Storage provider: MinIO', { bucket: s.bucket, endpoint: s.endpoint });
        return provider;
      }

      case 's3': {
        const provider = new S3StorageProvider({
          bucket: s.bucket,
          region: s.region,
          endpoint: s.endpoint,
          publicEndpoint: s.publicEndpoint,
          accessKey: s.accessKey,
          secretKey: s.secretKey,
          forcePathStyle: s.endpoint ? s.forcePathStyle : false,
        });
        log.info('Storage provider: AWS S3', {
          bucket: s.bucket,
          region: s.region,
          // Worth stating plainly in the logs: a role is the preferred setup,
          // so it should be visible which one is actually in play.
          credentials: s.accessKey ? 'static keys' : 'IAM role / instance profile',
        });
        return provider;
      }

      default: {
        /**
         * Local disk is not a storage backend for user uploads — it is not
         * shared between replicas, does not survive a rebuild, and cannot
         * presign anything. It stays available for unit tests and for running
         * with no Docker, but only when someone asked for it in as many words.
         */
        if (!s.allowLocal) {
          throw new Error(
            'STORAGE_PROVIDER=local stores uploads on the application filesystem, which is not ' +
              'supported: files would not survive a restart and would not be visible to other ' +
              'replicas. Run MinIO locally (`pnpm docker:up:infra`) and set STORAGE_PROVIDER=minio, ' +
              'or set STORAGE_ALLOW_LOCAL=true if this is a throwaway test process.',
          );
        }
        log.warn(
          'Storage provider: local disk — uploads will not survive a container rebuild, are not ' +
            'shared between replicas, and direct uploads are unavailable',
        );
        return new LocalStorageProvider(s.localDir);
      }
    }
  },
};

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [storageProviderFactory, StorageService, MediaUrlService],
  exports: [StorageService, MediaUrlService, STORAGE_PROVIDER_TOKEN],
})
export class StorageModule {}
