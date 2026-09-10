import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  ObjectMetadata,
  PresignedUpload,
  PutObjectInput,
  StorageProvider,
} from '../storage.provider';

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

  /**
   * The client every *presigned* URL is generated from.
   *
   * SigV4 signs the Host header, so a URL signed for `http://minio:9000` fails
   * verification the moment a browser sends it to `http://localhost:9100` —
   * which is the only address a browser can reach under Docker. Signing with
   * the public endpoint makes the host in the signature the host the request
   * actually carries. When the two endpoints agree (real AWS, or a deployment
   * where the API and the browser use the same URL) this is the same client.
   */
  protected readonly signingClient: S3Client;

  get bucket(): string {
    return this.options.bucket;
  }

  constructor(protected readonly options: S3CompatibleOptions) {
    this.client = new S3Client(this.clientConfig(options.endpoint));

    const publicEndpoint = options.publicEndpoint ?? options.endpoint;
    this.signingClient =
      publicEndpoint === options.endpoint
        ? this.client
        : new S3Client(this.clientConfig(publicEndpoint));
  }

  private clientConfig(endpoint: string | undefined): S3ClientConfig {
    const config: S3ClientConfig = {
      region: this.options.region,
      forcePathStyle: this.options.forcePathStyle,
    };
    if (endpoint) config.endpoint = endpoint;

    // Omitting credentials entirely is what makes the AWS SDK fall back to the
    // instance/task role. Passing empty strings would defeat that, so the
    // property is only set when both halves are actually present.
    if (this.options.accessKey && this.options.secretKey) {
      config.credentials = {
        accessKeyId: this.options.accessKey,
        secretAccessKey: this.options.secretKey,
      };
    }

    return config;
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

  async getRange(key: string, length: number): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          // Inclusive on both ends, so `length` bytes means `0-(length-1)`.
          Range: `bytes=0-${Math.max(0, length - 1)}`,
        }),
      );
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      return {
        key,
        size: res.ContentLength ?? 0,
        mimeType: res.ContentType ?? 'application/octet-stream',
        etag: res.ETag?.replace(/"/g, ''),
        lastModified: res.LastModified,
      };
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;

    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.options.bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      for (const item of res.Contents ?? []) {
        if (item.Key) keys.push(item.Key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    return keys;
  }

  async deletePrefix(prefix: string): Promise<number> {
    // A prefix that does not end in `/` would also match a sibling whose name
    // merely starts with it — `tenants/abc` matching `tenants/abcdef`. Every
    // caller means "this directory", so require the separator.
    if (!prefix.endsWith('/')) {
      throw new Error(`Refusing to bulk-delete a prefix that is not a directory: ${prefix}`);
    }

    const keys = await this.list(prefix);
    if (keys.length === 0) return 0;

    /**
     * One request per object, not `DeleteObjects`.
     *
     * The batch API is the obvious choice and it is the wrong one here. S3
     * requires a checksum header on `DeleteObjects`, and which checksum the SDK
     * sends has changed between versions — recent releases default to CRC32,
     * which MinIO rejects with "Missing required header for this request:
     * Content-Md5". So the batch call works against AWS and fails against the
     * S3-compatible service every developer runs locally, which is the worst
     * possible place for a compatibility difference to live: the most
     * destructive operation in the system, exercised least often.
     *
     * Individual deletes have no checksum requirement and behave identically on
     * every implementation. The cost is request count on an operation that runs
     * once in a tenant's lifetime, and the concurrency below keeps even a large
     * tenant to a few seconds.
     */
    const CONCURRENCY = 16;
    const failures: string[] = [];

    for (let i = 0; i < keys.length; i += CONCURRENCY) {
      const window = keys.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(window.map((key) => this.delete(key)));
      results.forEach((result, index) => {
        if (result.status === 'rejected') failures.push(window[index]);
      });
    }

    // A partial failure must not be reported as a clean purge — the caller
    // records the step as failed and retries it, and a retry re-lists so
    // anything already gone is simply not found again.
    if (failures.length > 0) {
      throw new Error(
        `Failed to delete ${failures.length} of ${keys.length} object(s) under ${prefix}`,
      );
    }

    return keys.length;
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
      this.signingClient,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async signedUploadUrl(
    key: string,
    mimeType: string,
    expiresInSeconds: number,
  ): Promise<PresignedUpload> {
    // Content-Type is signed, so the browser MUST send exactly this value. That
    // is deliberate: it stops a caller who was granted a URL for a .webp from
    // uploading an HTML document under the same key. It is not sufficient on
    // its own — `StorageService.finalise` re-sniffs the stored bytes — but it
    // makes the cheap attack fail at the object store.
    const url = await getSignedUrl(
      this.signingClient,
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
      { expiresIn: expiresInSeconds },
    );

    return {
      url,
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      expiresInSeconds,
    };
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
