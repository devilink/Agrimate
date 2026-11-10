/**
 * Exact conversions between what an operator types (rupees) and what the API stores (integer paise strings).
 * Works on the decimal text only. Number() never touches an amount, so nothing can pick up float error.
 */
export type RupeeParse = { ok: true; paise: string } | { ok: false; error: string };

export function rupeesToPaise(input: string): RupeeParse {
  const s = input.trim().replace(/,/g, '').replace(/^₹\s*/, '');
  if (s === '') return { ok: false, error: 'Enter an amount in rupees' };
  if (s.startsWith('-')) return { ok: false, error: 'The amount cannot be negative' };
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === '' && !m[2])) return { ok: false, error: 'Enter a number, such as 1500 or 1500.50' };
  const frac = m[2] ?? '';
  if (frac.length > 2) return { ok: false, error: 'Rupees can have at most two decimal places' };
  const digits = `${m[1]}${frac.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  return { ok: true, paise: digits };
}

/** Integer paise string to plain rupee text for an input box: "150050" to "1500.50", "150000" to "1500". */
export function paiseToRupees(paise: string): string {
  const neg = paise.startsWith('-');
  const d = (neg ? paise.slice(1) : paise).padStart(3, '0');
  const whole = d.slice(0, -2);
  const frac = d.slice(-2);
  return `${neg ? '-' : ''}${whole}${frac === '00' ? '' : `.${frac}`}`;
}

export const isPositive = (paise: string) => BigInt(paise) > 0n;
export const isNegative = (paise: string) => BigInt(paise) < 0n;
export const absPaise = (paise: string) => (paise.startsWith('-') ? paise.slice(1) : paise);
