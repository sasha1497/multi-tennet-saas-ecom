/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@retailos/ui'],
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

  eslint: { ignoreDuringBuilds: true },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Framing is controlled by `frame-ancestors` below rather than
          // `X-Frame-Options`, which cannot express "this origin *and* the
          // console". CSP supersedes XFO wherever both are understood, and
          // sending both with different meanings is how you get a policy that
          // behaves differently per browser — so only the CSP is sent.
          //
          // The allow-list is: the storefront itself, and the merchant console
          // on this deployment's admin subdomain. Store Design frames the real
          // storefront so a merchant can try a template on their own products;
          // without this that frame is blank. Nothing else may frame a shop.
          { key: 'Content-Security-Policy', value: `frame-ancestors ${frameAncestors()}` },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};

/**
 * Who may frame a storefront: itself, and this deployment's console.
 *
 * In development the console is a bare port on localhost rather than a
 * subdomain, so both forms are listed. `PLATFORM_DOMAIN` is a deployment
 * setting, not user input — it never comes from a request.
 */
function frameAncestors() {
  const domain = (process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? 'localhost').trim();
  const adminSubdomain = (process.env.ADMIN_SUBDOMAIN ?? 'admin').trim();
  const merchantPort = (process.env.MERCHANT_PORT ?? '3001').trim();

  const origins = new Set([
    "'self'",
    `https://${adminSubdomain}.${domain}`,
    `http://${adminSubdomain}.${domain}`,
  ]);

  if (domain === 'localhost' || domain.endsWith('.localhost')) {
    origins.add(`http://localhost:${merchantPort}`);
    origins.add(`http://127.0.0.1:${merchantPort}`);
  }

  return [...origins].join(' ');
}

export default nextConfig;
