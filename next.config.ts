import type { NextConfig } from 'next';

const config: NextConfig = {
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
