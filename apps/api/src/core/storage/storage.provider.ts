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

export interface StorageProvider {
  /** Human-readable provider name, for logs and health output. */
  readonly name: string;

  put(input: PutObjectInput): Promise<void>;

  /** Reads an object back. Returns null when it does not exist. */
  get(key: string): Promise<Buffer | null>;

  /** Deletes an object. Succeeds silently when it is already gone. */
  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  /** Stable, publicly reachable URL. Media is world-readable by design. */
  publicUrl(key: string): string;

  /** Time-limited URL, for objects that should not be publicly listable. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;

  healthCheck(): Promise<{ ok: boolean; message?: string }>;
}
