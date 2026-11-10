'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { BuyerOrder } from '@agrimate/api-client';
import { Alert, Button, EmptyState, Field, Input, Money, Select, StateBadge, Textarea, humanise } from '@agrimate/ui';
import { discrepancyPercent, formatINR } from '@agrimate/shared';
import { api } from '@/lib/api';
import { rupeesToPaise } from '@/lib/money';
import { useLoad } from '@/lib/use-load';
import { ConfirmDialog, Dl, DocLink, ErrorState, InlineSuccess, Ist, LoadingRows, OrderLink, PageHeader, Q, Section } from '@/components/console';
import type { AdminDispute } from '@/lib/types';

type Outcome = 'RELEASE_TO_FARMER' | 'PARTIAL_REFUND' | 'FULL_REFUND_FARMER_FAULT';
const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: 'RELEASE_TO_FARMER', label: 'Release to farmer, no refund' },
  { value: 'PARTIAL_REFUND', label: 'Partial refund to buyer' },
  { value: 'FULL_REFUND_FARMER_FAULT', label: 'Full refund, farmer at fault' },
];

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  // The API has no single-dispute route, so the record comes from the list. It is capped at the latest 200.
  const dispute = useLoad(async () => (await api.get<AdminDispute[]>('/admin/disputes')).find((d) => d.id === id) ?? null, [id]);
  const orderId = dispute.data?.orderId;
  const order = useLoad(async () => (orderId ? api.get<BuyerOrder>(`/admin/orders/${orderId}`) : null), [orderId]);

  return (
    <Q q={dispute} rows={8}>
      {(d) => {
        if (!d) return <EmptyState title="Dispute not found">It may be older than the latest 200 disputes. <Link href="/disputes" className="underline">Back to disputes</Link></EmptyState>;
        const { dispatchedWeightKg: sent, receivedWeightKg: got } = d.order;
        const disc = d.discrepancyPercent ?? (sent && got != null ? discrepancyPercent(sent, got) : null);
        return (
          <>
            <p className="mb-1 text-xs text-slate-500"><Link href="/disputes" className="underline">Disputes</Link> / {d.order.code}</p>
            <PageHeader title={`${humanise(d.type)} dispute on ${d.order.code}`} actions={<><StateBadge state={d.status} /><span className="text-xs text-slate-600">Order is <StateBadge state={d.order.state} /></span></>} />

            <Section title="What was raised">
              <Dl items={[
                ['Order', <OrderLink key="o" id={d.orderId} code={d.order.code} />],
                ['Raised', <Ist key="r" at={d.createdAt} />],
                ['Order GMV', <Money key="g" paise={d.order.gmvPaise} />],
                ['Dispatched weight', sent != null ? `${sent} kg` : '—'],
                ['Received weight', got != null ? `${got} kg` : '—'],
                ['Discrepancy', disc != null ? `${disc}% (contract tolerance is 2.5%)` : '—'],
              ]} />
              <div className="mt-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
                <p className="text-xs text-slate-500">Reason given</p>
                <p className="whitespace-pre-wrap text-slate-900">{d.reason}</p>
              </div>
            </Section>

            <Section title="Evidence">
              {d.evidenceFileIds.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-600">No evidence files were attached.</p> : (
                <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  {d.evidenceFileIds.map((f, i) => <DocLink key={f} fileId={f} label={`Evidence ${i + 1}`} />)}
                </div>
              )}
            </Section>

            {d.status === 'RESOLVED' ? (
              <Section title="Resolution">
                <Dl items={[['Outcome', d.outcome ? humanise(d.outcome) : '—'], ['Refund', <Money key="r" paise={d.refundPaise} />], ['Resolved', <Ist key="ra" at={d.resolvedAt} />], ['Note', d.resolutionNote ?? '—']]} />
              </Section>
            ) : order.error && !order.loaded ? (
              <ErrorState title="The order could not be loaded, so this dispute cannot be resolved yet" error={order.error} onRetry={() => void order.reload()} />
            ) : !order.data ? <LoadingRows rows={4} /> : (
              <ResolveForm d={d} o={order.data} onDone={async () => { await Promise.all([dispute.reload(), order.reload()]); }} />
            )}
          </>
        );
      }}
    </Q>
  );
}

function ResolveForm({ d, o, onDone }: { d: AdminDispute; o: BuyerOrder; onDone: () => Promise<void> }) {
  const [outcome, setOutcome] = useState<Outcome>('RELEASE_TO_FARMER');
  const [refund, setRefund] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const cap = BigInt(o.gmvPaise) - BigInt(o.buyerRefundPaise);
  const partial = outcome === 'PARTIAL_REFUND';
  const parsed = rupeesToPaise(refund);
  const refundError = !partial || !refund.trim() ? undefined : !parsed.ok ? parsed.error : BigInt(parsed.paise) <= 0n ? 'The refund must be above zero' : BigInt(parsed.paise) > cap ? `The refund cannot be more than ${formatINR(cap)}` : undefined;
  const valid = note.trim().length >= 3 && (!partial || (!!refund.trim() && !refundError));
  const otherOpen = o.disputes.filter((x) => x.status === 'OPEN' && x.id !== d.id).length;

  return (
    <Section title="Resolve">
      {done && <InlineSuccess>{done}</InlineSuccess>}
      {o.state !== 'DISPUTED' && <Alert className="mb-3">This order is {humanise(o.state).toLowerCase()}, not disputed, so the API may refuse this resolution.</Alert>}
      <form className="grid max-w-2xl gap-3 rounded-lg border border-slate-200 bg-white p-4" onSubmit={(e: FormEvent) => { e.preventDefault(); if (valid) { setDone(null); setConfirm(true); } }}>
        <Field label="Outcome">
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
            {OUTCOMES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </Select>
        </Field>
        {partial && <Field label="Refund in rupees" error={refundError} hint={`Up to ${formatINR(cap)} (GMV less earlier refunds).`}><Input inputMode="decimal" required value={refund} onChange={(e) => setRefund(e.target.value)} /></Field>}
        <Field label="Note" hint="Required, at least 3 characters. Stored with the resolution and the audit log."><Textarea required value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div><Button type="submit" size="sm" disabled={!valid}>Review and resolve</Button></div>
      </form>

      {confirm && (
        <ConfirmDialog
          title={`Resolve dispute on ${d.order.code}`} confirmLabel="Resolve dispute" danger={outcome !== 'RELEASE_TO_FARMER'}
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            const r = await api.post<{ orderState: string; remainingDisputes: number }>(`/admin/disputes/${d.id}/resolve`, { outcome, note: note.trim(), ...(partial && parsed.ok ? { refundPaise: parsed.paise } : {}) });
            setDone(r.remainingDisputes > 0 ? `Dispute resolved. ${r.remainingDisputes} other dispute(s) are still open on this order, so no money has moved yet.` : `Dispute resolved. The order is now ${humanise(r.orderState).toLowerCase()}.`);
            await onDone();
          }}
        >
          <p><strong>This cannot be undone.</strong></p>
          {outcome === 'RELEASE_TO_FARMER' && <p>No refund. {otherOpen ? 'Once every dispute on the order is closed, the' : 'The'} order settles: the farmer is paid GMV less commission and fees.</p>}
          {outcome === 'PARTIAL_REFUND' && parsed.ok && <p><strong>{formatINR(parsed.paise)} is refunded to {o.buyer.name}.</strong> {otherOpen ? 'Once every dispute on the order is closed, the' : 'The'} order settles on the rest: commission is charged on GMV net of the refund, and the farmer is paid the remainder.</p>}
          {outcome === 'FULL_REFUND_FARMER_FAULT' && <p><strong>{o.buyer.name} is refunded what remains in escrow ({formatINR(o.escrowPaise)}), and the farmer receives nothing.</strong> Freight already released on delivery is not returned. The gateway fee is posted to {o.farmer.name} as a negative balance, recovered from future payouts. {otherOpen ? 'This happens once every dispute on the order is closed.' : ''}</p>}
          {otherOpen > 0 && <p>{otherOpen} other dispute(s) on this order are still open, so money moves only after the last one is resolved.</p>}
          <p className="rounded bg-slate-50 p-2 text-xs text-slate-700">Note: {note.trim()}</p>
        </ConfirmDialog>
      )}
    </Section>
  );
}
