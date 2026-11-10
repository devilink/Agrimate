/**
 * Conversions between what people type and what the API stores. These work on the decimal text, never on floats,
 * so 19.99 rupees is exactly 1999 paise and 10.125 tonnes is exactly 10125 kg.
 */
const clean = (s: string) => s.replace(/[,\s]/g, '');

/** "1,500.50" → "150050". Returns null when the text is not a rupee amount with at most 2 decimals. */
export function rupeesToPaise(input: string): string | null {
  const s = clean(input);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.') as [string, string?];
  return (BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0') || '0')).toString();
}

/** "10.5" → 10500. Returns null when the text is not a weight with at most 3 decimals. */
export function tonnesToKg(input: string): number | null {
  const s = clean(input);
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.') as [string, string?];
  const kg = BigInt(whole) * 1000n + BigInt(frac.padEnd(3, '0') || '0');
  return kg <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(kg) : null;
}

/** "150050" → "1500.50", for filling a rupee input from a paise value. */
export function paiseToRupeesInput(paise: string): string {
  const v = BigInt(paise);
  return `${v / 100n}.${(v % 100n).toString().padStart(2, '0')}`;
}

/** Quantity × per-kg price, in exact paise. */
export const lineTotalPaise = (quantityKg: number, pricePaisePerKg: string): string => (BigInt(quantityKg) * BigInt(pricePaisePerKg)).toString();

export const formatKg = (kg: number): string => `${kg.toLocaleString('en-IN')} kg`;

/** IST calendar date for an instant. */
export const formatISTDate = (d: string | Date): string =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }).format(new Date(d));
