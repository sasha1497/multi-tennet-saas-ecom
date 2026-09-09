import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import { AppLogger } from '@/core/logger/logger.service';
import {
  STORAGE_PROVIDER_TOKEN,
  type ObjectMetadata,
  type StorageProvider,
} from './storage.provider';

export interface UploadInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  /** Tenant id — every object is stored under `tenants/<id>/…`. */
  tenantId: string;
  folder?: string;
  /** Groups a product's media under its own sub-prefix, so deletes are exact. */
  productId?: string;
}

export interface StoredObject {
  key: string;
  url: string;
  size: number;
  mimeType: string;
  bucket: string;
  fileName: string;
}

/** One file a client says it is about to upload. */
export interface UploadIntent {
  fileName: string;
  mimeType: string;
  size: number;
}

export interface PresignUploadInput {
  tenantId: string;
  files: UploadIntent[];
  folder?: string;
  productId?: string;
}

/** A presigned PUT the browser can use, plus the key to confirm afterwards. */
export interface UploadTicket {
  /** Echoed back so the client can match a ticket to the file it picked. */
  fileName: string;
  objectKey: string;
  bucket: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
}

/** Magic-number prefixes for the image types we accept. */
const MAGIC_NUMBERS: { mime: string; bytes: number[]; offset?: number }[] = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { mime: 'image/avif', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
];

/**
 * How many bytes to pull back when sniffing a directly-uploaded object.
 * Comfortably past the longest prefix above (AVIF's, at offset 4 + 4 bytes).
 */
const MAGIC_SNIFF_BYTES = 16;

/**
 * Accepted extensions per MIME type. The first entry is the one we mint.
 *
 * Used three ways: to build a key, to reject a client whose file name and
 * declared type disagree, and to recover the type of an already-stored object
 * from its key alone.
 */
const EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/avif': ['.avif'],
};

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

  get bucket(): string {
    return this.provider.bucket;
  }

  /** False for the local driver, which has no endpoint a browser could PUT to. */
  get supportsDirectUpload(): boolean {
    return this.provider.name !== 'local';
  }

  /** How many images one product may hold. Enforced here and in the schema. */
  get maxFilesPerRequest(): number {
    return this.config.storage.maxFilesPerRequest;
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
      url: await this.readUrl(input.tenantId, key),
      size: input.buffer.length,
      mimeType: input.mimeType,
      bucket: this.provider.bucket,
      fileName: safeFileName(input.originalName),
    };

    this.logger.debug('Stored object', {
      key,
      size: stored.size,
      tenantId: input.tenantId,
      provider: this.provider.name,
    });
    return stored;
  }

  // --------------------------------------------------------- direct upload --

  /**
   * Issues presigned PUTs so a browser uploads straight to the object store.
   *
   * Everything that can be checked *before* the bytes exist is checked here —
   * count, declared type, declared size, and the tenant the key will live
   * under. What cannot be checked yet is the content itself, which is why
   * `finalise` exists and why nothing is recorded in the database until it has
   * run: an issued ticket is a permission to write one specific key, not a
   * product image.
   */
  async presignUploads(input: PresignUploadInput): Promise<UploadTicket[]> {
    if (!input.tenantId) throw Errors.internal('Storage access attempted without a tenant');
    if (!this.supportsDirectUpload) {
      throw Errors.badRequest('This deployment does not support direct uploads');
    }
    if (input.files.length === 0) throw Errors.badRequest('No files were requested');
    if (input.files.length > this.config.storage.maxFilesPerRequest) {
      throw Errors.badRequest(
        `Too many files at once. The maximum is ${this.config.storage.maxFilesPerRequest}.`,
      );
    }

    const expiry = this.config.storage.presignedUrlExpiry;
    const expiresAt = new Date(Date.now() + expiry * 1000).toISOString();

    return Promise.all(
      input.files.map(async (file) => {
        this.validateDeclared(file);

        const key = this.buildKey({
          tenantId: input.tenantId,
          folder: input.folder,
          productId: input.productId,
          mimeType: file.mimeType,
          originalName: file.fileName,
        });

        const signed = await this.provider.signedUploadUrl(key, file.mimeType, expiry);

        return {
          fileName: safeFileName(file.fileName),
          objectKey: key,
          bucket: this.provider.bucket,
          uploadUrl: signed.url,
          headers: signed.headers,
          expiresAt,
        };
      }),
    );
  }

  /**
   * Confirms a direct upload actually landed, and that what landed is an image.
   *
   * The client tells us the upload finished; that claim is worth nothing on its
   * own. This re-reads the object's real size from the store and sniffs its
   * first bytes, so a ticket issued for a `.webp` cannot be redeemed for a
   * polyglot HTML file — the stored-XSS vector the multipart path already
   * guards against. Only 16 bytes are pulled back, not the whole image.
   */
  async finalise(tenantId: string, key: string, fileName?: string): Promise<StoredObject> {
    this.assertOwnership(tenantId, key);

    const meta = await this.provider.head(key);
    if (!meta) throw Errors.badRequest('The upload did not complete — no object was stored');

    if (meta.size === 0) {
      await this.provider.delete(key).catch(() => undefined);
      throw Errors.badRequest('The uploaded file is empty');
    }
    if (meta.size > this.config.storage.maxFileSize) {
      // The presigned PUT cannot enforce a size cap on its own, so an oversized
      // body is caught here and removed rather than left billing the bucket.
      await this.provider.delete(key).catch(() => undefined);
      const mb = Math.round(this.config.storage.maxFileSize / 1024 / 1024);
      throw Errors.badRequest(`File is too large. The maximum size is ${mb} MB.`);
    }

    const mimeType = this.mimeForKey(key, meta);
    if (!this.config.storage.allowedMime.includes(mimeType)) {
      await this.provider.delete(key).catch(() => undefined);
      throw Errors.badRequest(
        `Unsupported file type. Allowed: ${this.config.storage.allowedMime.join(', ')}`,
      );
    }

    const head = await this.provider.getRange(key, MAGIC_SNIFF_BYTES);
    if (!head || !this.matchesMagicNumber(head, mimeType)) {
      await this.provider.delete(key).catch(() => undefined);
      this.logger.warn('Rejected a direct upload whose bytes did not match its type', {
        tenantId,
        mimeType,
      });
      throw Errors.badRequest('File content does not match its declared type');
    }

    return {
      key,
      url: await this.readUrl(tenantId, key),
      size: meta.size,
      mimeType,
      bucket: this.provider.bucket,
      fileName: safeFileName(fileName ?? key.split('/').pop() ?? 'upload'),
    };
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

  /** Size/type of an object the tenant owns, or null when it is gone. */
  async head(tenantId: string, key: string): Promise<ObjectMetadata | null> {
    this.assertOwnership(tenantId, key);
    return this.provider.head(key);
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

  /**
   * Deletes several of the tenant's objects. Ownership is checked per key, so
   * one foreign key in the list aborts the whole call rather than being
   * skipped quietly — a mixed-tenant batch is a bug worth surfacing.
   */
  async deleteMany(tenantId: string, keys: readonly string[]): Promise<void> {
    for (const key of keys) this.assertOwnership(tenantId, key);
    await Promise.all(keys.map((key) => this.delete(tenantId, key)));
  }

  /**
   * Removes everything a tenant ever stored.
   *
   * The one method that takes a tenant prefix rather than a key, and therefore
   * the one that cannot use `assertOwnership`. It builds the prefix from the id
   * itself — no caller-supplied path reaches it — and refuses an empty id,
   * which would otherwise resolve to `tenants/` and take the whole platform
   * with it. Only `TenantDeletionService` calls this.
   */
  async purgeTenant(tenantId: string): Promise<number> {
    if (!tenantId || !/^[0-9a-zA-Z-]{8,64}$/.test(tenantId)) {
      throw Errors.internal('Refusing to purge storage for an implausible tenant id');
    }

    const prefix = `${TENANT_ROOT}/${tenantId}/`;
    const removed = await this.provider.deletePrefix(prefix);
    this.logger.warn('Purged tenant storage', { tenantId, objects: removed });
    return removed;
  }

  /** Every key a tenant owns. Used to report what a purge is about to remove. */
  async listTenantObjects(tenantId: string): Promise<string[]> {
    if (!tenantId) throw Errors.internal('Storage access attempted without a tenant');
    return this.provider.list(`${TENANT_ROOT}/${tenantId}/`);
  }

  /** Public URL for an object the tenant owns. */
  publicUrl(tenantId: string, key: string): string {
    this.assertOwnership(tenantId, key);
    return this.provider.publicUrl(key);
  }

  /** Time-limited URL, for anything that should not be publicly listable. */
  async signedUrl(
    tenantId: string,
    key: string,
    expiresInSeconds = this.config.storage.presignedUrlExpiry,
  ): Promise<string> {
    this.assertOwnership(tenantId, key);
    return this.provider.signedUrl(key, expiresInSeconds);
  }

  /**
   * The URL a client should use to *display* an object.
   *
   * One decision, in one place, driven by `STORAGE_PUBLIC_READ`:
   *
   *  • **private bucket (the default, and what production should run)** — a
   *    presigned GET. The bucket stays closed, credentials never leave the API,
   *    and the browser still fetches the bytes directly from S3/MinIO rather
   *    than through us.
   *  • **public-read bucket** — the stable public URL, which caches better and
   *    never expires. Only safe when the bucket policy actually allows it.
   *
   * Callers ask for "the URL for this object" and get whichever is correct.
   */
  async readUrl(tenantId: string, key: string): Promise<string> {
    this.assertOwnership(tenantId, key);
    if (this.config.storage.publicRead) return this.provider.publicUrl(key);
    return this.provider.signedUrl(key, this.config.storage.presignedUrlExpiry);
  }

  /** `readUrl` for many keys at once, preserving order. */
  async readUrls(tenantId: string, keys: readonly string[]): Promise<string[]> {
    return Promise.all(keys.map((key) => this.readUrl(tenantId, key)));
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

  /**
   * What can be judged from a client's description alone, before any bytes.
   *
   * Deliberately strict about the *extension* as well as the MIME type: the
   * key we mint carries an extension, and a mismatch between the two is either
   * a confused client or someone hoping the object store will serve
   * `photo.jpg.html`.
   */
  private validateDeclared(file: UploadIntent): void {
    if (!file.fileName?.trim()) throw Errors.badRequest('A file name is required');

    if (file.size <= 0) throw Errors.badRequest(`"${file.fileName}" is empty`);
    if (file.size > this.config.storage.maxFileSize) {
      const mb = Math.round(this.config.storage.maxFileSize / 1024 / 1024);
      throw Errors.badRequest(`"${file.fileName}" is too large. The maximum size is ${mb} MB.`);
    }
    if (!this.config.storage.allowedMime.includes(file.mimeType)) {
      throw Errors.badRequest(
        `"${file.fileName}" is not a supported file type. ` +
          `Allowed: ${this.config.storage.allowedMime.join(', ')}`,
      );
    }

    const declared = extname(file.fileName).toLowerCase();
    const expected = EXTENSIONS[file.mimeType];
    if (declared && expected && !expected.includes(declared)) {
      throw Errors.badRequest(
        `"${file.fileName}" has a ${declared} extension but was sent as ${file.mimeType}`,
      );
    }
  }

  /**
   * The stored object's type, taken from the key rather than the header.
   *
   * `Content-Type` on a direct upload is whatever the browser sent, and the
   * local driver reports nothing at all. The key's extension, by contrast, was
   * minted by `buildKey` from a type we had already accepted — so it is the
   * trustworthy half. The bytes are still sniffed against it afterwards.
   */
  private mimeForKey(key: string, meta: ObjectMetadata): string {
    const ext = extname(key).toLowerCase();
    const match = Object.entries(EXTENSIONS).find(([, exts]) => exts.includes(ext));
    return match ? match[0] : meta.mimeType;
  }

  private matchesMagicNumber(buffer: Buffer, mimeType: string): boolean {
    const spec = MAGIC_NUMBERS.find((m) => m.mime === mimeType);
    if (!spec) return false;
    const offset = spec.offset ?? 0;
    if (buffer.length < offset + spec.bytes.length) return false;
    return spec.bytes.every((byte, i) => buffer[offset + i] === byte);
  }

  /**
   * `tenants/<tenantId>/products/<productId>/<hash?>-<uuid>.<ext>`
   * `tenants/<tenantId>/<folder>/<hash?>-<uuid>.<ext>`
   *
   * Two properties matter. The tenant segment is what `assertOwnership` checks
   * and what `purgeTenant` sweeps. The product segment is what makes deleting
   * one product's media exact — no other product's files live under it, so
   * removing a product never has to guess which objects were its own.
   *
   * A full uuid, not a short one: the key is the entire secret protecting an
   * object on a private bucket, so it must not be guessable from a neighbour's.
   * The content hash is included when the bytes are in hand, because it makes a
   * re-upload of the same image cheap to spot.
   */
  private buildKey(input: {
    tenantId: string;
    mimeType: string;
    originalName: string;
    folder?: string;
    productId?: string;
    buffer?: Buffer;
  }): string {
    const ext = this.extensionFor(input.mimeType, input.originalName);
    const unique = randomUUID();
    const name = input.buffer
      ? `${createHash('sha256').update(input.buffer).digest('hex').slice(0, 12)}-${unique}`
      : unique;

    const scope = input.productId
      ? `products/${sanitiseSegment(input.productId)}`
      : sanitiseSegment(input.folder ?? 'uploads') || 'uploads';

    // Built by hand rather than with path.join: keys are URLs, and join would
    // produce backslashes on Windows.
    return `${TENANT_ROOT}/${input.tenantId}/${scope}/${name}${ext}`;
  }

  private extensionFor(mimeType: string, originalName: string): string {
    const preferred = EXTENSIONS[mimeType]?.[0];
    if (preferred) return preferred;
    // Never trust an arbitrary extension from the client.
    const ext = extname(originalName).toLowerCase();
    return /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : '.bin';
  }
}

/** Reduces a path segment to characters that are unambiguous inside a key. */
function sanitiseSegment(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, '').slice(0, 64);
}

/**
 * A display name safe to echo back and store. Never used to build a key — the
 * key is generated — so this only has to be safe to render: path segments and
 * control characters go, and the rest is the merchant's own file name.
 */
function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'upload';
}
