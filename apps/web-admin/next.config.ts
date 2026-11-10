import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // @agrimate/ui ships TSX source. api-client and shared are consumed from their built dist.
  transpilePackages: ['@agrimate/ui'],
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // The quality-check and transport desks capture photos and location in the browser.
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
    ] }];
  },
};

export default config;
