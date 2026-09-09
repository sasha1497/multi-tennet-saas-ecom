import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@/config/config.module';
import { AppLogger } from '@/core/logger/logger.service';
import { StorageService } from './storage.service';

/** The two columns every stored media reference carries. */
export interface MediaRef {
  /** Null for media that predates object references. */
  objectKey: string | null;
  /** The legacy/public URL. Used verbatim when there is no key. */
  url: string;
}

/**
 * Resolves a batch of refs to display URLs. Synchronous by the time a mapper
 * holds it, so response mapping stays pure and free of awaits.
 */
export type MediaUrlResolver = (ref: MediaRef) => string;

/** Used wherever no resolver was supplied — renders the stored URL as-is. */
export const passthroughMediaUrls: MediaUrlResolver = (ref) => ref.url;

interface CacheEntry {
  url: string;
  /** Epoch ms after which this entry stops being handed out. */
  goodUntil: number;
}

/**
 * Turns object keys into URLs a browser can load.
 *
 * The bucket is private by default, so a stored key is not directly fetchable
 * and the API has to mint a presigned GET for it. Two things make that
 * practical rather than merely correct:
 *
 *  1. **Batching.** A resolver is built once per response for every key in it,
 *     so a 48-product grid signs its images in one pass instead of awaiting
 *     inside a map.
 *  2. **Stable URLs for half a lifetime.** A fresh signature every render would
 *     change every `src` on every request and defeat the browser cache
 *     entirely. URLs are cached per key and reissued only once they are down to
 *     half their validity — so a client sees the same URL across renders, and
 *     any URL it receives is guaranteed at least half the configured expiry
 *     before it stops working.
 *
 * When `STORAGE_PUBLIC_READ` is on the bucket serves anonymous reads and this
 * degrades to the stable public URL — no signing, no cache, nothing to expire.
 */
@Injectable()
export class MediaUrlService {
  private readonly logger: AppLogger;
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Ceiling on the in-process cache. Well past a busy catalogue's working set;
   * the eviction below exists so a long-lived process cannot grow without
   * bound, not because contention is expected.
   */
  private static readonly MAX_ENTRIES = 5_000;

  constructor(
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('MediaUrl');
  }

  /**
   * Builds a resolver covering every ref passed in.
   *
   * Refs belonging to another tenant are not signed and fall back to their
   * stored URL: `StorageService` refuses them, and a mapping pass is the wrong
   * place to raise a cross-tenant error — the rows should never have been read
   * in the first place, and the query that read them is the actual bug.
   */
  async resolver(tenantId: string, refs: readonly MediaRef[]): Promise<MediaUrlResolver> {
    if (this.config.storage.publicRead) return passthroughMediaUrls;

    const keys = [...new Set(refs.map((r) => r.objectKey).filter((k): k is string => Boolean(k)))];
    if (keys.length === 0) return passthroughMediaUrls;

    const now = Date.now();
    const resolved = new Map<string, string>();
    const misses: string[] = [];

    for (const key of keys) {
      const hit = this.cache.get(key);
      if (hit && hit.goodUntil > now) resolved.set(key, hit.url);
      else misses.push(key);
    }

    if (misses.length > 0) {
      const expiry = this.config.storage.presignedUrlExpiry;
      // Reissue once half the lifetime is gone, so every URL handed out has at
      // least expiry/2 remaining however long the caller holds it.
      const goodUntil = now + (expiry * 1000) / 2;

      const signed = await Promise.all(
        misses.map(async (key) => {
          try {
            // Passing the tenant is what makes this safe: StorageService
            // refuses to sign a key outside that tenant's prefix.
            return [key, await this.storage.signedUrl(tenantId, key, expiry)] as const;
          } catch (err) {
            this.logger.warn('Could not sign a media URL', {
              tenantId,
              error: (err as Error).message,
            });
            return [key, null] as const;
          }
        }),
      );

      for (const [key, url] of signed) {
        if (!url) continue;
        resolved.set(key, url);
        this.remember(key, { url, goodUntil });
      }
    }

    return (ref) => (ref.objectKey ? (resolved.get(ref.objectKey) ?? ref.url) : ref.url);
  }

  /** Convenience for a single ref — prefer `resolver` for anything plural. */
  async resolve(tenantId: string, ref: MediaRef): Promise<string> {
    const resolve = await this.resolver(tenantId, [ref]);
    return resolve(ref);
  }

  /**
   * Drops cached URLs for keys that no longer exist.
   *
   * Not required for correctness — a signed URL for a deleted object simply
   * 404s — but it keeps a deleted image from lingering in the map until it
   * expires, and makes the cache's contents match reality after a purge.
   */
  forget(keys: readonly string[]): void {
    for (const key of keys) this.cache.delete(key);
  }

  /** Drops every cached URL under a tenant's prefix. Used by tenant deletion. */
  forgetTenant(tenantId: string): void {
    const prefix = `tenants/${tenantId}/`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  private remember(key: string, entry: CacheEntry): void {
    if (this.cache.size >= MediaUrlService.MAX_ENTRIES) {
      // Map iterates in insertion order, so the first key is the oldest write.
      for (const oldest of this.cache.keys()) {
        this.cache.delete(oldest);
        break;
      }
    }
    this.cache.set(key, entry);
  }
}
