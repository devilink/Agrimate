/** Store UTC, display IST. IST is a fixed +05:30 with no DST, so plain arithmetic is correct and needs no tz database. */
export const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** The IST calendar date of an instant, as YYYY-MM-DD. */
export const istDateString = (d: Date): string => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
/** UTC instant of 00:00:00.000 IST on the IST day containing `d`. */
export function startOfIstDay(d: Date): Date {
  const shifted = d.getTime() + IST_OFFSET_MS;
  return new Date(shifted - (shifted % DAY_MS) - IST_OFFSET_MS);
}
/** UTC instant of 23:59:59.999 IST on the IST day containing `d`. */
export const endOfIstDay = (d: Date): Date => new Date(startOfIstDay(d).getTime() + DAY_MS - 1);
export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * DAY_MS);
export const addHours = (d: Date, hours: number): Date => new Date(d.getTime() + hours * HOUR_MS);

/** Inspection day = the IST day `slaDays` after T0. */
export const inspectionDay = (t0: Date, slaDays: number): Date => startOfIstDay(addDays(t0, slaDays));

/** SLA deadline = T0 + SLA days; by default the end of that IST day (configurable to the exact instant). */
export function slaDeadline(t0: Date, slaDays: number, endOfDay = true): Date {
  const at = addDays(t0, slaDays);
  return endOfDay ? endOfIstDay(at) : at;
}

/** Self-certification fallback fires T−24 h before the start of inspection day, but never in the past. */
export function selfCertFallbackAt(t0: Date, slaDays: number, hoursBefore = 24): Date {
  const at = addHours(inspectionDay(t0, slaDays), -hoursBefore);
  return at.getTime() < t0.getTime() ? t0 : at;
}

export const formatIST = (d: Date | string): string =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
