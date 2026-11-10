'use client';
import type { Commodity, PricePoint } from '@agrimate/api-client';
import { formatINR } from '@agrimate/shared';
import { Alert, Card, EmptyState, Field, Select, Skeleton, Table, Td } from '@agrimate/ui';
import { useEffect, useMemo, useState } from 'react';
import { ErrorState, PageHeader } from '@/components/common';
import { api } from '@/lib/api';
import { useResource } from '@/lib/hooks';
import { formatPriceDate, PriceChart } from './price-chart';

const ALL = '__all__';
const REAL_SOURCES = ['agmarknet'];

/** Min, max and latest of one market's series, compared as exact integers. */
function summarise(points: PricePoint[]) {
  const last = points[points.length - 1]!;
  let low = points[0]!.minPaisePerKg;
  let high = points[0]!.maxPaisePerKg;
  for (const p of points) {
    if (BigInt(p.minPaisePerKg) < BigInt(low)) low = p.minPaisePerKg;
    if (BigInt(p.maxPaisePerKg) > BigInt(high)) high = p.maxPaisePerKg;
  }
  return { last, low, high };
}

export default function PricesPage() {
  const commodities = useResource(() => api.get<Commodity[]>('/masters/commodities'), []);
  const [commodityId, setCommodityId] = useState('');
  const [market, setMarket] = useState('');

  useEffect(() => {
    if (!commodityId && commodities.data?.[0]) setCommodityId(commodities.data[0].id);
  }, [commodityId, commodities.data]);

  const markets = useResource(commodityId ? () => api.get<{ market: string; state: string }[]>(`/market/markets?commodityId=${commodityId}`) : null, [commodityId]);
  // One request per commodity holds every market, so switching market redraws instantly.
  const prices = useResource(commodityId ? () => api.get<PricePoint[]>(`/market/prices?commodityId=${commodityId}&months=6`) : null, [commodityId]);

  const allMarkets = useMemo(() => (markets.data ?? []).map((m) => m.market).sort(), [markets.data]);
  useEffect(() => {
    if (allMarkets.length && market !== ALL && !allMarkets.includes(market)) setMarket(allMarkets[0]!);
  }, [allMarkets, market]);

  const shownMarkets = market === ALL ? allMarkets : allMarkets.includes(market) ? [market] : [];
  const commodity = commodities.data?.find((c) => c.id === commodityId);
  const points = prices.data ?? [];
  const shownPoints = useMemo(() => points.filter((p) => shownMarkets.includes(p.market)), [points, shownMarkets]);
  const synthetic = points.some((p) => !REAL_SOURCES.includes(p.source));
  const refetching = prices.loading && !!prices.data;
  const summaries = useMemo(() => shownMarkets.map((m) => ({ market: m, points: shownPoints.filter((p) => p.market === m) })).filter((s) => s.points.length).map((s) => ({ market: s.market, ...summarise(s.points) })), [shownMarkets, shownPoints]);

  return (
    <>
      <PageHeader title="Market prices" description="Six months of daily mandi prices per kg: the modal price, with the minimum and maximum traded that day." />
      <div className="space-y-4">
        <form onSubmit={(e) => e.preventDefault()} aria-label="Choose commodity and market" className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="Commodity">
              <Select value={commodityId} disabled={commodities.loading} onChange={(e) => setCommodityId(e.target.value)}>
                {commodities.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="w-56">
            <Field label="Market">
              <Select value={market} disabled={!allMarkets.length} onChange={(e) => setMarket(e.target.value)}>
                {markets.data?.map((m) => <option key={m.market} value={m.market}>{m.market}, {m.state}</option>)}
                {allMarkets.length > 1 && <option value={ALL}>Compare all markets</option>}
              </Select>
            </Field>
          </div>
        </form>

        {commodities.error && <ErrorState message={commodities.error} onRetry={() => void commodities.reload()} />}
        {markets.error && <ErrorState message={markets.error} onRetry={() => void markets.reload()} />}
        {prices.error && <ErrorState message={prices.error} onRetry={() => void prices.reload()} />}
        {synthetic && <Alert tone="amber">Demo data: these prices are synthetic and are not real market quotes. Do not use them for trading decisions.</Alert>}

        {(prices.loading || commodities.loading) && !prices.data && !prices.error && <Card><Skeleton className="h-[340px] w-full" /></Card>}
        {prices.data && shownPoints.length === 0 && !prices.loading && <EmptyState title="No prices for this selection">Choose another commodity or market.</EmptyState>}

        {shownPoints.length > 0 && commodity && (
          <div className={refetching ? 'space-y-4 opacity-60' : 'space-y-4'}>
            <Card>
              <h2 className="mb-3 text-base font-semibold text-slate-900">{commodity.name}, {market === ALL ? 'modal price by market' : market}</h2>
              <PriceChart points={shownPoints} markets={shownMarkets} allMarkets={allMarkets} commodityName={commodity.name} />
            </Card>
            <Table head={['Market', 'Latest date', 'Latest modal', 'Latest minimum', 'Latest maximum', '6 month low', '6 month high']}>
              {summaries.map((s) => (
                <tr key={s.market}>
                  <Td className="font-medium">{s.market}</Td>
                  <Td className="whitespace-nowrap">{formatPriceDate(s.last.date)}</Td>
                  <Td className="font-medium tabular-nums">{formatINR(s.last.modalPaisePerKg)}</Td>
                  <Td className="tabular-nums">{formatINR(s.last.minPaisePerKg)}</Td>
                  <Td className="tabular-nums">{formatINR(s.last.maxPaisePerKg)}</Td>
                  <Td className="tabular-nums">{formatINR(s.low)}</Td>
                  <Td className="tabular-nums">{formatINR(s.high)}</Td>
                </tr>
              ))}
            </Table>
            <details className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">Table view of all {shownPoints.length} prices</summary>
              <div tabIndex={0} aria-label="All prices" className="mt-2 max-h-96 overflow-y-auto">
                <Table head={['Date', 'Market', 'Minimum', 'Modal', 'Maximum']}>
                  {[...shownPoints].reverse().map((p) => (
                    <tr key={`${p.date}-${p.market}`}>
                      <Td className="whitespace-nowrap">{formatPriceDate(p.date)}</Td>
                      <Td>{p.market}</Td>
                      <Td className="tabular-nums">{formatINR(p.minPaisePerKg)}</Td>
                      <Td className="font-medium tabular-nums">{formatINR(p.modalPaisePerKg)}</Td>
                      <Td className="tabular-nums">{formatINR(p.maxPaisePerKg)}</Td>
                    </tr>
                  ))}
                </Table>
              </div>
            </details>
          </div>
        )}
      </div>
    </>
  );
}
