import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing with scrypt from Node's standard library.
 *
 * Why scrypt rather than bcrypt or argon2 (docs/DECISION_LOG.md ADR-007):
 * both of those are native addons that need a compiler toolchain in the Docker
 * build and break on Alpine/musl and on Apple Silicon cross-builds. scrypt is
 * memory-hard, built into Node, and — unlike bcrypt — has no 72-byte input
 * truncation. The cost parameters below target roughly 100 ms per hash on a
 * small cloud VM, which is the right order of magnitude for a login endpoint
 * that is also rate-limited.
 *
 * The stored format is self-describing, so parameters can be raised later and
 * old hashes still verify:
 *
 *   scrypt$N=16384,r=8,p=1$<salt-b64>$<hash-b64>
 */
const PARAMS = { N: 16_384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// scrypt needs ~128 * N * r bytes; the default 32 MB cap is too low for N=16384.
const MAX_MEM = 64 * 1024 * 1024;

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    this.assertUsable(password);
    const salt = randomBytes(SALT_LENGTH);
    const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, {
      ...PARAMS,
      maxmem: MAX_MEM,
    });
    return [
      'scrypt',
      `N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}`,
      salt.toString('base64'),
      derived.toString('base64'),
    ].join('$');
  }

  /**
   * Constant-time verification. Returns false for malformed stored hashes
   * rather than throwing, so a corrupted row cannot be used to probe accounts.
   */
  async verify(password: string, stored: string | null | undefined): Promise<boolean> {
    if (!stored || !password) return false;

    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

    const params = this.parseParams(parts[1]);
    if (!params) return false;

    let salt: Buffer;
    let expected: Buffer;
    try {
      salt = Buffer.from(parts[2], 'base64');
      expected = Buffer.from(parts[3], 'base64');
    } catch {
      return false;
    }
    if (salt.length === 0 || expected.length === 0) return false;

    try {
      const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
        ...params,
        maxmem: MAX_MEM,
      });
      return derived.length === expected.length && timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  /** True when a stored hash used weaker parameters and should be re-hashed on login. */
  needsRehash(stored: string | null | undefined): boolean {
    if (!stored) return true;
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'scrypt') return true;
    const params = this.parseParams(parts[1]);
    return !params || params.N < PARAMS.N || params.r < PARAMS.r;
  }

  /** Cryptographically strong temporary password for staff invites and seeds. */
  generateTemporary(length = 14): string {
    // Excludes look-alike characters so it can be read off a screen and typed.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = randomBytes(length * 2);
    let out = '';
    for (let i = 0; out.length < length && i < bytes.length; i++) {
      const idx = bytes[i] % alphabet.length;
      out += alphabet[idx];
    }
    // Guarantee the policy (a letter and a digit) regardless of the draw.
    return `${out.slice(0, length - 2)}a7`;
  }

  private parseParams(segment: string): { N: number; r: number; p: number } | null {
    const out: Record<string, number> = {};
    for (const pair of segment.split(',')) {
      const [k, v] = pair.split('=');
      const n = Number(v);
      if (!k || !Number.isFinite(n)) return null;
      out[k] = n;
    }
    if (!out.N || !out.r || !out.p) return null;
    // Refuse absurd parameters from a tampered row — they would be a DoS vector.
    if (out.N > 1_048_576 || out.r > 32 || out.p > 16) return null;
    return { N: out.N, r: out.r, p: out.p };
  }

  private assertUsable(password: string): void {
    if (typeof password !== 'string' || password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    if (Buffer.byteLength(password, 'utf8') > 1024) {
      throw new Error('Password is too long');
    }
  }
}
