import { S3CompatibleProvider, type S3CompatibleOptions } from './s3-compatible.provider';

/**
 * MinIO — the local development backend.
 *
 * Two differences from AWS that are not optional: MinIO is reached at an
 * explicit endpoint, and it addresses buckets path-style. It also needs static
 * credentials, since there is no role to assume.
 *
 * `publicEndpoint` matters more than it looks: inside Docker the API reaches
 * MinIO at `http://minio:9000`, but a browser has to be handed a URL it can
 * actually resolve, which is the published host port.
 */
export class MinioStorageProvider extends S3CompatibleProvider {
  readonly name = 'minio';

  constructor(options: Omit<S3CompatibleOptions, 'forcePathStyle'>) {
    if (!options.endpoint) {
      throw new Error('MINIO_ENDPOINT (or S3_ENDPOINT) is required when STORAGE_PROVIDER=minio');
    }
    super({ ...options, forcePathStyle: true });
  }
}
