import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const LOCAL_URL = 'postgresql://agrimate:agrimate@localhost:15433/agrimate_test';

/**
 * Brings the throwaway test database up to the latest schema before any suite runs. With TEST_DATABASE_URL unset, that is
 * a temporary Postgres started just for this run, so tests can never reach a real database by default.
 * DIRECT_URL is always set here: left unset, Prisma would read it from apps/api/.env and migrate the real database.
 */
export default async function setup() {
  const external = process.env.TEST_DATABASE_URL;
  let stop = async () => {};
  if (!external) {
    const databaseDir = mkdtempSync(join(tmpdir(), 'agrimate-test-pg-'));
    const pg = new EmbeddedPostgres({ databaseDir, user: 'agrimate', password: 'agrimate', port: 15433, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('agrimate_test');
    stop = async () => { await pg.stop(); rmSync(databaseDir, { recursive: true, force: true }); };
  }
  const url = external ?? LOCAL_URL;
  execSync('pnpm exec prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url, DIRECT_URL: process.env.TEST_DIRECT_URL ?? url } });
  return stop;
}
