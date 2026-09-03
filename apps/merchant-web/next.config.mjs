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
