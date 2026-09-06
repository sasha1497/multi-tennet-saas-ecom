/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Workspace packages ship TypeScript source rather than a build artefact, so
  // Next compiles them itself. This keeps `'use client'` directives intact and
  // removes a build step that would otherwise have to stay in sync.
  transpilePackages: ['@retailos/ui'],

  // `standalone` produces a self-contained server bundle for the Docker image —
  // roughly a tenth of the size of copying node_modules.
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'http', hostname: 'minio' },
    ],
  },

  eslint: {
    // Linting is a separate CI step; failing the build on a warning slows the
    // inner loop without adding safety.
    ignoreDuringBuilds: true,
  },

  /**
   * Proxy the API through the console's own origin in development.
   *
   * Without this the browser has to make a cross-origin call from :3001 to
   * :4000, which brings in CORS preflights and — more importantly — a second
   * port that something on the machine may refuse to open. A firewall rule, a
   * proxy setting or a security tool that blocks browsers (but not curl) turns
   * into an unexplained "Could not reach the API", with the API demonstrably
   * healthy the whole time.
   *
   * Same-origin removes that entire class of failure: the console only ever
   * talks to the address it already loaded successfully. In production nginx
   * does the same job, so this only applies when the dev server is running.
   *
   * Safe for the console specifically because it has no tenant hostname — the
   * tenant comes from the caller's verified membership. The storefront is left
   * alone, since its tenant IS the hostname and a proxy would rewrite it.
   */
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return [];
    const target = process.env.DEV_API_PROXY_TARGET ?? 'http://127.0.0.1:4000';
    return [{ source: '/api/v1/:path*', destination: `${target}/api/v1/:path*` }];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
