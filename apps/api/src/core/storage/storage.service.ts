import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import { AppLogger } from '@/core/logger/logger.service';
import { STORAGE_PROVIDER_TOKEN, type StorageProvider } from './storage.provider';

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

/** Everything the application stores lives under this prefix. */
const TENANT_ROOT = 'tenants';

/**
 * The application-facing storage API.
 *
 * Business modules depend on this class and never on MinIO or S3 — the backend
 * arrives as an injected `StorageProvider`, chosen once by the module factory
 * from configuration.
 *
 * Three things here are security-relevant rather than incidental:
 *
 *  1. **Content sniffing.** The declared `Content-Type` on an upload is a client
 *     claim. We check the file's magic number too, so a `.jpg` that is really
 *     an HTML file (a stored-XSS vector when served from the media domain) is
 *     rejected.
 *  2. **Tenant-prefixed keys.** Objects live under `tenants/<tenantId>/…`, which
 *     keeps one merchant's media from colliding with another's and makes a
 *     per-tenant bucket policy or a full tenant purge trivial.
 *  3. **Ownership checks on every keyed operation.** A tenant-prefixed key is
 *     only a convention until something enforces it. Every method that takes a
 *     key takes the acting tenant with it and refuses keys belonging to anyone
 *     else — knowing another tenant's object path must not be enough to read,
 *     replace, delete or sign a URL for it.
 */
@Injectable()
export class StorageService {
  private readonly logger: AppLogger;

  constructor(
    private readonly config: AppConfigService,
    @Inject(STORAGE_PROVIDER_TOKEN) private readonly provider: StorageProvider,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('Storage');
  }

  /** Which backend is actually in use — for health output and logs. */
  get providerName(): string {
    return this.provider.name;
  }

  async upload(input: UploadInput): Promise<StoredObject> {
    this.validate(input);

    const key = this.buildKey(input);
    await this.provider.put({
      key,
      body: input.buffer,
      mimeType: input.mimeType,
    });

    const stored: StoredObject = {
      key,
      url: this.provider.publicUrl(key),
      size: input.buffer.length,
      mimeType: input.mimeType,
    };

    this.logger.debug('Stored object', {
      key,
      size: stored.size,
      tenantId: input.tenantId,
      provider: this.provider.name,
    });
    return stored;
  }

  /** Reads an object the tenant owns. Returns null when it does not exist. */
  async get(tenantId: string, key: string): Promise<Buffer | null> {
    this.assertOwnership(tenantId, key);
    return this.provider.get(key);
  }

  async exists(tenantId: string, key: string): Promise<boolean> {
    this.assertOwnership(tenantId, key);
    return this.provider.exists(key);
  }

  async delete(tenantId: string, key: string): Promise<void> {
    this.assertOwnership(tenantId, key);
    try {
      await this.provider.delete(key);
    } catch (err) {
      // A failed delete leaves an orphaned object, which is a cleanup problem,
      // not a request failure — the caller has already removed the reference.
      this.logger.warn('Failed to delete object', { key, error: (err as Error).message });
    }
  }

  /** Public URL for an object the tenant owns. */
  publicUrl(tenantId: string, key: string): string {
    this.assertOwnership(tenantId, key);
    return this.provider.publicUrl(key);
  }

  /** Time-limited URL, for anything that should not be publicly listable. */
  async signedUrl(tenantId: string, key: string, expiresInSeconds = 900): Promise<string> {
    this.assertOwnership(tenantId, key);
    return this.provider.signedUrl(key, expiresInSeconds);
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return this.provider.healthCheck();
  }

  // ------------------------------------------------------------ internals --

  /**
   * The storage half of tenant isolation.
   *
   * Keys are handed back to clients in API responses, so a merchant can read
   * one off their own product and try it against another store. Prefixing keys
   * is not a control by itself; this is.
   *
   * `NOT_FOUND` rather than `FORBIDDEN` on a mismatch, matching how the rest of
   * the API answers cross-tenant reads: a 403 would confirm that the object
   * exists somewhere, which is exactly what the caller was probing for.
   */
  private assertOwnership(tenantId: string, key: string): void {
    if (!tenantId) throw Errors.internal('Storage access attempted without a tenant');

    const normalised = key.replace(/\\/g, '/').replace(/^\/+/, '');

    // `..` can only be an attempt to climb out of the tenant prefix.
    if (normalised.split('/').includes('..')) {
      this.logger.warn('Rejected traversal in a storage key', { tenantId });
      throw Errors.notFound('File not found');
    }

    const expected = `${TENANT_ROOT}/${tenantId}/`;
    if (!normalised.startsWith(expected)) {
      this.logger.warn('Rejected cross-tenant storage access', {
        tenantId,
        // The key itself is another tenant's identifier; log that it happened,
        // not what was asked for.
        keyPrefix: normalised.split('/').slice(0, 2).join('/'),
      });
      throw Errors.notFound('File not found');
    }
  }

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
    // Built by hand rather than with path.join: keys are URLs, and join would
    // produce backslashes on Windows.
    return `${TENANT_ROOT}/${input.tenantId}/${folder}/${hash}-${randomUUID().slice(0, 8)}${ext}`;
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
