import type { PaginatedResult, PaginationMeta } from '@retailos/types';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@retailos/config';

export interface PageArgs {
  page?: number;
  limit?: number;
}

export interface PrismaPageArgs {
  skip: number;
  take: number;
}

/** Clamps user-supplied paging into something the database is happy to serve. */
export function toPrismaPage(args: PageArgs): PrismaPageArgs & { page: number; limit: number } {
  const page = Math.max(1, Math.floor(args.page ?? 1));
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(args.limit ?? DEFAULT_PAGE_SIZE)));
  return { skip: (page - 1) * limit, take: limit, page, limit };
}

export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

export function paginate<T>(items: T[], total: number, page: number, limit: number): PaginatedResult<T> {
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

/**
 * Whitelisted sort builder.
 *
 * Passing a client string straight into Prisma's `orderBy` would let a caller
 * sort by (and therefore probe) any column. Only fields listed by the calling
 * service are honoured; anything else falls back to the default.
 */
export function buildOrderBy<T extends string>(
  sortBy: string | undefined,
  sortOrder: 'asc' | 'desc' | undefined,
  allowed: readonly T[],
  fallback: { field: T; order: 'asc' | 'desc' },
): Record<string, 'asc' | 'desc'> {
  const field = sortBy && (allowed as readonly string[]).includes(sortBy) ? sortBy : fallback.field;
  const order = sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : fallback.order;
  return { [field]: order };
}

/**
 * Opaque cursor encoding. Base64url of `id|sortValue` so the client cannot
 * hand-craft one that leaks ordering internals.
 */
export function encodeCursor(id: string, sortValue: string | number | Date): string {
  const raw = `${id}|${sortValue instanceof Date ? sortValue.toISOString() : sortValue}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { id: string; sortValue: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.indexOf('|');
    if (sep === -1) return null;
    return { id: raw.slice(0, sep), sortValue: raw.slice(sep + 1) };
  } catch {
    return null;
  }
}

/**
 * Escapes a user search term for use inside a Prisma `contains` filter.
 *
 * Prisma parameterises values, so this is not about SQL injection — it is about
 * `%` and `_` in the term behaving as literal characters rather than wildcards.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function normaliseSearch(search: string | undefined): string | undefined {
  const trimmed = search?.trim();
  if (!trimmed || trimmed.length < 1) return undefined;
  return trimmed.slice(0, 200);
}
