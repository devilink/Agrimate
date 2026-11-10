'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, EmptyState, Field, Input, Money, StateBadge, Table, Td, humanise } from '@agrimate/ui';
import { api, errorMessage } from '@/lib/api';
import { absPaise, isNegative, isPositive } from '@/lib/money';
import { useLoad } from '@/lib/use-load';
import { Ist, Mono, OrderLink, PageHeader, Q, Section, Tabs } from '@/components/console';
import type { AdminOrderRow, EscrowView, Journal, LedgerAccounts } from '@/lib/types';

type Tab = 'accounts' | 'journals' | 'escrow';

/** Debit positive, credit negative, as stored. Always shown in two columns so that the sign is never left to the reader. */
const DebitCell = ({ paise }: { paise: string }) => <Td className="text-right whitespace-nowrap">{isPositive(paise) ? <Money paise={paise} /> : ''}</Td>;
const CreditCell = ({ paise }: { paise: string }) => <Td className="text-right whitespace-nowrap">{isNegative(paise) ? <Money paise={absPaise(paise)} /> : ''}</Td>;

export default function LedgerPage() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (['accounts', 'journals', 'escrow'].includes(params.get('tab') ?? '') ? params.get('tab') : 'accounts') as Tab;
  return (
    <>
      <PageHeader title="Ledger and escrow" description="Double-entry and read-only. Stored amounts are signed: positive is a debit and negative is a credit." />
      <Tabs label="Ledger views" value={tab} onChange={(k) => router.replace(`/ledger?tab=${k}`)} items={[{ key: 'accounts', label: 'Accounts' }, { key: 'journals', label: 'Journals' }, { key: 'escrow', label: 'Escrow by order' }]} />
      {tab === 'accounts' && <Accounts />}
      {tab === 'journals' && <Journals orderId={params.get('orderId') ?? ''} />}
      {tab === 'escrow' && <Escrow />}
    </>
  );
}

function Accounts() {
  const q = useLoad(() => api.get<LedgerAccounts>('/admin/ledger/accounts'), []);
  const [filter, setFilter] = useState('');
  return (
    <Q q={q} isEmpty={(d) => d.accounts.length === 0} emptyTitle="No ledger accounts yet" emptyBody="Accounts appear once the first payment is recorded.">
      {(d) => {
        const zero = BigInt(d.trialBalancePaise) === 0n;
        const rows = d.accounts.filter((a) => a.code.toLowerCase().includes(filter.trim().toLowerCase()) || a.type.toLowerCase().includes(filter.trim().toLowerCase()));
        return (
          <>
            {zero ? <Alert tone="green" className="mb-3">Trial balance is zero. Debits equal credits.</Alert> : (
              <div role="alert" className="mb-3 rounded-lg border-2 border-red-700 bg-red-700 p-4 font-semibold text-white">The ledger is out of balance by <Money paise={d.trialBalancePaise} />. Treat these balances as unreliable and tell engineering.</div>
            )}
            <div className="mb-3 w-72"><Field label="Filter by account or type"><Input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} /></Field></div>
            {d.accounts.length >= 500 && <Alert className="mb-3">Showing the first 500 accounts. The trial balance covers all of them.</Alert>}
            {rows.length === 0 ? <EmptyState title="No accounts match this filter" /> : (
              <Table head={['Account', 'Type', <span key="d" className="block text-right">Debit balance</span>, <span key="c" className="block text-right">Credit balance</span>]}>
                {rows.map((a) => <tr key={a.code}><Td><AccountCode code={a.code} /></Td><Td>{humanise(a.type)}</Td><DebitCell paise={a.balancePaise} /><CreditCell paise={a.balancePaise} /></tr>)}
              </Table>
            )}
          </>
        );
      }}
    </Q>
  );
}

function AccountCode({ code }: { code: string }) {
  const [name, ref] = code.split(':');
  if (name === 'buyer_escrow' && ref) return <span>{humanise(name)}: <Link href={`/orders/${ref}`} className="text-emerald-800 underline"><Mono>{ref}</Mono></Link></span>;
  return ref ? <span>{humanise(name!)}: <Mono>{ref}</Mono></span> : <span>{humanise(name!)}</span>;
}

function Journals({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [input, setInput] = useState(orderId);
  const [lookupError, setLookupError] = useState<string | null>(null);
  useEffect(() => setInput(orderId), [orderId]);
  const q = useLoad(() => api.get<Journal[]>(`/admin/ledger/journals${orderId ? `?orderId=${encodeURIComponent(orderId)}` : ''}`), [orderId]);

  /** Operators know the order code, while the API filters by id, so a code is resolved first. */
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLookupError(null);
    const v = input.trim();
    if (!v) { router.replace('/ledger?tab=journals'); return; }
    if (!/^AGR-/i.test(v)) { router.replace(`/ledger?tab=journals&orderId=${encodeURIComponent(v)}`); return; }
    try {
      const rows = await api.get<AdminOrderRow[]>(`/admin/orders?q=${encodeURIComponent(v)}`);
      const hit = rows.find((o) => o.code.toLowerCase() === v.toLowerCase());
      if (hit) router.replace(`/ledger?tab=journals&orderId=${hit.id}`);
      else setLookupError(`No order has the code ${v}.`);
    } catch (err) { setLookupError(errorMessage(err)); }
  };

  return (
    <>
      <form className="mb-3 flex flex-wrap items-end gap-3" onSubmit={submit}>
        <div className="w-80"><Field label="Order code or id" error={lookupError ?? undefined}><Input type="search" placeholder="AGR-" value={input} onChange={(e) => setInput(e.target.value)} /></Field></div>
        <Button type="submit" variant="secondary">Filter</Button>
        {orderId && <Button type="button" variant="ghost" onClick={() => { setInput(''); router.replace('/ledger?tab=journals'); }}>Clear</Button>}
      </form>
      <Q q={q} isEmpty={(d) => d.length === 0} emptyTitle="No journals" emptyBody={orderId ? 'Nothing has been posted for this order.' : 'Nothing has been posted yet.'}>
        {(rows) => (
          <div className="space-y-3">
            <p className="text-xs text-slate-600">Latest 200 journals, newest first.</p>
            {rows.map((j) => <JournalCard key={j.id} j={j} />)}
          </div>
        )}
      </Q>
    </>
  );
}

function JournalCard({ j }: { j: Journal }) {
  const sum = useMemo(() => j.postings.reduce((s, p) => s + BigInt(p.amountPaise), 0n), [j.postings]);
  return (
    <article className="rounded-lg border border-slate-200 bg-white" aria-label={`Journal ${j.type}`}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2 text-sm">
        <span className="font-medium text-slate-900">{humanise(j.type)}</span>
        {j.memo && <span className="text-slate-600">{j.memo}</span>}
        {j.orderId && <Link href={`/orders/${j.orderId}`} className="text-xs text-emerald-800 underline">Open order</Link>}
        <span className="ml-auto text-xs text-slate-600"><Ist at={j.createdAt} /></span>
      </header>
      {sum !== 0n && <Alert tone="red" role="alert" className="m-2">This journal does not balance. It is off by <Money paise={sum} />.</Alert>}
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-slate-500"><tr><th scope="col" className="px-4 py-1 font-medium">Account</th><th scope="col" className="w-40 px-4 py-1 text-right font-medium">Debit</th><th scope="col" className="w-40 px-4 py-1 text-right font-medium">Credit</th></tr></thead>
        <tbody>
          {j.postings.map((p) => <tr key={p.id} className="border-t border-slate-50"><Td className="py-1"><AccountCode code={p.account.code} /></Td><DebitCell paise={p.amountPaise} /><CreditCell paise={p.amountPaise} /></tr>)}
        </tbody>
      </table>
      <p className="px-4 py-1 text-xs text-slate-500">Key: <Mono>{j.idempotencyKey}</Mono></p>
    </article>
  );
}

function Escrow() {
  const q = useLoad(() => api.get<EscrowView>('/admin/escrow'), []);
  return (
    <Q q={q}>
      {(d) => (
        <>
          <div className="mb-4 grid max-w-xl grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-600">Total owed to escrow</p><p className="text-xl font-semibold"><Money paise={d.totalPaise} /></p></div>
            <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-600">Nodal account balance</p><p className="text-xl font-semibold"><Money paise={d.nodalPaise} /></p></div>
          </div>
          <Section title="Orders with money in escrow">
            {d.orders.length === 0 ? <EmptyState title="No money is in escrow" /> : (
              <Table head={['Order', 'State', <span key="e" className="block text-right">In escrow</span>, 'Journals']}>
                {d.orders.map((o) => (
                  <tr key={o.orderId}>
                    <Td><OrderLink id={o.orderId} code={o.order?.code} /></Td>
                    <Td>{o.order ? <StateBadge state={o.order.state} /> : '—'}</Td>
                    <Td className="text-right"><Money paise={o.escrowPaise} /></Td>
                    <Td><Link href={`/ledger?tab=journals&orderId=${o.orderId}`} className="text-emerald-800 underline">View</Link></Td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>
        </>
      )}
    </Q>
  );
}
