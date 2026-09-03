import {
  isAllowedOrigin,
  isReservedSlug,
  isValidSlug,
  normaliseHostname,
  resolveHost,
  storefrontUrl,
  type DomainConfig,
} from './domain';

/**
 * Host parsing is the first step of tenant resolution. It never grants access on
 * its own — a hostname is only a tenant if the master `domains` table says so —
 * but it decides whether we look a hostname up at all, so it has to be exact.
 */
describe('normaliseHostname', () => {
  it('lowercases and strips the port', () => {
    expect(normaliseHostname('KickZone.OurDomain.in:3000')).toBe('kickzone.ourdomain.in');
  });

  it('strips a trailing dot (fully-qualified form)', () => {
    expect(normaliseHostname('kickzone.ourdomain.in.')).toBe('kickzone.ourdomain.in');
  });

  it('handles bracketed IPv6 literals without mangling them', () => {
    expect(normaliseHostname('[::1]:4000')).toBe('[::1]');
  });

  it('returns an empty string for missing input', () => {
    expect(normaliseHostname(null)).toBe('');
    expect(normaliseHostname(undefined)).toBe('');
    expect(normaliseHostname('')).toBe('');
  });
});

describe('resolveHost', () => {
  const config: DomainConfig = {
    platformDomain: 'ourdomain.in',
    adminSubdomain: 'admin',
    apiSubdomain: 'api',
  };

  it('identifies a tenant subdomain', () => {
    const result = resolveHost('kickzone.ourdomain.in', config);
    expect(result.kind).toBe('tenant');
    expect(result.slug).toBe('kickzone');
  });

  it('identifies the admin console', () => {
    expect(resolveHost('admin.ourdomain.in', config).kind).toBe('admin');
  });

  it('identifies the API domain', () => {
    expect(resolveHost('api.ourdomain.in', config).kind).toBe('api');
  });

  it('identifies the platform root, with or without www', () => {
    expect(resolveHost('ourdomain.in', config).kind).toBe('root');
    expect(resolveHost('www.ourdomain.in', config).kind).toBe('root');
  });

  /**
   * Reserved labels must never resolve to a tenant, or a merchant who managed to
   * register the slug "mail" would receive the platform's mail subdomain traffic.
   */
  it('refuses reserved subdomains', () => {
    for (const reserved of ['mail', 'cdn', 'static', 'billing', 'webhooks']) {
      expect(resolveHost(`${reserved}.ourdomain.in`, config).kind).not.toBe('tenant');
    }
  });

  it('refuses a multi-label subdomain', () => {
    // `evil.kickzone.ourdomain.in` is not KickZone.
    expect(resolveHost('evil.kickzone.ourdomain.in', config).kind).toBe('unknown');
  });

  it('refuses a structurally invalid slug', () => {
    expect(resolveHost('-bad.ourdomain.in', config).kind).toBe('unknown');
    expect(resolveHost('ab.ourdomain.in', config).kind).toBe('unknown'); // too short
    expect(resolveHost('a--b.ourdomain.in', config).kind).toBe('unknown');
  });

  it('treats an unrelated domain as a possible custom domain, not a tenant slug', () => {
    const result = resolveHost('shop.kickzone.com', config);
    expect(result.kind).toBe('custom');
    // Crucially it does NOT guess a slug — the API must look the host up.
    expect(result.slug).toBeNull();
  });

  it('works with localhost in development', () => {
    const dev: DomainConfig = { platformDomain: 'localhost' };
    expect(resolveHost('kickzone.localhost', dev)).toMatchObject({
      kind: 'tenant',
      slug: 'kickzone',
    });
    expect(resolveHost('localhost', dev).kind).toBe('root');
    expect(resolveHost('admin.localhost', dev).kind).toBe('admin');
  });

  it('is not fooled by a lookalike domain suffix', () => {
    // `notourdomain.in` merely ends with the same letters; it is not a subdomain.
    expect(resolveHost('kickzone.notourdomain.in', config).kind).toBe('custom');
  });
});

describe('isValidSlug', () => {
  it('accepts sensible slugs', () => {
    expect(isValidSlug('kickzone')).toBe(true);
    expect(isValidSlug('abc-store')).toBe(true);
    expect(isValidSlug('shop123')).toBe(true);
  });

  it('rejects the shapes that would break a hostname or a database name', () => {
    expect(isValidSlug('ab')).toBe(false); // too short
    expect(isValidSlug('-leading')).toBe(false);
    expect(isValidSlug('trailing-')).toBe(false);
    expect(isValidSlug('double--hyphen')).toBe(false);
    expect(isValidSlug('Upper')).toBe(false);
    expect(isValidSlug('has space')).toBe(false);
    expect(isValidSlug('has_underscore')).toBe(false);
    expect(isValidSlug('a'.repeat(64))).toBe(false);
  });
});

describe('isReservedSlug', () => {
  it('protects platform subdomains', () => {
    expect(isReservedSlug('api')).toBe(true);
    expect(isReservedSlug('admin')).toBe(true);
    expect(isReservedSlug('kickzone')).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  const config: DomainConfig = { platformDomain: 'ourdomain.in' };

  it('allows the platform domain and its subdomains', () => {
    expect(isAllowedOrigin('https://ourdomain.in', config)).toBe(true);
    expect(isAllowedOrigin('https://kickzone.ourdomain.in', config)).toBe(true);
    expect(isAllowedOrigin('https://admin.ourdomain.in', config)).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isAllowedOrigin('https://evil.com', config)).toBe(false);
    // The classic suffix-match bug: this must NOT be allowed.
    expect(isAllowedOrigin('https://ourdomain.in.evil.com', config)).toBe(false);
    expect(isAllowedOrigin('not-a-url', config)).toBe(false);
  });
});

describe('storefrontUrl', () => {
  it('builds the tenant URL from the configured protocol and domain', () => {
    expect(storefrontUrl('kickzone', { platformDomain: 'ourdomain.in', protocol: 'https' })).toBe(
      'https://kickzone.ourdomain.in',
    );
    expect(storefrontUrl('kickzone', { platformDomain: 'localhost', protocol: 'http' })).toBe(
      'http://kickzone.localhost',
    );
  });
});
