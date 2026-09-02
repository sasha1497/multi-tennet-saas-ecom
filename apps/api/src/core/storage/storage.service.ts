import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { Global, Injectable, Module } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigModule, AppConfigService } from '@/config/config.module';
import { Errors } from '@/common/errors/app.exception';
import { AppLogger } from '@/core/logger/logger.service';

export interface UploadInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  /** Tenant id — every object is stored under `tenants/<id>/…`. */
  tenantId: string;
  folder?: string;
}

export interface StoredObject {
  key: string;
  url: string;
  size: number;
  mimeType: string;
}

/** Magic-number prefixes for the image types we accept. */
const MAGIC_NUMBERS: { mime: string; bytes: number[]; offset?: number }[] = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { mime: 'image/avif', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
];

/**
 * S3-compatible object storage, with a local-disk driver for development.
 *
 * Two things here are security-relevant rather than incidental:
 *
 *  1. **Content sniffing.** The declared `Content-Type` on an upload is a client
 *     claim. We check the file's magic number too, so a `.jpg` that is really
 *     an HTML file (a stored-XSS vector when served from the media domain)
 *     is rejected.
 *  2. **Tenant-prefixed keys.** Objects live under `tenants/<tenantId>/…`, which
 *     keeps one merchant's media from colliding with another's and makes a
 *     per-tenant bucket policy or a full tenant purge trivial later.
 */
@Injectable()
export class StorageService {
  private readonly logger: AppLogger;
  private readonly s3: S3Client | null;

  constructor(
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('Storage');

    if (config.storage.driver === 's3') {
      this.s3 = new S3Client({
        region: config.storage.region,
        endpoint: config.storage.endpoint,
        forcePathStyle: config.storage.forcePathStyle,
        credentials:
          config.storage.accessKey && config.storage.secretKey
            ? { accessKeyId: config.storage.accessKey, secretAccessKey: config.storage.secretKey }
            : undefined,
      });
    } else {
      this.s3 = null;
      this.logger.warn('Using the local storage driver; uploads will not survive a container rebuild');
    }
  }

  async upload(input: UploadInput): Promise<StoredObject> {
    this.validate(input);

    const key = this.buildKey(input);

    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.config.storage.bucket,
          Key: key,
          Body: input.buffer,
          ContentType: input.mimeType,
          // Long cache lifetime is safe because keys are content-addressed.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } else {
      const path = resolve(this.config.storage.localDir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, input.buffer);
    }

    const stored: StoredObject = {
      key,
      url: this.publicUrl(key),
      size: input.buffer.length,
      mimeType: input.mimeType,
    };

    this.logger.debug('Stored object', { key, size: stored.size, tenantId: input.tenantId });
    return stored;
  }

  async delete(key: string): Promise<void> {
    try {
      if (this.s3) {
        await this.s3.send(
          new DeleteObjectCommand({ Bucket: this.config.storage.bucket, Key: key }),
        );
      } else {
        await unlink(resolve(this.config.storage.localDir, key)).catch(() => undefined);
      }
    } catch (err) {
      this.logger.warn('Failed to delete object', { key, error: (err as Error).message });
    }
  }

  /** Public URL for an object. Media is world-readable by design. */
  publicUrl(key: string): string {
    if (!this.s3) {
      return `/media/${key}`;
    }
    const base = (this.config.storage.publicEndpoint ?? '').replace(/\/+$/, '');
    return this.config.storage.forcePathStyle
      ? `${base}/${this.config.storage.bucket}/${key}`
      : `${base.replace('://', `://${this.config.storage.bucket}.`)}/${key}`;
  }

  /** Time-limited URL, for anything that should not be publicly listable. */
  async signedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    if (!this.s3) return this.publicUrl(key);
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.config.storage.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    if (!this.s3) return { ok: true, message: 'local driver' };
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.config.storage.bucket }));
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  // ------------------------------------------------------------ internals --

  private validate(input: UploadInput): void {
    if (input.buffer.length === 0) {
      throw Errors.badRequest('The uploaded file is empty');
    }
    if (input.buffer.length > this.config.storage.maxFileSize) {
      const mb = Math.round(this.config.storage.maxFileSize / 1024 / 1024);
      throw Errors.badRequest(`File is too large. The maximum size is ${mb} MB.`);
    }
    if (!this.config.storage.allowedMime.includes(input.mimeType)) {
      throw Errors.badRequest(
        `Unsupported file type. Allowed: ${this.config.storage.allowedMime.join(', ')}`,
      );
    }
    if (!this.matchesMagicNumber(input.buffer, input.mimeType)) {
      // The extension and header said one thing; the bytes said another.
      throw Errors.badRequest('File content does not match its declared type');
    }
  }

  private matchesMagicNumber(buffer: Buffer, mimeType: string): boolean {
    const spec = MAGIC_NUMBERS.find((m) => m.mime === mimeType);
    if (!spec) return false;
    const offset = spec.offset ?? 0;
    if (buffer.length < offset + spec.bytes.length) return false;
    return spec.bytes.every((byte, i) => buffer[offset + i] === byte);
  }

  /**
   * `tenants/<tenantId>/<folder>/<hash>-<uuid>.<ext>`
   *
   * The content hash makes re-uploading the same image cheap to spot, and the
   * uuid keeps two tenants uploading the same stock photo from sharing a key.
   */
  private buildKey(input: UploadInput): string {
    const hash = createHash('sha256').update(input.buffer).digest('hex').slice(0, 12);
    const ext = this.extensionFor(input.mimeType, input.originalName);
    const folder = (input.folder ?? 'uploads').replace(/[^a-z0-9-]/gi, '').slice(0, 32) || 'uploads';
    return join('tenants', input.tenantId, folder, `${hash}-${randomUUID().slice(0, 8)}${ext}`)
      .split('\\')
      .join('/');
  }

  private extensionFor(mimeType: string, originalName: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/avif': '.avif',
    };
    if (map[mimeType]) return map[mimeType];
    // Never trust an arbitrary extension from the client.
    const ext = extname(originalName).toLowerCase();
    return /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : '.bin';
  }
}

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
