import swc from 'unplugin-swc';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' }, jsc: { target: 'es2022', parser: { syntax: 'typescript', decorators: true }, transform: { decoratorMetadata: true, legacyDecorator: true } } })],
  resolve: { alias: { '@agrimate/shared': resolve(__dirname, '../../packages/shared/src/index.ts') } },
  test: { env: { NODE_ENV: 'test', QUEUES_ENABLED: 'false', STORAGE_PROVIDER: 'mock', DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://agrimate:agrimate@localhost:5432/agrimate_test' }, include: ['test/**/*.test.ts'], globalSetup: ['test/global-setup.ts'], pool: 'forks', poolOptions: { forks: { singleFork: true } }, testTimeout: 60000, hookTimeout: 120000 },
});
