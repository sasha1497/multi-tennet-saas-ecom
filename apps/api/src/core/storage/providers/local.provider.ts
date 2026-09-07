import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { PutObjectInput, StorageProvider } from '../storage.provider';

/**
 * Local-disk storage.
 *
 * For unit tests and for running the API without Docker. Not a production
 * backend — objects do not survive a container rebuild and cannot be shared
 * between replicas, which is why the factory logs a warning when it is selected
 * outside development.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';

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

  async exists(key: string): Promise<boolean> {
    const path = this.pathFor(key);
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  publicUrl(key: string): string {
    return `/media/${key}`;
  }

  /** No signing to do on a local disk; the public path is the only path. */
  async signedUrl(key: string): Promise<string> {
    return this.publicUrl(key);
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
