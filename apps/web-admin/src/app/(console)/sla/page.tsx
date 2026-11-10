'use client';
import { useState } from 'react';
import { Badge, Button, Countdown, EmptyState, StateBadge, Table, Td, humanise } from '@agrimate/ui';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { ConfirmDialog, Ist, JsonDetails, OrderLink, PageHeader, Q, Section } from '@/components/console';
import type { AdminAlert, SlaBoard } from '@/lib/types';

export default function SlaPage() {
  const board = useLoad(() => api.get<SlaBoard>('/admin/sla-board'), []);
  const [target, setTarget] = useState<AdminAlert | null>(null);
  return (
    <>
      <PageHeader title="SLA breach board" description="Open alerts, plus orders past their deadline that have not left the gate." actions={<Button size="sm" variant="secondary" disabled={board.loading} onClick={() => void board.reload()}>Refresh</Button>} />
      <Q q={board} rows={6}>
        {(d) => (
          <>
            <Section title={`Overdue orders (${d.overdue.length})`}>
              {d.overdue.length === 0 ? <EmptyState title="No overdue orders" /> : (
                <Table head={['Order', 'State', 'Deadline', 'SLA']}>
                  {d.overdue.map((o) => <tr key={o.id}><Td><OrderLink id={o.id} code={o.code} /></Td><Td><StateBadge state={o.state} /></Td><Td><Ist at={o.slaDeadlineAt} /></Td><Td><Countdown to={o.slaDeadlineAt} /></Td></tr>)}
                </Table>
              )}
            </Section>
            <Section title={`Open alerts (${d.alerts.length})`}>
              {d.alerts.length === 0 ? <EmptyState title="No open alerts" /> : (
                <Table head={['Kind', 'Message', 'Order', 'Raised', 'Data', '']}>
                  {d.alerts.map((a) => (
                    <tr key={a.id}>
                      <Td><Badge tone={['SLA_BREACH', 'RECONCILIATION_MISMATCH', 'PAYOUT_FAILED', 'BUYER_DEFAULT'].includes(a.kind) ? 'red' : 'amber'}>{humanise(a.kind)}</Badge></Td>
                      <Td className="max-w-md">{a.message}</Td>
                      <Td>{a.orderId ? <OrderLink id={a.orderId} code="Open order" /> : '—'}</Td>
                      <Td><Ist at={a.createdAt} /></Td>
                      <Td><JsonDetails label="View" value={a.data} /></Td>
                      <Td><Button size="sm" variant="secondary" onClick={() => setTarget(a)}>Resolve</Button></Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>
          </>
        )}
      </Q>
      {target && (
        <ConfirmDialog
          title="Resolve this alert" confirmLabel="Resolve alert" onClose={() => setTarget(null)}
          onConfirm={async () => { await api.post(`/admin/alerts/${target.id}/resolve`); await board.reload(); }}
        >
          <p>{target.message}</p>
          <p>The alert leaves this board and the resolution is audited. No order or money changes. Resolving only records that it has been handled.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
