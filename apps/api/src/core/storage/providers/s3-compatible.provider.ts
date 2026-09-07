import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PutObjectInput, StorageProvider } from '../storage.provider';

export interface S3CompatibleOptions {
  bucket: string;
  region: string;
  /** API endpoint the *server* talks to. Undefined means real AWS S3. */
  endpoint?: string;
  /** Endpoint a *browser* can reach. Differs from `endpoint` under Docker. */
  publicEndpoint?: string;
  accessKey?: string;
  secretKey?: string;
  /** MinIO needs path style; AWS S3 prefers virtual-host style. */
  forcePathStyle: boolean;
}

/**
 * Shared implementation for every S3-compatible backend.
 *
 * MinIO speaks the S3 protocol, so AWS S3 and MinIO differ only in
 * configuration — endpoint, addressing style and how credentials are supplied.
 * Writing two independent clients would duplicate the interesting code (magic
 * numbers, signing, error handling) and let the two drift apart, so the
 * behaviour lives here once and the subclasses supply configuration.
 *
 * They remain separate classes because they have genuinely different
 * credential and URL rules, and because `STORAGE_PROVIDER=s3` failing over to
 * MinIO semantics in production would be a silent, expensive mistake.
 */
export abstract class S3CompatibleProvider implements StorageProvider {
  abstract readonly name: string;

  protected readonly client: S3Client;

  constructor(protected readonly options: S3CompatibleOptions) {
    const config: S3ClientConfig = {
      region: options.region,
      forcePathStyle: options.forcePathStyle,
    };
    if (options.endpoint) config.endpoint = options.endpoint;

    // Omitting credentials entirely is what makes the AWS SDK fall back to the
    // instance/task role. Passing empty strings would defeat that, so the
    // property is only set when both halves are actually present.
    if (options.accessKey && options.secretKey) {
      config.credentials = {
        accessKeyId: options.accessKey,
        secretAccessKey: options.secretKey,
      };
    }

    this.client = new S3Client(config);
  }

  async put(input: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.mimeType,
        CacheControl: input.cacheControl ?? 'public, max-age=31536000, immutable',
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return true;
    } catch (err) {
      if (this.isNotFound(err)) return false;
      throw err;
    }
  }

  publicUrl(key: string): string {
    const base = (this.options.publicEndpoint ?? this.options.endpoint ?? '').replace(/\/+$/, '');
    if (!base) {
      // Real AWS S3 with no explicit endpoint: the canonical virtual-host URL.
      return `https://${this.options.bucket}.s3.${this.options.region}.amazonaws.com/${key}`;
    }
    return this.options.forcePathStyle
      ? `${base}/${this.options.bucket}/${key}`
      : `${base.replace('://', `://${this.options.bucket}.`)}/${key}`;
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }));
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  /** S3 reports a missing key as NoSuchKey/NotFound, or a bare 404. */
  private isNotFound(err: unknown): boolean {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    return (
      e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404
    );
  }
}
