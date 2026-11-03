/**
 * Money utilities. Every amount is integer paise as a BigInt; floats never touch money.
 * Over JSON, amounts travel as decimal strings (see `paise()`), because JSON numbers lose precision.
 */
export const PAISE_PER_RUPEE = 100n;
export const BPS_DENOMINATOR = 10_000n;

/** Coerces a BigInt, integer-string or safe integer to BigInt paise; rejects anything fractional. */
export function paise(v: bigint | string | number): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new RangeError(`Not an integer paise amount: ${v}`);
    return BigInt(v);
  }
  if (!/^-?\d+$/.test(v)) throw new RangeError(`Not an integer paise amount: ${v}`);
  return BigInt(v);
}

export const rupees = (r: number | bigint): bigint => {
  if (typeof r === 'bigint') return r * PAISE_PER_RUPEE;
  const p = Math.round(r * 100);
  if (Math.abs(r * 100 - p) > 1e-6) throw new RangeError(`Sub-paisa rupee value: ${r}`);
  return BigInt(p);
};

/** a × n ÷ d, rounded half-up (away from zero for negatives). d must be positive. */
export function mulDivRound(a: bigint, n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError('Denominator must be positive');
  const num = a * n;
  const half = d / 2n;
  return num >= 0n ? (num + half) / d : -((-num + half) / d);
}

export const applyBps = (amount: bigint, bps: number | bigint): bigint => mulDivRound(amount, BigInt(bps), BPS_DENOMINATOR);

/** Indian digit grouping: 15000000n → "₹1,50,000"; paise shown only when non-zero (or if asked). */
export function formatINR(value: bigint | string | number, opts: { alwaysPaise?: boolean; symbol?: string } = {}): string {
  const v = paise(value);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const r = (abs / PAISE_PER_RUPEE).toString();
  const p = (abs % PAISE_PER_RUPEE).toString().padStart(2, '0');
  const last3 = r.slice(-3);
  const rest = r.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  const sym = opts.symbol ?? '₹';
  return `${neg ? '-' : ''}${sym}${grouped}${p !== '00' || opts.alwaysPaise ? `.${p}` : ''}`;
}

/** Whole kg → human tonnes, e.g. 10500 → "10.5 t". */
export const formatTonnes = (kg: number): string => `${Number((kg / 1000).toFixed(3))} t`;
export const tonnesToKg = (t: number): number => Math.round(t * 1000);
