import { StorageService } from './storage.service';
import { LocalStorageProvider } from './providers/local.provider';
import { MinioStorageProvider } from './providers/minio.provider';
import { S3StorageProvider } from './providers/s3.provider';
import type { PutObjectInput, StorageProvider } from './storage.provider';
import { AppException } from '@/common/errors/app.exception';

/** A real 1x1 PNG — the service checks magic numbers, not just the MIME type. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

/** In-memory provider: exercises StorageService without touching a network. */
class FakeProvider implements StorageProvider {
  readonly name = 'fake';
  readonly objects = new Map<string, Buffer>();

  async put(input: PutObjectInput): Promise<void> {
    this.objects.set(input.key, input.body);
  }
  async get(key: string): Promise<Buffer | null> {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  publicUrl(key: string): string {
    return `https://cdn.test/${key}`;
  }
  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return `https://cdn.test/${key}?exp=${expiresInSeconds}`;
  }
  async healthCheck() {
    return { ok: true };
  }
}

const config = {
  storage: {
    maxFileSize: 5 * 1024 * 1024,
    allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
    localDir: './.storage-test',
  },
} as never;

const logger = {
  withContext: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }),
} as never;

describe('StorageService', () => {
  let provider: FakeProvider;
  let storage: StorageService;

  beforeEach(() => {
    provider = new FakeProvider();
    storage = new StorageService(config, provider, logger);
  });

  const upload = (tenantId: string, folder = 'products') =>
    storage.upload({
      buffer: PNG,
      originalName: 'photo.png',
      mimeType: 'image/png',
      tenantId,
      folder,
    });

  describe('tenant-aware keys', () => {
    it('stores every object under its tenant prefix', async () => {
      const stored = await upload(TENANT_A);
      expect(stored.key.startsWith(`tenants/${TENANT_A}/products/`)).toBe(true);
    });

    it('never lets two tenants collide on the same key', async () => {
      const a = await upload(TENANT_A);
      const b = await upload(TENANT_B);
      expect(a.key).not.toBe(b.key);
      expect(b.key.startsWith(`tenants/${TENANT_B}/`)).toBe(true);
    });

    it('gives the same bytes a different key each time, so no tenant overwrites another', async () => {
      const first = await upload(TENANT_A);
      const second = await upload(TENANT_A);
      expect(first.key).not.toBe(second.key);
    });

    it('sanitises the folder rather than trusting it', async () => {
      const stored = await storage.upload({
        buffer: PNG,
        originalName: 'p.png',
        mimeType: 'image/png',
        tenantId: TENANT_A,
        folder: '../../etc',
      });
      expect(stored.key).toBe(
        stored.key.replace('..', 'SHOULD-NOT-APPEAR'),
      );
      expect(stored.key.split('/').includes('..')).toBe(false);
    });
  });

  /**
   * The important block. Keys travel to clients in API responses, so a merchant
   * can read one off their own product and try it against another store.
   */
  describe('cross-tenant access is refused', () => {
    let keyOfA: string;

    beforeEach(async () => {
      keyOfA = (await upload(TENANT_A)).key;
    });

    it('lets the owner read, sign, and delete its own object', async () => {
      await expect(storage.get(TENANT_A, keyOfA)).resolves.toBeInstanceOf(Buffer);
      await expect(storage.exists(TENANT_A, keyOfA)).resolves.toBe(true);
      expect(storage.publicUrl(TENANT_A, keyOfA)).toContain(keyOfA);
      await expect(storage.signedUrl(TENANT_A, keyOfA)).resolves.toContain(keyOfA);
      await storage.delete(TENANT_A, keyOfA);
      await expect(storage.exists(TENANT_A, keyOfA)).resolves.toBe(false);
    });

    it('REFUSES a read of another tenant object', async () => {
      await expect(storage.get(TENANT_B, keyOfA)).rejects.toThrow(AppException);
    });

    it('REFUSES an existence probe against another tenant', async () => {
      await expect(storage.exists(TENANT_B, keyOfA)).rejects.toThrow(AppException);
    });

    it('REFUSES to delete another tenant object — and leaves it intact', async () => {
      await expect(storage.delete(TENANT_B, keyOfA)).rejects.toThrow(AppException);
      expect(provider.objects.has(keyOfA)).toBe(true);
    });

    it('REFUSES to hand out a URL for another tenant object', () => {
      expect(() => storage.publicUrl(TENANT_B, keyOfA)).toThrow(AppException);
    });

    it('REFUSES to sign a URL for another tenant object', async () => {
      await expect(storage.signedUrl(TENANT_B, keyOfA)).rejects.toThrow(AppException);
    });

    it('answers NOT_FOUND rather than FORBIDDEN, so existence is not confirmed', async () => {
      await expect(storage.get(TENANT_B, keyOfA)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects traversal that would climb out of the tenant prefix', async () => {
      const escape = `tenants/${TENANT_B}/../${TENANT_A}/products/x.png`;
      await expect(storage.get(TENANT_B, escape)).rejects.toThrow(AppException);
    });

    it('rejects a tenant id that is merely a prefix of another', async () => {
      // `tenants/<A>` must not satisfy a check for `tenants/<A-with-suffix>`.
      const sneaky = `tenants/${TENANT_A}extra/products/x.png`;
      await expect(storage.get(TENANT_A, sneaky)).rejects.toThrow(AppException);
    });

    it('refuses any access with no tenant at all', async () => {
      await expect(storage.get('', keyOfA)).rejects.toThrow(AppException);
    });
  });

  describe('upload validation', () => {
    it('rejects an empty file', async () => {
      await expect(
        storage.upload({
          buffer: Buffer.alloc(0),
          originalName: 'e.png',
          mimeType: 'image/png',
          tenantId: TENANT_A,
        }),
      ).rejects.toThrow(AppException);
    });

    it('rejects a disallowed MIME type', async () => {
      await expect(
        storage.upload({
          buffer: PNG,
          originalName: 'x.svg',
          mimeType: 'image/svg+xml',
          tenantId: TENANT_A,
        }),
      ).rejects.toThrow(AppException);
    });

    it('rejects content whose bytes contradict the declared type', async () => {
      // HTML masquerading as a PNG — the stored-XSS case.
      await expect(
        storage.upload({
          buffer: Buffer.from('<html><script>alert(1)</script></html>'),
          originalName: 'evil.png',
          mimeType: 'image/png',
          tenantId: TENANT_A,
        }),
      ).rejects.toThrow(AppException);
    });

    it('rejects a file over the size limit', async () => {
      const big = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
      await expect(
        storage.upload({
          buffer: big,
          originalName: 'big.png',
          mimeType: 'image/png',
          tenantId: TENANT_A,
        }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('provider delegation', () => {
    it('reports which backend is in use', () => {
      expect(storage.providerName).toBe('fake');
    });

    it('round-trips content through the provider', async () => {
      const stored = await upload(TENANT_A);
      const read = await storage.get(TENANT_A, stored.key);
      expect(read?.equals(PNG)).toBe(true);
    });
  });
});

/**
 * The providers themselves. These assert the configuration differences that
 * actually distinguish the backends — not the AWS SDK's behaviour, which is not
 * ours to test.
 */
describe('storage providers', () => {
  it('MinIO addresses buckets path-style and requires an endpoint', () => {
    const minio = new MinioStorageProvider({
      bucket: 'media',
      region: 'us-east-1',
      endpoint: 'http://minio:9000',
      publicEndpoint: 'http://localhost:9100',
      accessKey: 'k',
      secretKey: 's',
    });
    expect(minio.name).toBe('minio');
    expect(minio.publicUrl('tenants/a/x.png')).toBe('http://localhost:9100/media/tenants/a/x.png');
  });

  it('MinIO refuses to start without an endpoint', () => {
    expect(
      () =>
        new MinioStorageProvider({
          bucket: 'media',
          region: 'us-east-1',
          accessKey: 'k',
          secretKey: 's',
        }),
    ).toThrow(/endpoint|MINIO_ENDPOINT/i);
  });

  it('S3 uses virtual-host URLs and needs no credentials (IAM role)', () => {
    const s3 = new S3StorageProvider({ bucket: 'media', region: 'ap-south-1' });
    expect(s3.name).toBe('s3');
    expect(s3.publicUrl('tenants/a/x.png')).toBe(
      'https://media.s3.ap-south-1.amazonaws.com/tenants/a/x.png',
    );
  });

  it('the local provider refuses a key that escapes its root', async () => {
    const local = new LocalStorageProvider('./.storage-test');
    await expect(local.get('../../etc/passwd')).rejects.toThrow(/outside the storage root/i);
  });
});
