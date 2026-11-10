'use client';
import type { BuyerOrder, Commodity, ListingView } from '@agrimate/api-client';
import { formatINR, formatTonnes, isValidPin } from '@agrimate/shared';
import { Badge, Button, EmptyState, Field, Input, Money, Select, Table, Td } from '@agrimate/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Checkbox, ErrorState, Fact, GradeSpecTable, KybBlockedNotice, PageHeader, PinInput, TableSkeleton } from '@/components/common';
import { ContractDialog } from '@/components/contract-dialog';
import { api } from '@/lib/api';
import { useAction, useResource } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { tonnesToKg } from '@/lib/units';

const HEAD = ['Listing', 'Produce', 'Quantity', 'Fixed price', 'Total', 'Pickup PIN', 'Farmer', ''];

export default function CatalogPage() {
  const router = useRouter();
  const { me, kybVerified } = useSession();
  const commodities = useResource(() => api.get<Commodity[]>('/masters/commodities'), []);
  // States have no master list, so the dropdown offers the states that have live listings.
  const allListings = useResource(() => api.get<ListingView[]>('/listings'), []);

  const [commodityId, setCommodityId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [organic, setOrganic] = useState(false);
  const [state, setState] = useState('');
  const [minT, setMinT] = useState('');
  const [maxT, setMaxT] = useState('');
  const [debouncedQty, setDebouncedQty] = useState({ minT: '', maxT: '' });

  useEffect(() => { setGradeId(''); }, [commodityId]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQty({ minT, maxT }), 350);
    return () => clearTimeout(t);
  }, [minT, maxT]);

  const minKg = debouncedQty.minT ? tonnesToKg(debouncedQty.minT) : undefined;
  const maxKg = debouncedQty.maxT ? tonnesToKg(debouncedQty.maxT) : undefined;
  const qtyError = minKg === null || maxKg === null ? 'Enter quantities in tonnes, up to 3 decimals.' : minKg !== undefined && maxKg !== undefined && minKg > maxKg ? 'The minimum is above the maximum.' : undefined;

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (commodityId) q.set('commodityId', commodityId);
    if (gradeId) q.set('gradeId', gradeId);
    if (organic) q.set('organic', 'true');
    if (state) q.set('state', state);
    if (minKg) q.set('minKg', String(minKg));
    if (maxKg) q.set('maxKg', String(maxKg));
    return q.toString();
  }, [commodityId, gradeId, organic, state, minKg, maxKg]);

  const listings = useResource(qtyError ? null : () => api.get<ListingView[]>(`/listings${query ? `?${query}` : ''}`), [query, !!qtyError]);
  const states = useMemo(() => [...new Set((allListings.data ?? []).map((l) => l.farmer.state).filter((s): s is string => !!s))].sort(), [allListings.data]);
  const commodity = commodities.data?.find((c) => c.id === commodityId);

  const [buying, setBuying] = useState<ListingView | null>(null);
  const [pin, setPin] = useState(me.buyer?.defaultPin ?? '');
  const accept = useAction();
  const confirm = () => {
    if (!buying) return;
    void accept.run(async () => {
      const order = await api.post<BuyerOrder>(`/listings/${buying.id}/accept`, { acceptContract: true, deliveryPin: pin });
      router.push(`/orders/${order.id}`);
    });
  };

  const clear = () => { setCommodityId(''); setOrganic(false); setState(''); setMinT(''); setMaxT(''); };
  const filtered = !!(commodityId || organic || state || minT || maxT);

  return (
    <>
      <PageHeader title="Catalog" description="Listings from verified farmers at a fixed price. Accepting creates an order for the full quantity." />
      <div className="space-y-4">
        <KybBlockedNotice action="buy from the catalog" />
        <form onSubmit={(e) => e.preventDefault()} aria-label="Filter listings" className="grid items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_7rem_7rem_auto]">
          <Field label="Commodity">
            <Select value={commodityId} onChange={(e) => setCommodityId(e.target.value)}>
              <option value="">All commodities</option>
              {commodities.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Grade">
            <Select value={gradeId} disabled={!commodity} onChange={(e) => setGradeId(e.target.value)}>
              <option value="">All grades</option>
              {commodity?.grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </Field>
          <Field label="Farmer state">
            <Select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All states</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Min tonnes"><Input inputMode="decimal" value={minT} onChange={(e) => setMinT(e.target.value)} /></Field>
          <Field label="Max tonnes"><Input inputMode="decimal" value={maxT} onChange={(e) => setMaxT(e.target.value)} /></Field>
          <div className="flex h-full flex-col justify-end gap-2 pb-2.5">
            <Checkbox label="Organic only" checked={organic} onChange={setOrganic} />
          </div>
          {qtyError && <p role="alert" className="text-xs text-red-700 sm:col-span-3 xl:col-span-6">{qtyError}</p>}
        </form>

        {listings.error && <ErrorState message={listings.error} onRetry={() => void listings.reload()} />}
        {listings.loading && !listings.data && <TableSkeleton head={HEAD} />}
        {listings.data?.length === 0 && (
          <EmptyState title={filtered ? 'No listings match these filters' : 'No listings right now'}>
            {filtered ? <Button variant="secondary" size="sm" onClick={clear}>Clear filters</Button> : 'You can post an RFQ to ask farmers for what you need.'}
          </EmptyState>
        )}
        {!!listings.data?.length && (
          <div className={listings.loading ? 'opacity-60' : undefined}>
            <Table head={HEAD}>
              {listings.data.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap">{l.code}</Td>
                  <Td>
                    <span className="inline-flex flex-wrap items-center gap-1.5">{l.commodity.name}, {l.grade.name}{l.isOrganic && <Badge tone="green">Organic</Badge>}</span>
                  </Td>
                  <Td className="tabular-nums whitespace-nowrap">{formatTonnes(l.quantityKg)}</Td>
                  <Td className="tabular-nums whitespace-nowrap">{formatINR(l.pricePaisePerKg)}/kg</Td>
                  <Td className="whitespace-nowrap font-medium"><Money paise={l.gmvPaise} /></Td>
                  <Td className="tabular-nums">{l.pickupPin}</Td>
                  <Td>
                    {l.farmer.name}{l.farmer.fpoName && `, ${l.farmer.fpoName}`}
                    <span className="block text-xs text-slate-500">{[l.farmer.district, l.farmer.state].filter(Boolean).join(', ')} · {l.farmer.phoneMasked}</span>
                  </Td>
                  <Td className="text-right"><Button size="sm" disabled={!kybVerified} onClick={() => { accept.clearError(); setBuying(l); }}>Accept</Button></Td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </div>

      <ContractDialog open={!!buying} title="Accept at fixed price" confirmLabel="Accept and create order" busy={accept.busy} error={accept.error} canConfirm={isValidPin(pin)} onConfirm={confirm} onClose={() => setBuying(null)}>
        {buying && (
          <div className="space-y-3">
            <dl className="grid gap-x-8 rounded-md border border-slate-200 px-3 py-1 sm:grid-cols-2">
              <Fact label="Produce">{buying.commodity.name}, {buying.grade.name}</Fact>
              <Fact label="Quantity">{formatTonnes(buying.quantityKg)}</Fact>
              <Fact label="Price"><span className="tabular-nums">{formatINR(buying.pricePaisePerKg)}/kg</span></Fact>
              <Fact label="Order value"><Money paise={buying.gmvPaise} /></Fact>
              <Fact label="Farmer">{buying.farmer.name}</Fact>
              <Fact label="Organic">{buying.isOrganic ? <Badge tone="green">Organic</Badge> : 'No'}</Fact>
            </dl>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">Grade parameters</summary>
              <div className="mt-2"><GradeSpecTable parameters={buying.grade.parameters} /></div>
            </details>
            <div className="max-w-xs">
              <Field label="Delivery PIN" error={pin && !isValidPin(pin) ? 'Enter a 6 digit PIN.' : undefined}><PinInput value={pin} disabled={accept.busy} onChange={setPin} /></Field>
            </div>
          </div>
        )}
      </ContractDialog>
    </>
  );
}
