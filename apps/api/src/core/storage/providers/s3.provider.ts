import { S3CompatibleProvider, type S3CompatibleOptions } from './s3-compatible.provider';

/**
 * AWS S3 — the production backend.
 *
 * Credentials are optional on purpose: when the deployment runs with an
 * instance profile, an ECS task role or IRSA, omitting them lets the SDK use
 * the role. Long-lived access keys in the environment are the fallback, not the
 * expectation.
 */
export class S3StorageProvider extends S3CompatibleProvider {
  readonly name = 's3';

  constructor(options: Omit<S3CompatibleOptions, 'forcePathStyle'> & { forcePathStyle?: boolean }) {
    super({
      ...options,
      // AWS prefers virtual-host addressing; path style only where asked for.
      forcePathStyle: options.forcePathStyle ?? false,
    });
  }
}
