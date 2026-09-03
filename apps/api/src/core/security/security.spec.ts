import { PasswordService } from './password.service';
import { CredentialCipherService, TokenHasher } from './credential-cipher.service';
import type { AppConfigService } from '@/config/config.module';

/** Minimal config stub — these services only need the crypto slice. */
function configStub(key = Buffer.alloc(32, 7)): AppConfigService {
  return {
    crypto: {
      credentialsKey: key,
      cookieSecret: 'test-cookie-secret-value',
      internalApiKey: 'test-internal-key',
    },
  } as unknown as AppConfigService;
}

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('verifies a password it hashed', async () => {
    const hash = await passwords.hash('correct horse battery');
    await expect(passwords.verify('correct horse battery', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await passwords.hash('correct horse battery');
    await expect(passwords.verify('wrong horse battery', hash)).resolves.toBe(false);
  });

  it('produces a different hash each time (unique salt)', async () => {
    const a = await passwords.hash('same-password-123');
    const b = await passwords.hash('same-password-123');
    expect(a).not.toBe(b);
    // Both must still verify — the salt is embedded in the stored value.
    await expect(passwords.verify('same-password-123', a)).resolves.toBe(true);
    await expect(passwords.verify('same-password-123', b)).resolves.toBe(true);
  });

  it('stores a self-describing, parameterised format', async () => {
    const hash = await passwords.hash('password123');
    expect(hash).toMatch(/^scrypt\$N=\d+,r=\d+,p=\d+\$[^$]+\$[^$]+$/);
  });

  it('returns false rather than throwing on a malformed stored hash', async () => {
    await expect(passwords.verify('password123', 'not-a-hash')).resolves.toBe(false);
    await expect(passwords.verify('password123', '')).resolves.toBe(false);
    await expect(passwords.verify('password123', null)).resolves.toBe(false);
    await expect(passwords.verify('password123', 'bcrypt$x$y$z')).resolves.toBe(false);
  });

  it('refuses absurd cost parameters from a tampered row', async () => {
    const hostile = 'scrypt$N=99999999,r=99,p=99$c2FsdA==$aGFzaA==';
    await expect(passwords.verify('password123', hostile)).resolves.toBe(false);
  });

  it('does not silently accept an empty password', async () => {
    await expect(passwords.hash('short')).rejects.toThrow();
  });

  it('flags a non-scrypt hash as needing a rehash', () => {
    expect(passwords.needsRehash('$2b$12$something')).toBe(true);
    expect(passwords.needsRehash(null)).toBe(true);
  });

  it('generates temporary passwords that satisfy the password policy', () => {
    for (let i = 0; i < 20; i++) {
      const temp = passwords.generateTemporary();
      expect(temp.length).toBeGreaterThanOrEqual(8);
      expect(temp).toMatch(/[A-Za-z]/);
      expect(temp).toMatch(/\d/);
    }
  });
});

describe('CredentialCipherService', () => {
  const cipher = new CredentialCipherService(configStub());

  it('round-trips a secret', () => {
    const secret = 'super-secret-tenant-db-password';
    expect(cipher.decrypt(cipher.encrypt(secret))).toBe(secret);
  });

  it('produces different ciphertext each time (random nonce)', () => {
    const a = cipher.encrypt('same');
    const b = cipher.encrypt('same');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('same');
    expect(cipher.decrypt(b)).toBe('same');
  });

  it('carries a version tag so the algorithm can be rotated', () => {
    expect(cipher.encrypt('x').startsWith('v1.')).toBe(true);
  });

  /**
   * GCM's authentication tag is the whole point of choosing it: a tampered
   * ciphertext must fail loudly rather than decrypt to garbage.
   */
  it('rejects tampered ciphertext', () => {
    const payload = cipher.encrypt('secret');
    const [version, iv, tag, data] = payload.split('.');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 0xff;
    const tampered = [version, iv, tag, flipped.toString('base64')].join('.');

    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('rejects a payload encrypted under a different key', () => {
    const other = new CredentialCipherService(configStub(Buffer.alloc(32, 9)));
    const payload = other.encrypt('secret');
    expect(() => cipher.decrypt(payload)).toThrow();
  });

  it('rejects a malformed payload', () => {
    expect(() => cipher.decrypt('garbage')).toThrow();
    expect(() => cipher.decrypt('v9.a.b.c')).toThrow();
  });

  it('refuses to start with a key that is not 32 bytes', () => {
    expect(() => new CredentialCipherService(configStub(Buffer.alloc(16)))).toThrow(
      /32 bytes/,
    );
  });

  it('generates URL-safe database passwords', () => {
    const password = cipher.generateDatabasePassword();
    expect(password.length).toBeGreaterThan(30);
    expect(password).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('TokenHasher', () => {
  const hasher = new TokenHasher(configStub());

  it('hashes a token deterministically', () => {
    expect(hasher.hashToken('abc')).toBe(hasher.hashToken('abc'));
    expect(hasher.hashToken('abc')).not.toBe(hasher.hashToken('abd'));
  });

  it('never returns the token itself', () => {
    expect(hasher.hashToken('my-refresh-token')).not.toContain('my-refresh-token');
  });

  /**
   * Guest cart tokens are HMAC-signed so an anonymous shopper cannot guess or
   * enumerate another guest's cart.
   */
  it('accepts a guest token it signed', () => {
    const token = hasher.signGuestToken();
    expect(hasher.verifyGuestToken(token)).toBe(token);
  });

  it('rejects a forged guest token', () => {
    expect(hasher.verifyGuestToken('someone-elses-cart.deadbeef')).toBeNull();
    expect(hasher.verifyGuestToken('no-signature')).toBeNull();
    expect(hasher.verifyGuestToken('')).toBeNull();
    expect(hasher.verifyGuestToken(null)).toBeNull();
  });

  it('rejects a guest token whose id was altered after signing', () => {
    const token = hasher.signGuestToken();
    const [, signature] = token.split('.');
    expect(hasher.verifyGuestToken(`tampered.${signature}`)).toBeNull();
  });

  it('compares strings in constant time without false positives', () => {
    expect(hasher.safeEqual('abc', 'abc')).toBe(true);
    expect(hasher.safeEqual('abc', 'abd')).toBe(false);
    expect(hasher.safeEqual('abc', 'abcd')).toBe(false);
    expect(hasher.safeEqual('', '')).toBe(true);
  });
});
