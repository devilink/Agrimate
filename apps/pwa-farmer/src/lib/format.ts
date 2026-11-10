import { formatINR } from '@agrimate/shared';
import type { T } from './i18n';

/** Rupees as typed ("26" or "26.50") to integer paise, without touching floats. Null if it is not a valid amount. */
export function rupeesToPaise(input: string): string | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  return String(BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0')));
}
/** Paise back to what goes in a price box: 2650 becomes "26.50", 2600 becomes "26". */
export function paiseToRupees(paise: string): string {
  const v = BigInt(paise);
  const p = v % 100n;
  return `${v / 100n}${p ? `.${String(p).padStart(2, '0')}` : ''}`;
}
/** Tonnes as typed to whole kg. Null if it is not a positive number with at most 3 decimals. */
export function tonnesToWholeKg(input: string): number | null {
  const m = /^(\d{1,6})(?:\.(\d{1,3}))?$/.exec(input.trim());
  if (!m) return null;
  const kg = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
  return kg > 0 ? kg : null;
}

export const qtyText = (kg: number, t: T) => (kg >= 1000 ? t('unit.tonnes', { n: Number((kg / 1000).toFixed(3)) }) : t('unit.kg', { n: kg }));
export const pricePerKg = (paise: string, t: T) => t('unit.perKg', { price: formatINR(paise) });
