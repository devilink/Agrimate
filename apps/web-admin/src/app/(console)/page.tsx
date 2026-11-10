'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Alert, Money, Skeleton, StateBadge, Table, Td, cn } from '@agrimate/ui';
import { api, errorMessage } from '@/lib/api';
import { useLoad, type Loaded } from '@/lib/use-load';
import { ErrorState, Ist, OrderLink, PageHeader, Q, Section } from '@/components/console';
import type { AdminDispute, AdminPayout, EscrowView, LedgerAccounts, Queues, ReconReport, SlaBoard } from '@/lib/types';

const QUEUE_LABELS: [keyof Queues, string][] = [['kyb', 'Buyer KYB'], ['kyc', 'Farmer KYC'], ['inspector', 'Inspector degrees'], ['logistics', 'Logistics documents'], ['organic', 'Organic certificates']];

/** One figure. Each loads and fails on its own, so one broken endpoint never blanks the page. */
function Tile<T>({ label, href, q, value, tone }: { label: string; href: string; q: Loaded<T>; value: (d: T) => ReactNode; tone?: (d: T) => 'red' | 'amber' | undefined }) {
  const t = q.loaded ? tone?.(q.data as T) : undefined;
  return (
    <Link href={href} className={cn('block rounded-lg border bg-white p-3 hover:border-slate-400', t === 'red' ? 'border-red-400' : t === 'amber' ? 'border-amber-400' : 'border-slate-200')}>
      <p className="text-xs text-slate-600">{label}</p>
      <div className={cn('mt-1 text-xl font-semibold tabular-nums', t === 'red' ? 'text-red-700' : 'text-slate-900')}>
        {q.loaded ? value(q.data as T) : q.error ? <span role="alert" className="text-sm font-normal text-red-700">{errorMessage(q.error)}</span> : <Skeleton className="h-7 w-20" />}
      </div>
    </Link>
  );
}

export default function OverviewPage() {
  const queues = useLoad(() => api.get<Queues>('/admin/queues'), []);
  const board = useLoad(() => api.get<SlaBoard>('/admin/sla-board'), []);
  const escrow = useLoad(() => api.get<EscrowView>('/admin/escrow'), []);
  const ledger = useLoad(() => api.get<LedgerAccounts>('/admin/ledger/accounts'), []);
  const blocked = useLoad(() => api.get<AdminPayout[]>('/admin/payouts?status=BLOCKED'), []);
  const failed = useLoad(() => api.get<AdminPayout[]>('/admin/payouts?status=FAILED'), []);
  const disputes = useLoad(() => api.get<AdminDispute[]>('/admin/disputes?status=OPEN'), []);
  const recon = useLoad(() => api.get<ReconReport[]>('/admin/reconciliation'), []);

  const queueTotal = (q: Queues) => QUEUE_LABELS.reduce((n, [k]) => n + q[k].length, 0);
  const trial = ledger.data?.trialBalancePaise;
  const unbalanced = trial !== undefined && BigInt(trial) !== 0n;
  const lastRecon = recon.data?.[0];

  return (
    <>
      <PageHeader title="Overview" description="What needs attention now." />

      {unbalanced && (
        <div role="alert" className="mb-4 rounded-lg border-2 border-red-700 bg-red-700 p-4 text-white">
          <p className="text-base font-semibold">The ledger is out of balance by <Money paise={trial} />.</p>
          <p className="mt-1 text-sm">Debits and credits must sum to zero. Treat every balance as unreliable and hold manual money actions until this is explained. Compare journals in the ledger explorer and tell engineering.</p>
        </div>
      )}
      {ledger.error != null && !ledger.loaded && (
        <div className="mb-4"><ErrorState title="The ledger trial balance could not be read, so it has not been confirmed as zero" error={ledger.error} onRetry={() => void ledger.reload()} /></div>
      )}
      {lastRecon && !lastRecon.matched && <Alert tone="red" role="alert" className="mb-4">Reconciliation for {lastRecon.forDate} did not match. <Link href="/reconciliation" className="font-medium underline">Open reconciliation</Link></Alert>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Items in verification queues" href="/queues" q={queues} value={queueTotal} tone={(d) => (queueTotal(d) > 0 ? 'amber' : undefined)} />
        <Tile label="Open alerts" href="/sla" q={board} value={(d) => d.alerts.length} tone={(d) => (d.alerts.length > 0 ? 'amber' : undefined)} />
        <Tile label="Overdue orders" href="/sla" q={board} value={(d) => d.overdue.length} tone={(d) => (d.overdue.length > 0 ? 'red' : undefined)} />
        <Tile label="Open disputes" href="/disputes" q={disputes} value={(d) => d.length} tone={(d) => (d.length > 0 ? 'amber' : undefined)} />
        <Tile label="Held in escrow" href="/ledger?tab=escrow" q={escrow} value={(d) => <Money paise={d.totalPaise} />} />
        <Tile label="Ledger trial balance (should be zero)" href="/ledger" q={ledger} value={(d) => <Money paise={d.trialBalancePaise} />} tone={(d) => (BigInt(d.trialBalancePaise) !== 0n ? 'red' : undefined)} />
        <Tile label="Blocked payouts" href="/payouts?status=BLOCKED" q={blocked} value={(d) => d.length} tone={(d) => (d.length > 0 ? 'amber' : undefined)} />
        <Tile label="Failed payouts" href="/payouts?status=FAILED" q={failed} value={(d) => d.length} tone={(d) => (d.length > 0 ? 'red' : undefined)} />
      </div>

      <div className="grid gap-x-6 lg:grid-cols-2">
        <Section title="Verification queues">
          <Q q={queues} rows={5}>
            {(d) => (
              <Table head={['Queue', 'Waiting']}>
                {QUEUE_LABELS.map(([k, label]) => (
                  <tr key={k}>
                    <Td><Link href={`/queues?tab=${k}`} className="text-emerald-800 underline underline-offset-2">{label}</Link></Td>
                    <Td className="tabular-nums">{d[k].length}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Q>
        </Section>

        <Section title="Overdue orders" description="Past the SLA deadline and not yet out of the gate.">
          <Q q={board} rows={3} isEmpty={(d) => d.overdue.length === 0} emptyTitle="No overdue orders">
            {(d) => (
              <Table head={['Order', 'State', 'Deadline']}>
                {d.overdue.slice(0, 8).map((o) => (
                  <tr key={o.id}><Td><OrderLink id={o.id} code={o.code} /></Td><Td><StateBadge state={o.state} /></Td><Td><Ist at={o.slaDeadlineAt} /></Td></tr>
                ))}
              </Table>
            )}
          </Q>
        </Section>
      </div>
    </>
  );
}
