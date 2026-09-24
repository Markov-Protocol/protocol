import type { NextConfig } from 'next';
import { validateWebEnv } from './src/config/web-env';

// Fail the build early on an invalid or unsafe environment combination.
validateWebEnv(process.env);

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Full CSP with the exact identity/wallet allowances is specified for F19/F20; frame-ancestors is safe now.
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(), payment=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@markov/ui', '@markov/formatters', '@markov/shell', '@markov/api-client'],
  images: { remotePatterns: [] },
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
};

export default nextConfig;
