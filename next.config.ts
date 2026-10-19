import type { NextConfig } from 'next';

const config: NextConfig = {
  // Docker deployment (single server). 'standalone' emits .next/standalone
  // with only the traced runtime dependencies, so the production image ships
  // neither bun nor the full node_modules tree. Every route
  // in this app is `export const dynamic = 'force-dynamic'`, so `next build`
  // opens no database connection — which is what lets the image be built with a
  // placeholder DATABASE_URL (it only has to parse; see the Dockerfile) and
  // therefore no credential baked into a layer.
  //
  // Not on Vercel, which sets VERCEL=1 at build time. Vercel builds through a
  // deployment adapter, and on Next 16.3 with Turbopack an adapter build emits
  // no .next/next-server.js.nft.json — yet the standalone step, which runs
  // after the adapter's onBuildComplete, opens that file. The first production
  // build of de79558 failed exactly there (ENOENT), and a no-op local adapter
  // (NEXT_ADAPTER_PATH) reproduces it. Vercel does not run the image anyway.
  output: process.env.VERCEL ? undefined : 'standalone',
  // Headers that are the same on every request. The policy is not among them:
  // it carries a per-request nonce and therefore lives in the proxy.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Nothing here uses any of these, and saying so is free.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
        // X-Frame-Options is deliberately absent: frame-ancestors in the policy
        // supersedes it and expresses the same thing.
      },
    ];
  },
  // D-19: /skills has listed six artifact types since Phase 3, and the name
  // has been a false statement ever since. Permanent, because the old name
  // was wrong and is not coming back — a temporary redirect would spend the
  // same link equity twice if it were ever reverted. Next.js preserves the
  // query string on the destination automatically (no destination query of
  // its own here), so /skills?page=2 keeps working.
  async redirects() {
    return [{ source: '/skills', destination: '/artifacts', permanent: true }];
  },
};

export default config;
