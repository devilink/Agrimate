import 'server-only';
import { PAYMENT_METHOD_LABEL } from '@/lib/orders';
import type { PaymentMethod } from '@/lib/types';

export interface LedgerFilters {
  direction?: 'in' | 'out';
  method?: PaymentMethod;
  status?: 'confirmed' | 'void';
  from?: string;
  to?: string;
  ref?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads filters from the URL, dropping anything invalid. */
export function parseLedgerFilters(sp: Record<string, string | undefined>): LedgerFilters {
  return {
    direction: sp.direction === 'in' || sp.direction === 'out' ? sp.direction : undefined,
    method: sp.method && sp.method in PAYMENT_METHOD_LABEL ? (sp.method as PaymentMethod) : undefined,
    status: sp.status === 'confirmed' || sp.status === 'void' ? sp.status : undefined,
    from: sp.from && DATE.test(sp.from) ? sp.from : undefined,
    to: sp.to && DATE.test(sp.to) ? sp.to : undefined,
    ref: (sp.ref ?? '').replace(/[%,().*\\:"']/g, '').trim().slice(0, 60) || undefined,
  };
}

/**
 * Applies these filters to a payments query (newest first) and returns the same builder. Deliberately not async:
 * Supabase query builders are thenable, so an async function would run the query instead of returning it.
 */
export function filterLedger<T>(query: T, f: LedgerFilters): T {
  // The builder's generic types are too deep to restate here; the chain below uses only order/eq/gte/lte/ilike.
  let q = (query as unknown as Chain).order('paid_on', { ascending: false }).order('created_at', { ascending: false });
  if (f.direction) q = q.eq('direction', f.direction);
  if (f.method) q = q.eq('method', f.method);
  if (f.status) q = q.eq('status', f.status);
  if (f.from) q = q.gte('paid_on', f.from);
  if (f.to) q = q.lte('paid_on', f.to);
  if (f.ref) q = q.ilike('reference', `%${f.ref}%`);
  return q as unknown as T;
}

interface Chain {
  order(col: string, o: { ascending: boolean }): Chain;
  eq(col: string, v: string): Chain;
  gte(col: string, v: string): Chain;
  lte(col: string, v: string): Chain;
  ilike(col: string, v: string): Chain;
}
