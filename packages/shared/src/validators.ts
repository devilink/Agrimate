/** Format validators + masking. Formats only — real verification goes through the KYC adapter. */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const PIN_RE = /^[1-9][0-9]{5}$/;
export const PHONE_RE = /^\+91[6-9][0-9]{9}$/;
export const VEHICLE_NO_RE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/;

export const isValidPan = (v: string) => PAN_RE.test(v);
export const isValidIfsc = (v: string) => IFSC_RE.test(v);
export const isValidPin = (v: string) => PIN_RE.test(v);
export const isValidPhone = (v: string) => PHONE_RE.test(v);

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** GSTIN mod-36 check character for the first 14 characters. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GST_CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36]!;
}
export const isValidGstin = (v: string) => GSTIN_RE.test(v) && gstinCheckChar(v.slice(0, 14)) === v[14];
/** A GSTIN embeds the holder's PAN at positions 3–12. */
export const gstinMatchesPan = (gstin: string, pan: string) => gstin.slice(2, 12) === pan;

/** "+919876543210" → "+91******3210". */
export const maskPhone = (p: string) => (p.length >= 4 ? `${p.startsWith('+91') ? '+91' : ''}******${p.slice(-4)}` : '******');
export const maskPan = (p: string) => (p.length === 10 ? `${p.slice(0, 2)}******${p.slice(-2)}` : '********');
export const maskAccount = (a: string) => `****${a.slice(-4)}`;
export const normalisePhone = (raw: string) => {
  const d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith('91')) return `+${d}`;
  return d;
};
