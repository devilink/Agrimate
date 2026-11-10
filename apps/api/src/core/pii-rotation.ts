import type { PrismaClient } from '@prisma/client';
import type { CryptoService } from './core';

/** Every column holding AES-GCM ciphertext. A new *Enc column in the schema must be added here. */
export const ENCRYPTED_COLUMNS = [
  { table: 'User', key: 'id', column: 'phoneEnc' },
  { table: 'BuyerProfile', key: 'userId', column: 'panEnc' },
  { table: 'FarmerProfile', key: 'userId', column: 'panEnc' },
  { table: 'FarmerProfile', key: 'userId', column: 'bankAccountEnc' },
  { table: 'Order', key: 'id', column: 'externalDriverPhoneEnc' },
] as const;

export interface RotationReport { table: string; column: string; scanned: number; rotated: number; alreadyCurrent: number; unreadable: number }

const BATCH = 500;

/**
 * Rewrites PII from PII_ENCRYPTION_KEY_PREVIOUS to PII_ENCRYPTION_KEY. Safe to re-run and to interrupt.
 * Uses raw SQL so that rotating a key doesn't touch updatedAt. Each write is conditional on the row still holding the
 * value that was read, so a concurrent change is never overwritten. Rows that neither key can open are counted and left alone.
 */
export async function rotatePiiKey(prisma: PrismaClient, crypto: CryptoService, opts: { dryRun: boolean }): Promise<RotationReport[]> {
  const reports: RotationReport[] = [];
  for (const { table, key, column } of ENCRYPTED_COLUMNS) {
    const report: RotationReport = { table, column, scanned: 0, rotated: 0, alreadyCurrent: 0, unreadable: 0 };
    let after = '';
    for (;;) {
      // Identifiers come from the constant above, never from input.
      const rows = await prisma.$queryRawUnsafe<{ id: string; value: string }[]>(
        `SELECT "${key}" AS id, "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL AND "${key}" > $1 ORDER BY "${key}" LIMIT ${BATCH}`, after,
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        report.scanned++;
        if (crypto.usesCurrentKey(row.value)) { report.alreadyCurrent++; continue; }
        let plain: string;
        try { plain = crypto.decrypt(row.value); } catch { report.unreadable++; continue; }
        if (!opts.dryRun) {
          const changed = await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "${column}" = $1 WHERE "${key}" = $2 AND "${column}" = $3`, crypto.encrypt(plain), row.id, row.value);
          if (changed === 0) continue; // Changed since we read it, and so already written under the current key.
        }
        report.rotated++;
      }
      after = rows[rows.length - 1]!.id;
    }
    reports.push(report);
  }
  return reports;
}
