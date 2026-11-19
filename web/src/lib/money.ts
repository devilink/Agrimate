const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-IN');

/** Supabase returns bigint columns as numbers; amounts here stay far below 2^53 paise. */
export function rupees(paise: number | string | null | undefined): string {
  if (paise === null || paise === undefined || paise === '') return '—';
  return inr.format(Number(paise) / 100);
}

export function kg(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value >= 1000 && value % 100 === 0 ? `${num.format(value / 1000)} t` : `${num.format(value)} kg`;
}

/** "1,250.50" -> 125050. Returns null for anything that isn't a positive amount with at most 2 decimals. */
export function toPaise(input: FormDataEntryValue | null): number | null {
  if (typeof input !== 'string') return null;
  const clean = input.replace(/[,\s₹]/g, '');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return paise > 0 ? paise : null;
}

export function dateIN(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export function dateTimeIN(value: string): string {
  return new Date(value).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}
