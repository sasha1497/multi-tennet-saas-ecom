import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@/config/config.module';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM standard
const TAG_LENGTH = 16;
const VERSION = 'v1';

/**
 * Symmetric encryption for secrets at rest — currently the per-tenant database
 * passwords in `tenant_databases.encrypted_password`.
 *
 * Requirement §9: "Sensitive credentials MUST NOT be stored as plain text in
 * application tables." A tenant DB password grants full access to one merchant's
 * entire business, so a leaked master-database dump must not be enough to use it.
 *
 * The key comes from `CREDENTIALS_ENCRYPTION_KEY` (32 raw bytes, base64). In
 * production that variable should be injected from a secrets manager
 * (AWS Secrets Manager / SSM Parameter Store), never baked into an image.
 *
 * The stored format carries a version tag so the algorithm or key can be rotated
 * without a flag-day migration:
 *
 *   v1.<iv-b64>.<tag-b64>.<ciphertext-b64>
 */
@Injectable()
export class CredentialCipherService {
  private readonly key: Buffer;

  constructor(private readonly config: AppConfigService) {
    this.key = config.crypto.credentialsKey;
    if (this.key.length !== 32) {
      throw new Error(
        'CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes. Generate one with: openssl rand -base64 32',
      );
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(
      '.',
    );
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('Malformed encrypted credential payload');
    }
    const [, ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');

    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
      throw new Error('Malformed encrypted credential payload');
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    // GCM's auth tag makes this throw on any tampering — that is the point.
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  /** Generates a strong password for a newly provisioned tenant database role. */
  generateDatabasePassword(): string {
    // base64url avoids characters that need escaping in a connection URL.
    return randomBytes(32).toString('base64url');
  }
}

/**
 * Keyed hashing + signing that does not need the AES key.
 *
 * Used for opaque tokens we must be able to look up (refresh tokens are stored
 * as a SHA-256 digest, never in the clear) and for signed guest-cart tokens.
 */
@Injectable()
export class TokenHasher {
  constructor(private readonly config: AppConfigService) {}

  /** Deterministic digest for indexed token lookup. */
  hashToken(token: string): string {
    return createHmac('sha256', this.config.crypto.cookieSecret).update(token).digest('hex');
  }

  /**
   * Signs a guest-cart identifier so an anonymous shopper cannot guess or
   * enumerate another guest's cart by inventing a token.
   */
  signGuestToken(raw?: string): string {
    const id = raw ?? randomBytes(18).toString('base64url');
    const sig = createHmac('sha256', this.config.crypto.cookieSecret)
      .update(id)
      .digest('base64url')
      .slice(0, 27);
    return `${id}.${sig}`;
  }

  verifyGuestToken(token: string | null | undefined): string | null {
    if (!token) return null;
    const sep = token.lastIndexOf('.');
    if (sep <= 0) return null;
    const id = token.slice(0, sep);
    const sig = token.slice(sep + 1);
    const expected = createHmac('sha256', this.config.crypto.cookieSecret)
      .update(id)
      .digest('base64url')
      .slice(0, 27);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return token;
  }

  /** Constant-time comparison for webhook signatures and API keys. */
  safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
