import path from 'node:path';
import type { NextConfig } from 'next';

// The console signs in at an unlisted path. Typing it on the main site goes straight to the console's sign-in page.
const ADMIN_URL = (process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3001').replace(/\/$/, '');

const config: NextConfig = {
  transpilePackages: ['@agrimate/ui'],
  output: 'standalone',
  // The monorepo root, so that standalone output traces the workspace packages.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  async redirects() {
    return [{ source: '/adminagri', destination: `${ADMIN_URL}/adminagri`, permanent: false }];
  },
};

export default config;
