/**
 * The storage port.
 *
 * Application code depends on `StorageService`, which depends on this
 * interface. Nothing outside `core/storage/providers` may import an S3 or MinIO
 * type — that is the whole point of the abstraction, and it is what lets the
 * deployment target change without a single edit in a business module.
 *
 * Implementations are chosen once, by the factory in `storage.module.ts`, from
 * `STORAGE_PROVIDER`. There is deliberately no `if (isProd)` anywhere below.
 */

/** DI token for the selected provider. */
export const STORAGE_PROVIDER_TOKEN = Symbol('STORAGE_PROVIDER');

export interface PutObjectInput {
  key: string;
  body: Buffer;
  mimeType: string;
  /**
   * Cache-Control for the stored object. Keys are content-addressed, so the
   * caller can safely ask for a long lifetime.
   */
  cacheControl?: string;
}

/** What the store knows about an object without reading its bytes. */
export interface ObjectMetadata {
  key: string;
  size: number;
  mimeType: string;
  etag?: string;
  lastModified?: Date;
}

/** A presigned PUT, and the exact headers the browser must send with it. */
export interface PresignedUpload {
  url: string;
  /** Must be replayed verbatim by the client — they are part of the signature. */
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface StorageProvider {
  /** Human-readable provider name, for logs and health output. */
  readonly name: string;

  /** The bucket objects live in. Recorded alongside every stored key. */
  readonly bucket: string;

  put(input: PutObjectInput): Promise<void>;

  /** Reads an object back. Returns null when it does not exist. */
  get(key: string): Promise<Buffer | null>;

  /**
   * Reads the first `length` bytes. Used to sniff a magic number after a direct
   * browser upload without pulling a 5 MB image through the API.
   */
  getRange(key: string, length: number): Promise<Buffer | null>;

  /** Deletes an object. Succeeds silently when it is already gone. */
  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  /** Size/type/etag for an object, or null when it does not exist. */
  head(key: string): Promise<ObjectMetadata | null>;

  /** Every key under a prefix. Pages internally; used by tenant purge. */
  list(prefix: string): Promise<string[]>;

  /**
   * Deletes everything under a prefix and answers how many objects went.
   * Separate from `delete` because bulk removal is a different, far more
   * dangerous operation and deserves to be spelled differently at call sites.
   */
  deletePrefix(prefix: string): Promise<number>;

  /** Stable, publicly reachable URL. Only meaningful on a public-read bucket. */
  publicUrl(key: string): string;

  /** Time-limited URL, for objects that should not be publicly listable. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;

  /**
   * Time-limited PUT, so a browser can upload straight to the object store.
   * The bytes never pass through the API — see `docs/STORAGE.md`.
   */
  signedUploadUrl(
    key: string,
    mimeType: string,
    expiresInSeconds: number,
  ): Promise<PresignedUpload>;

  healthCheck(): Promise<{ ok: boolean; message?: string }>;
}
