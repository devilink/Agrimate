'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Countdown, Field, Input, Money, Select, StateBadge, Table, Td, humanise } from '@agrimate/ui';
import { OrderState, formatTonnes } from '@agrimate/shared';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { Ist, OrderLink, PageHeader, Q } from '@/components/console';
import type { AdminOrderRow } from '@/lib/types';

export default function OrdersPage() {
  const router = useRouter();
  const params = useSearchParams();
  const state = params.get('state') ?? '';
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);

  const orders = useLoad(() => {
    const p = new URLSearchParams();
    if (state) p.set('state', state);
    if (q) p.set('q', q);
    const qs = p.toString();
    return api.get<AdminOrderRow[]>(`/admin/orders${qs ? `?${qs}` : ''}`);
  }, [state, q]);

  const go = (next: { state?: string; q?: string }) => {
    const p = new URLSearchParams();
    const s = next.state ?? state; const t = next.q ?? q;
    if (s) p.set('state', s);
    if (t) p.set('q', t);
    router.replace(p.size ? `/orders?${p}` : '/orders');
  };

  return (
    <>
      <PageHeader title="Orders" description="Latest 200 matching orders, newest first." />
      <form className="mb-3 flex flex-wrap items-end gap-3" onSubmit={(e: FormEvent) => { e.preventDefault(); go({ q: search.trim() }); }}>
        <div className="w-56">
          <Field label="State">
            <Select value={state} onChange={(e) => go({ state: e.target.value })}>
              <option value="">All states</option>
              {Object.values(OrderState).map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
            </Select>
          </Field>
        </div>
        <div className="w-64"><Field label="Order code"><Input type="search" placeholder="AGR-" value={search} onChange={(e) => setSearch(e.target.value)} /></Field></div>
        <Button type="submit" variant="secondary">Search</Button>
        {(state || q) && <Button type="button" variant="ghost" onClick={() => { setSearch(''); router.replace('/orders'); }}>Clear filters</Button>}
      </form>

      <Q q={orders} isEmpty={(d) => d.length === 0} emptyTitle="No orders match" emptyBody={state || q ? 'Try a different state or code.' : 'Orders appear here once a bid or listing is accepted.'}>
        {(rows) => (
          <Table head={['Code', 'State', 'Flow', 'Commodity', 'Quantity', 'GMV', 'Buyer', 'Farmer', 'SLA', 'Created']}>
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <Td><OrderLink id={o.id} code={o.code} /></Td>
                <Td><StateBadge state={o.state} /></Td>
                <Td>{humanise(o.flow)}</Td>
                <Td>{o.commodity}<span className="block text-xs text-slate-500">{o.grade}</span></Td>
                <Td className="whitespace-nowrap tabular-nums">{formatTonnes(o.quantityKg)}</Td>
                <Td className="whitespace-nowrap"><Money paise={o.gmvPaise} /></Td>
                <Td>{o.buyer}</Td>
                <Td>{o.farmer}</Td>
                <Td className="whitespace-nowrap"><Countdown to={o.slaDeadlineAt} /></Td>
                <Td><Ist at={o.createdAt} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Q>
    </>
  );
}
