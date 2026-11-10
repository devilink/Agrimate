'use client';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Field, Input, Money, Table, Td } from '@agrimate/ui';
import { api, errorMessage, handleAuthError } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { Ist, PageHeader, Q } from '@/components/console';
import type { ReconReport } from '@/lib/types';

const diff = (a: string, b: string) => (BigInt(a) - BigInt(b)).toString();

export default function ReconciliationPage() {
  const reports = useLoad(() => api.get<ReconReport[]>('/admin/reconciliation'), []);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const r = await api.post<ReconReport>(`/admin/reconciliation/run${date ? `?date=${date}` : ''}`);
      setMessage(r.matched ? { tone: 'green', text: `Reconciliation for ${r.forDate} matched.` } : { tone: 'red', text: `Reconciliation for ${r.forDate} did not match. An alert has been raised on the SLA board.` });
      await reports.reload();
    } catch (err) {
      handleAuthError(err);
      setMessage({ tone: 'red', text: errorMessage(err) });
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Reconciliation" description="Compares ledger cash with the gateway for one IST day. Running a date again replaces its report." />
      <form onSubmit={run} className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-48"><Field label="Date (IST)" hint="Blank means yesterday."><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
        <Button type="submit" disabled={busy} className="mb-5">{busy ? 'Running…' : 'Run reconciliation'}</Button>
      </form>
      {message && <Alert tone={message.tone} role={message.tone === 'red' ? 'alert' : 'status'} className="mb-3">{message.text}</Alert>}
      <Q q={reports} isEmpty={(d) => d.length === 0} emptyTitle="No reports yet" emptyBody="Run reconciliation to create the first one.">
        {(rows) => (
          <Table head={['Date', 'Result', 'Ledger in', 'Gateway in', 'In difference', 'Ledger out', 'Gateway out', 'Out difference', 'Gateway transactions', 'Trial balance', 'Run at']}>
            {rows.map((r) => {
              const inDiff = diff(r.ledgerInPaise, r.gatewayInPaise); const outDiff = diff(r.ledgerOutPaise, r.gatewayOutPaise);
              return (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap font-medium tabular-nums">{r.forDate}</Td>
                  <Td><Badge tone={r.matched ? 'green' : 'red'}>{r.matched ? 'Matched' : 'Mismatch'}</Badge></Td>
                  <Td><Money paise={r.ledgerInPaise} /></Td><Td><Money paise={r.gatewayInPaise} /></Td>
                  <Td><Money paise={inDiff} className={inDiff !== '0' ? 'font-semibold text-red-700' : ''} /></Td>
                  <Td><Money paise={r.ledgerOutPaise} /></Td><Td><Money paise={r.gatewayOutPaise} /></Td>
                  <Td><Money paise={outDiff} className={outDiff !== '0' ? 'font-semibold text-red-700' : ''} /></Td>
                  <Td className="tabular-nums">{r.details?.gatewayTxnCount ?? '—'}</Td>
                  <Td>{r.details?.trialBalancePaise ? <Money paise={r.details.trialBalancePaise} className={r.details.trialBalancePaise !== '0' ? 'font-semibold text-red-700' : ''} /> : '—'}</Td>
                  <Td><Ist at={r.createdAt} /></Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Q>
    </>
  );
}
