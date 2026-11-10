import path from 'node:path';
import type { NextConfig } from 'next';

// One id per build. It versions the service worker's shell cache (see src/lib/sw-client.ts). Written back to process.env
// so that Next's build workers, which re-evaluate this file, inherit the same value rather than a later timestamp.
process.env.AGRIMATE_BUILD_ID ??= String(Date.now());
const buildId = process.env.AGRIMATE_BUILD_ID;

const config: NextConfig = {
  transpilePackages: ['@agrimate/ui'],
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  generateBuildId: async () => buildId,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  async headers() {
    return [
      // The browser must always re-check the worker script, or updates stall.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/manifest.webmanifest', headers: [{ key: 'Content-Type', value: 'application/manifest+json' }] },
    ];
  },
};

export default config;
