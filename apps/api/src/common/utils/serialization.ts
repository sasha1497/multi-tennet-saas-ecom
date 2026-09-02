/**
 * JSON serialisation helpers.
 *
 * Prisma returns `BigInt` for lifetime aggregate columns and `Decimal` for
 * nothing (we use integer minor units), while `Date` must go out as ISO 8601.
 * `JSON.stringify` throws on BigInt, so this normalises before it ever gets there.
 */

/** Installs a BigInt -> Number JSON bridge. Called once at bootstrap. */
export function installBigIntSerializer(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BigInt.prototype as any).toJSON = function toJSON(this: bigint) {
    // Money is in paise; Number.MAX_SAFE_INTEGER is ~90 trillion rupees, so this
    // is lossless for every realistic value. Above that we keep the string form
    // rather than silently truncating.
    return this <= BigInt(Number.MAX_SAFE_INTEGER) && this >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(this)
      : this.toString();
  };
}

export function bigIntToNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'bigint' ? Number(value) : value;
}

/** Recursively converts Dates to ISO strings and BigInts to numbers. */
export function normaliseForJson<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value) as unknown as T;
  if (value instanceof Date) return value.toISOString() as unknown as T;
  if (Array.isArray(value)) return value.map(normaliseForJson) as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normaliseForJson(v);
    }
    return out as T;
  }
  return value;
}

export function toIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export function toIsoRequired(date: Date): string {
  return date.toISOString();
}
