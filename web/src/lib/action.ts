import 'server-only';
import { isRedirectError } from 'next/dist/client/components/redirect-error';

export type ActionState = { error?: string; ok?: string } | undefined;

/** A message meant for the user. Anything else is logged and shown as a generic error, so internals never leak. */
export class UserError extends Error {}

export function fail(message: string): never {
  throw new UserError(message);
}

/**
 * Wraps a server action body: user-facing errors come back as { error }, redirects pass through.
 * Every server action is a public POST endpoint, so each body must check the viewer's rights itself.
 */
export async function run(body: () => Promise<string | void>): Promise<ActionState> {
  try {
    const ok = await body();
    return { ok: ok ?? 'Saved.' };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    if (err instanceof UserError) return { error: err.message };
    // Errors raised on purpose inside our SQL functions (errcode P0001) are written for users.
    const pg = err as { code?: string; message?: string };
    if (pg?.code === 'P0001' && pg.message) return { error: pg.message };
    console.error('[action]', err);
    return { error: 'Something went wrong. Please try again.' };
  }
}

/** Throws the Postgres error so run() can classify it. */
export function check<T>(res: { data: T; error: unknown }): NonNullable<T> {
  if (res.error) throw res.error;
  return res.data as NonNullable<T>;
}

export function text(form: FormData, name: string, max = 500): string | null {
  const v = form.get(name);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) fail(`${name.replace(/_/g, ' ')} is too long (max ${max} characters).`);
  return t;
}

export function required(form: FormData, name: string, label: string, max = 500): string {
  return text(form, name, max) ?? fail(`${label} is required.`);
}

export function int(form: FormData, name: string, label: string, { min = 1, max = 100_000_000 } = {}): number {
  const raw = form.get(name);
  const n = typeof raw === 'string' ? Number(raw.replace(/[,\s]/g, '')) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) fail(`${label} must be a whole number between ${min} and ${max}.`);
  return n;
}

/** Optional percentage, 0 to 100 with up to 2 decimals (quality specs). */
export function pct(form: FormData, name: string, label: string): number | null {
  const v = text(form, name, 8);
  if (v === null) return null;
  const n = Number(v);
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v) || n < 0 || n > 100) fail(`${label} must be a percentage between 0 and 100.`);
  return n;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(form: FormData, name: string): string {
  const v = form.get(name);
  if (typeof v !== 'string' || !UUID.test(v)) fail('Invalid request.');
  return v;
}
export function optionalUuid(form: FormData, name: string): string | null {
  const v = form.get(name);
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !UUID.test(v)) fail('Invalid request.');
  return v;
}

export function date(form: FormData, name: string): string | null {
  const v = text(form, name, 10);
  if (v === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) fail('Invalid date.');
  return v;
}

export function pin(form: FormData, name: string): string | null {
  const v = text(form, name, 6);
  if (v === null) return null;
  if (!/^[1-9]\d{5}$/.test(v)) fail('PIN code must be 6 digits.');
  return v;
}
