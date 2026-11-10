/**
 * The rules behind the grading form, separate from the screen so that they can be tested without a phone.
 * Types and logic only: this file has no React Native imports.
 */
import type { GradeParameter } from '@agrimate/shared';

export const NUMBER_RE = /^-?\d+(\.\d+)?$/;

export type ReadingState = 'empty' | 'invalid' | 'in-spec' | 'out-of-spec';

export function specText(p: GradeParameter): string {
  const unit = p.unit ? ` ${p.unit}` : '';
  if (p.min !== undefined && p.max !== undefined) return `Allowed: ${p.min} to ${p.max}${unit}`;
  if (p.min !== undefined) return `Allowed: at least ${p.min}${unit}`;
  if (p.max !== undefined) return `Allowed: at most ${p.max}${unit}`;
  return 'No limit set for this grade';
}

/** Some Indian keyboards offer a comma as the decimal key, so it is accepted here. */
export const parseReading = (text: string): number | null => {
  const t = text.trim().replace(',', '.');
  return NUMBER_RE.test(t) ? Number(t) : null;
};

export function readingState(p: GradeParameter, text: string | undefined): ReadingState {
  if (!text || !text.trim()) return 'empty';
  const v = parseReading(text);
  if (v === null) return 'invalid';
  if ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max)) return 'out-of-spec';
  return 'in-spec';
}

export const isValidScale = (text: string) => /^\d+$/.test(text.trim()) && Number(text) >= 1;

/** Exactly the body the API takes: optional parameters left empty are left out, and every value is a number. */
export function readingsPayload(spec: GradeParameter[], values: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of spec) {
    const v = parseReading(values[p.key] ?? '');
    if (v !== null) out[p.key] = v;
  }
  return out;
}

export interface GradingState { checkedIn: boolean; spec: GradeParameter[]; values: Record<string, string>; scale: string; photoCount: number; online: boolean }

/** Every reason Mark as Inspected is unavailable, in the order the inspector would fix them. */
export function missingForMark(s: GradingState): string[] {
  const missing: string[] = [];
  if (!s.checkedIn) missing.push('Check in at the pickup point.');
  for (const p of s.spec) {
    const state = readingState(p, s.values[p.key]);
    if (state === 'invalid') missing.push(`${p.label} must be a number.`);
    else if (state === 'empty' && p.required) missing.push(`Enter ${p.label}.`);
  }
  if (!isValidScale(s.scale)) missing.push('Enter the weighing-scale reading in whole kg.');
  if (s.photoCount < 1) missing.push('Take at least one photo.');
  if (!s.online) missing.push('Connect to the internet to send the inspection.');
  return missing;
}

export const outOfSpecLabels = (spec: GradeParameter[], values: Record<string, string>) => spec.filter((p) => readingState(p, values[p.key]) === 'out-of-spec').map((p) => p.label);
