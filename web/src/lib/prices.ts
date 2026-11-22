import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { MarketPrice } from '@/lib/types';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export interface Benchmark {
  modal: number;          // paise per kg (= ₹ per quintal), average of each market's latest price
  latestDate: string;
  markets: MarketPrice[]; // the latest entry per market used for the average
}

/**
 * The reference price for a commodity: each market's most recent entry from the last `windowDays`, averaged.
 * Null when the team hasn't entered any recent prices. Never simulated.
 */
export async function getBenchmark(commodityId: string, windowDays = 30): Promise<Benchmark | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('market_prices').select('*')
    .eq('commodity_id', commodityId).gte('price_date', daysAgo(windowDays))
    .order('price_date', { ascending: false }).limit(500);
  const rows = (data ?? []) as MarketPrice[];
  if (rows.length === 0) return null;
  const latest = new Map<string, MarketPrice>();
  for (const r of rows) if (!latest.has(r.market)) latest.set(r.market, r); // rows are newest first
  const markets = [...latest.values()];
  return {
    modal: Math.round(markets.reduce((s, m) => s + Number(m.modal_paise_per_kg), 0) / markets.length),
    latestDate: rows[0].price_date,
    markets,
  };
}

export async function getPriceHistory(commodityId: string, days = 90): Promise<MarketPrice[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('market_prices').select('*')
    .eq('commodity_id', commodityId).gte('price_date', daysAgo(days))
    .order('price_date', { ascending: false }).limit(1000);
  return (data ?? []) as MarketPrice[];
}
