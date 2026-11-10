'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Field, Money, Select, StateBadge, Table, Td, humanise } from '@agrimate/ui';
import { PayoutStatus, formatINR } from '@agrimate/shared';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { ConfirmDialog, Ist, Mono, OrderLink, PageHeader, Q } from '@/components/console';
import type { AdminPayout } from '@/lib/types';

const RETRYABLE = ['BLOCKED', 'FAILED'];

export default function PayoutsPage() {
  const router = useRouter();
  const status = useSearchParams().get('status') ?? '';
  const payouts = useLoad(() => api.get<AdminPayout[]>(`/admin/payouts${status ? `?status=${status}` : ''}`), [status]);
  const [target, setTarget] = useState<AdminPayout | null>(null);
  const [result, setResult] = useState<{ tone: 'green' | 'amber' | 'red'; text: string } | null>(null);

  return (
    <>
      <PageHeader title="Payouts" description="Latest 200, newest first. Blocked payouts are waiting on verification of the payee. Failed payouts were refused by the gateway." />
      <div className="mb-3 w-48">
        <Field label="Status">
          <Select value={status} onChange={(e) => router.replace(e.target.value ? `/payouts?status=${e.target.value}` : '/payouts')}>
            <option value="">All statuses</option>
            {Object.values(PayoutStatus).map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
          </Select>
        </Field>
      </div>
      {result && <Alert tone={result.tone} role={result.tone === 'green' ? 'status' : 'alert'} className="mb-3">{result.text}</Alert>}

      <Q q={payouts} isEmpty={(d) => d.length === 0} emptyTitle={status ? `No ${humanise(status).toLowerCase()} payouts` : 'No payouts yet'}>
        {(rows) => (
          <Table head={['Order', 'Payee', 'Amount', 'Status', 'Reason', 'Created', 'Updated', '']}>
            {rows.map((p) => (
              <tr key={p.id}>
                <Td><OrderLink id={p.orderId} code={p.order.code} /></Td>
                <Td>{humanise(p.payeeType)}<Mono className="block text-slate-500">{p.payeeId}</Mono></Td>
                <Td className="whitespace-nowrap"><Money paise={p.amountPaise} /></Td>
                <Td><StateBadge state={p.status} /></Td>
                <Td className="max-w-sm">{p.statusNote ?? '—'}</Td>
                <Td><Ist at={p.createdAt} /></Td>
                <Td><Ist at={p.updatedAt} /></Td>
                <Td>{RETRYABLE.includes(p.status) && <Button size="sm" variant="secondary" onClick={() => { setResult(null); setTarget(p); }}>Retry</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Q>

      {target && (
        <ConfirmDialog
          title={`Retry payout on ${target.order.code}`} confirmLabel={`Retry ${formatINR(target.amountPaise)}`} danger
          reason={{ label: 'Reason', hint: 'Required for your own check. The API does not store a reason on this action; the retry and its result are audited.' }}
          onClose={() => setTarget(null)}
          onConfirm={async () => {
            const p = await api.post<AdminPayout>(`/admin/payouts/${target.id}/retry`);
            // A retry can return 200 and still not have paid, so report what actually came back.
            setResult(p.status === 'PROCESSED' || p.status === 'PENDING'
              ? { tone: 'green', text: `${formatINR(p.amountPaise)} sent. The payout is now ${humanise(p.status).toLowerCase()}.` }
              : { tone: p.status === 'FAILED' ? 'red' : 'amber', text: `No money was sent. The payout is ${humanise(p.status).toLowerCase()}${p.statusNote ? `: ${p.statusNote}` : ''}.` });
            await payouts.reload();
          }}
        >
          <p><strong>{formatINR(target.amountPaise)} will be sent to the {humanise(target.payeeType).toLowerCase()}&apos;s bank account</strong> if their account is cleared for payouts.</p>
          <p>If the payee is still not cleared, no money moves and the payout goes back to blocked with the reason shown.</p>
          {target.statusNote && <p>Current reason: {target.statusNote}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
