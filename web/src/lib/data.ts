import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Commodity, Party } from '@/lib/types';

export async function getCommodities(includeInactive = false): Promise<Commodity[]> {
  const supabase = await createClient();
  let q = supabase.from('commodities').select('*').order('name');
  if (!includeInactive) q = q.eq('active', true);
  const { data } = await q;
  return (data ?? []) as Commodity[];
}

/** Public party info (name, type, district) for display. Contact details are never part of this. */
export async function getPartyMap(ids: (string | null | undefined)[]): Promise<Map<string, Party>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from('parties').select('*').in('id', unique);
  return new Map((data ?? []).map((p) => [p.id, p as Party]));
}

export async function getPartiesOfType(type: Party['type']): Promise<Party[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('parties').select('*').eq('type', type).eq('active', true).order('name');
  return (data ?? []) as Party[];
}

export function partyLabel(p: Party | undefined): string {
  if (!p) return '—';
  const place = [p.district, p.state].filter(Boolean).join(', ');
  return [p.company || p.name, place].filter(Boolean).join(' · ');
}
