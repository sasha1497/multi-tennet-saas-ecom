import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type {
  ObjectMetadata,
  PresignedUpload,
  PutObjectInput,
  StorageProvider,
} from '../storage.provider';

/**
 * Local-disk storage.
 *
 * **Not a storage backend for anything a user uploaded.** It exists for unit
 * tests and for running the API with no Docker at all; it cannot presign,
 * objects do not survive a container rebuild and nothing is shared between
 * replicas. Selecting it requires an explicit opt-in (`STORAGE_ALLOW_LOCAL`)
 * and is refused outright in production — see `storage.module.ts` and
 * `env.schema.ts`. Local development uses MinIO.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  readonly bucket = 'local';

  constructor(private readonly rootDir: string) {}

  async put(input: PutObjectInput): Promise<void> {
    const path = this.pathFor(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);
  }

  async get(key: string): Promise<Buffer | null> {
    // Resolved OUTSIDE the try: a traversal is a security fault and must
    // propagate. Catching it here would turn "refused to escape the root" into
    // an ordinary "not found" and silently disarm the guard.
    const path = this.pathFor(key);
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    await unlink(path).catch(() => undefined);
  }

  async getRange(key: string, length: number): Promise<Buffer | null> {
    const buffer = await this.get(key);
    return buffer ? buffer.subarray(0, length) : null;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      return {
        key,
        size: info.size,
        // A filesystem stores no content type; callers that need one sniff.
        mimeType: 'application/octet-stream',
        lastModified: info.mtime,
      };
    } catch {
      return null;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const root = resolve(this.rootDir);
    const start = this.pathFor(prefix);
    const out: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else out.push(relative(root, full).split(sep).join('/'));
      }
    };

    await walk(start);
    return out;
  }

  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix.endsWith('/')) {
      throw new Error(`Refusing to bulk-delete a prefix that is not a directory: ${prefix}`);
    }
    const keys = await this.list(prefix);
    await rm(this.pathFor(prefix), { recursive: true, force: true });
    return keys.length;
  }

  publicUrl(key: string): string {
    return `/media/${key}`;
  }

  /** No signing to do on a local disk; the public path is the only path. */
  async signedUrl(key: string): Promise<string> {
    return this.publicUrl(key);
  }

  /**
   * Direct upload has no meaning against a filesystem — there is no endpoint a
   * browser could PUT to. Callers fall back to the multipart route, which is
   * what the `StorageService` does when this throws.
   */
  async signedUploadUrl(): Promise<PresignedUpload> {
    throw new Error('The local storage driver cannot issue presigned upload URLs. Use MinIO or S3.');
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: 'local driver' };
  }

  /**
   * Resolves a key inside the root and refuses to escape it.
   *
   * Keys are generated server-side, so `../` should never appear — but this is
   * the one place where a key becomes a filesystem path, and a traversal here
   * would read or overwrite arbitrary files. Cheap to check, catastrophic to
   * miss.
   */
  private pathFor(key: string): string {
    const root = resolve(this.rootDir);
    const path = resolve(root, key);
    if (path !== root && !path.startsWith(root + sep)) {
      throw new Error('Refusing to resolve a storage key outside the storage root');
    }
    return path;
  }
}
