import { execSync } from 'node:child_process';

/** Brings the throwaway test database up to the latest schema before any suite runs. */
export default function setup() {
  execSync('pnpm exec prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://agrimate:agrimate@localhost:5432/agrimate_test' } });
}
