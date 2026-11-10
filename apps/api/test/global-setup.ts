import { execSync } from 'node:child_process';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://agrimate:agrimate@localhost:5432/agrimate_test';

/**
 * Brings the throwaway test database up to the latest schema before any suite runs.
 * DIRECT_URL is always set here: left unset, Prisma would read it from apps/api/.env and migrate the real database.
 */
export default function setup() {
  execSync('pnpm exec prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url, DIRECT_URL: process.env.TEST_DIRECT_URL ?? url } });
}
