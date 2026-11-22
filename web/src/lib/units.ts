// Display units for quantity and price. Storage is always integer kg and paise per kg; only the display changes.
// Mandis quote rupees per quintal (100 kg), so traders often think in quintals; large lots in tonnes.

export type Unit = 'kg' | 'qtl' | 't';

export const UNITS: { id: Unit; label: string; short: string; kg: number }[] = [
  { id: 'kg', label: 'Kilogram', short: 'kg', kg: 1 },
  { id: 'qtl', label: 'Quintal (100 kg)', short: 'qtl', kg: 100 },
  { id: 't', label: 'Tonne (1000 kg)', short: 't', kg: 1000 },
];

export function parseUnit(v: string | undefined | null): Unit {
  return v === 'qtl' || v === 't' ? v : 'kg';
}

const kgPer = (u: Unit) => UNITS.find((x) => x.id === u)!.kg;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** 250000 kg in tonnes -> "250 t". */
export function qtyIn(kg: number | null | undefined, unit: Unit): string {
  if (kg === null || kg === undefined) return '—';
  return `${num.format(kg / kgPer(unit))} ${unit}`;
}

/** 2450 paise/kg per quintal -> "₹2,450.00 / qtl". */
export function priceIn(paisePerKg: number | null | undefined, unit: Unit): string {
  if (paisePerKg === null || paisePerKg === undefined) return '—';
  return `${inr.format((Number(paisePerKg) * kgPer(unit)) / 100)} / ${unit}`;
}

/** Reference prices are stored as paise/kg, which is numerically rupees per quintal. */
export function perQuintal(paisePerKg: number | null | undefined): string {
  if (paisePerKg === null || paisePerKg === undefined) return '—';
  return `₹${num.format(Number(paisePerKg))}`;
}

/** Signed percentage difference, e.g. "+3.2%". */
export function pctDiff(value: number, reference: number): string {
  if (!reference) return '—';
  const d = ((value - reference) / reference) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}
