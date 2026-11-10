import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // @agrimate/ui ships TSX source. api-client and shared are consumed from their built dist.
  transpilePackages: ['@agrimate/ui'],
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  reactStrictMode: true,
};

export default config;
