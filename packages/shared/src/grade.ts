/** Grade spec engine: forms, listings and inspections are all generated from these structured parameters. */
export interface GradeParameter {
  key: string;
  label: string;
  unit: string;
  /** Numeric bounds a sample must fall within to meet the grade. */
  min?: number;
  max?: number;
  required: boolean;
}
export type GradeReadings = Record<string, number>;
export interface GradeCheck { ok: boolean; missing: string[]; invalid: string[]; outOfSpec: string[] }

export function checkReadings(spec: GradeParameter[], readings: GradeReadings): GradeCheck {
  const missing: string[] = [];
  const invalid: string[] = [];
  const outOfSpec: string[] = [];
  for (const p of spec) {
    const v = readings[p.key];
    if (v === undefined || v === null) {
      if (p.required) missing.push(p.key);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) { invalid.push(p.key); continue; }
    if ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max)) outOfSpec.push(p.key);
  }
  const known = new Set(spec.map((p) => p.key));
  for (const k of Object.keys(readings)) if (!known.has(k)) invalid.push(k);
  return { ok: !missing.length && !invalid.length && !outOfSpec.length, missing, invalid, outOfSpec };
}
