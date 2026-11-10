/**
 * Re-encrypts stored PII under a new key. Previews by default; pass --apply to write.
 * Steps are in the README. Does not rotate PII_HASH_KEY, which would need every blind index recomputed.
 */
import { PrismaClient } from '@prisma/client';
import { CryptoService } from '../src/core/core';
import { rotatePiiKey } from '../src/core/pii-rotation';

async function main() {
  const dryRun = !process.argv.includes('--apply');
  if (!process.env.PII_ENCRYPTION_KEY_PREVIOUS) throw new Error('Set PII_ENCRYPTION_KEY_PREVIOUS to the old key and PII_ENCRYPTION_KEY to the new one');
  const prisma = new PrismaClient();
  try {
    const reports = await rotatePiiKey(prisma, new CryptoService(), { dryRun });
    console.table(reports);
    const unreadable = reports.reduce((n, r) => n + r.unreadable, 0);
    console.log(dryRun ? 'Preview only, nothing was written. Re-run with --apply.' : 'Rotation finished.');
    if (unreadable > 0) {
      console.error(`${unreadable} value(s) could not be read with either key and were left unchanged. Keep the old key until this is explained.`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
