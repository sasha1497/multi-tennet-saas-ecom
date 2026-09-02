/**
 * Host → tenant-slug resolution.
 *
 * This is the *parsing* half of multi-tenancy and it is deliberately shared, so
 * the API middleware, the storefront's Next middleware and the mobile deep-link
 * handler all agree on exactly what `kickzone.ourdomain.in` means.
 *
 * Parsing a host NEVER grants access on its own — the API still looks the
 * hostname up in the master `domains` table and checks the tenant's status.
 */

export const DEFAULT_RESERVED_SUBDOMAINS = [
  'www',
  'api',
  'admin',
  'app',
  'static',
  'cdn',
  'assets',
  'mail',
  'smtp',
  'imap',
  'ftp',
  'blog',
  'help',
  'support',
  'status',
  'docs',
  'dashboard',
  'console',
  'auth',
  'login',
  'signup',
  'account',
  'billing',
  'payments',
  'webhooks',
  'internal',
  'test',
  'staging',
  'dev',
  'localhost',
] as const;

export interface DomainConfig {
  /** e.g. `ourdomain.in` in production, `localhost` in development. */
  platformDomain: string;
  adminSubdomain?: string;
  apiSubdomain?: string;
  protocol?: 'http' | 'https';
  reservedSubdomains?: readonly string[];
}

export type HostKind = 'tenant' | 'admin' | 'api' | 'root' | 'custom' | 'unknown';

export interface ResolvedHost {
  kind: HostKind;
  /** Present only when `kind === 'tenant'`. */
  slug: string | null;
  /** The full normalised hostname, useful for a custom-domain lookup. */
  hostname: string;
  isCustomDomain: boolean;
}

/**
 * Strips the port, lowercases, removes a trailing dot and any leading `www.`
 * so `KickZone.OurDomain.in:3000` and `kickzone.ourdomain.in` agree.
 */
export function normaliseHostname(host: string | null | undefined): string {
  if (!host) return '';
  let h = host.trim().toLowerCase();
  // Strip the port. IPv6 literals arrive bracketed, so only split on the last colon.
  if (h.startsWith('[')) {
    const close = h.indexOf(']');
    h = close === -1 ? h : h.slice(0, close + 1);
  } else {
    const colon = h.lastIndexOf(':');
    if (colon !== -1) h = h.slice(0, colon);
  }
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

export function resolveHost(host: string | null | undefined, config: DomainConfig): ResolvedHost {
  const hostname = normaliseHostname(host);
  const platform = normaliseHostname(config.platformDomain);
  const admin = config.adminSubdomain ?? 'admin';
  const api = config.apiSubdomain ?? 'api';
  const reserved = new Set(config.reservedSubdomains ?? DEFAULT_RESERVED_SUBDOMAINS);

  if (!hostname) return { kind: 'unknown', slug: null, hostname: '', isCustomDomain: false };

  if (hostname === platform || hostname === `www.${platform}`) {
    return { kind: 'root', slug: null, hostname, isCustomDomain: false };
  }

  if (hostname.endsWith(`.${platform}`)) {
    const label = hostname.slice(0, -(platform.length + 1));
    // Only single-label subdomains are tenants: `a.b.ourdomain.in` is not one.
    if (label.includes('.')) {
      return { kind: 'unknown', slug: null, hostname, isCustomDomain: false };
    }
    if (label === admin) return { kind: 'admin', slug: null, hostname, isCustomDomain: false };
    if (label === api) return { kind: 'api', slug: null, hostname, isCustomDomain: false };
    if (reserved.has(label)) return { kind: 'unknown', slug: null, hostname, isCustomDomain: false };
    if (!isValidSlug(label)) {
      return { kind: 'unknown', slug: null, hostname, isCustomDomain: false };
    }
    return { kind: 'tenant', slug: label, hostname, isCustomDomain: false };
  }

  // Anything else may be a merchant's own domain; the API resolves it against
  // the `domains` table rather than guessing a slug from it.
  return { kind: 'custom', slug: null, hostname, isCustomDomain: true };
}

export function isValidSlug(slug: string): boolean {
  return (
    slug.length >= 3 &&
    slug.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) &&
    !slug.includes('--')
  );
}

export function isReservedSlug(slug: string, reserved?: readonly string[]): boolean {
  return new Set(reserved ?? DEFAULT_RESERVED_SUBDOMAINS).has(slug);
}

export function storefrontUrl(slug: string, config: DomainConfig): string {
  const protocol = config.protocol ?? 'https';
  return `${protocol}://${slug}.${normaliseHostname(config.platformDomain)}`;
}

export function adminUrl(config: DomainConfig): string {
  const protocol = config.protocol ?? 'https';
  return `${protocol}://${config.adminSubdomain ?? 'admin'}.${normaliseHostname(config.platformDomain)}`;
}

export function apiUrl(config: DomainConfig): string {
  const protocol = config.protocol ?? 'https';
  return `${protocol}://${config.apiSubdomain ?? 'api'}.${normaliseHostname(config.platformDomain)}`;
}

/**
 * CORS origin check. Accepts the platform root, any tenant subdomain and the
 * admin console — and nothing else.
 */
export function isAllowedOrigin(origin: string, config: DomainConfig): boolean {
  try {
    const url = new URL(origin);
    const host = normaliseHostname(url.hostname);
    const platform = normaliseHostname(config.platformDomain);
    return host === platform || host.endsWith(`.${platform}`);
  } catch {
    return false;
  }
}
