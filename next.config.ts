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
};

export default config;
