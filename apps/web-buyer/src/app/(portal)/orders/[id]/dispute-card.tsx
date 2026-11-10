'use client';
/**
 * Disputes are guarded by /dispute-eligibility: if that check has not loaded, no dispute can be opened from here.
 * A weight dispute inside the 2.5% contractual tolerance is blocked with the reason on screen; the API re-checks on submit.
 */
import type { BuyerOrder, DisputeEligibility, DisputeView } from '@agrimate/api-client';
import { formatIST } from '@agrimate/shared';
import { Alert, Button, Card, CardTitle, Countdown, Field, humanise, Money, Skeleton, StateBadge, Table, Td, Textarea } from '@agrimate/ui';
import { useState } from 'react';
import { ErrorState, FileButton, FormError, Modal } from '@/components/common';
import { FileUpload, type UploadedFile } from '@/components/file-upload';
import { api } from '@/lib/api';
import { useAction, useResource } from '@/lib/hooks';
import { formatKg } from '@/lib/units';

/** Why a weight dispute is blocked, or null when it is allowed. Exported for testing against API responses. */
export function weightBlockReason(e: DisputeEligibility): string | null {
  if (e.weightDisputeAllowed) return null;
  if (!e.windowOpen) return 'The dispute window is not open.';
  if (e.discrepancyPercent === null || e.dispatchedWeightKg === null || e.receivedWeightKg === null) return 'Weights have not been recorded for this order, so a weight dispute cannot be raised.';
  const weights = `Dispatched ${formatKg(e.dispatchedWeightKg)}, received ${formatKg(e.receivedWeightKg)}.`;
  if (e.discrepancyPercent <= 0) return `${weights} There is no shortfall, so a weight dispute cannot be raised.`;
  return `${weights} The ${e.discrepancyPercent}% difference is within the ${e.tolerancePercent}% contractual tolerance for natural moisture loss, so a weight dispute cannot be raised.`;
}

function RaiseDispute({ order, type, open, onClose, onChanged }: { order: BuyerOrder; type: 'WEIGHT' | 'QUALITY'; open: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const { busy, error, run } = useAction();
  const needsEvidence = type === 'WEIGHT';
  const ready = reason.trim().length >= 5 && (!needsEvidence || files.length > 0);
  const submit = () => void run(async () => {
    await api.post(`/orders/${order.id}/disputes`, { type, reason: reason.trim(), evidenceFileIds: files.map((f) => f.id) });
    onClose();
    await onChanged();
  });
  return (
    <Modal open={open} title={type === 'WEIGHT' ? 'Raise a weight dispute' : 'Raise a quality dispute'} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-700">Settlement stops while our team reviews the dispute.</p>
        <Field label="What went wrong?" hint="At least 5 characters."><Textarea value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} /></Field>
        <FileUpload label={needsEvidence ? 'Evidence (required)' : 'Evidence (optional)'} hint="Photos, weighbridge slips or reports." purpose="DISPUTE_EVIDENCE" orderId={order.id} accept="image/*,application/pdf" files={files} onChange={setFiles} disabled={busy} />
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={busy || !ready} onClick={submit}>{busy ? 'Submitting' : 'Raise dispute'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function DisputeRows({ disputes }: { disputes: DisputeView[] }) {
  return (
    <Table head={['Raised', 'Type', 'Reason', 'Difference', 'Evidence', 'Status', 'Outcome']}>
      {disputes.map((d) => (
        <tr key={d.id}>
          <Td className="text-xs whitespace-nowrap">{formatIST(d.createdAt)}</Td>
          <Td>{humanise(d.type)}</Td>
          <Td className="max-w-64 break-words">{d.reason}</Td>
          <Td className="tabular-nums">{d.discrepancyPercent !== null ? `${d.discrepancyPercent}%` : '—'}</Td>
          <Td><span className="flex flex-col items-start gap-1">{d.evidenceFileIds.length === 0 ? '—' : d.evidenceFileIds.map((id, i) => <FileButton key={id} fileId={id} label={`File ${i + 1}`} />)}</span></Td>
          <Td><StateBadge state={d.status === 'OPEN' ? 'DISPUTED' : 'RESOLVED'} /></Td>
          <Td className="text-sm">
            {d.outcome ? humanise(d.outcome) : '—'}
            {d.refundPaise && d.refundPaise !== '0' && <span className="block text-xs">Refund <Money paise={d.refundPaise} /></span>}
            {d.resolutionNote && <span className="block text-xs text-slate-600">{d.resolutionNote}</span>}
          </Td>
        </tr>
      ))}
    </Table>
  );
}

export function DisputeCard({ order, onChanged }: { order: BuyerOrder; onChanged: () => Promise<void> }) {
  const e = useResource(() => api.get<DisputeEligibility>(`/orders/${order.id}/dispute-eligibility`), [order.id, order.state, order.disputeDeadlineAt]);
  const [raising, setRaising] = useState<'WEIGHT' | 'QUALITY' | null>(null);
  const el = e.data;
  const block = el ? weightBlockReason(el) : null;

  return (
    <Card>
      <CardTitle>Dispute window</CardTitle>
      <div className="space-y-3">
        {order.disputeDeadlineAt && (
          <p className="text-sm text-slate-700">
            {el?.windowOpen ? 'You can raise a dispute until ' : 'The window closed on '}
            <strong className="font-medium">{formatIST(order.disputeDeadlineAt)}</strong>
            {el?.windowOpen && <>, which is in <Countdown to={order.disputeDeadlineAt} /></>}.
            {el?.windowOpen && ' If nothing is raised, the order settles automatically after this.'}
          </p>
        )}
        {!order.disputeDeadlineAt && <p className="text-sm text-slate-600">The window opens when delivery is recorded.</p>}

        {e.loading && !el && <Skeleton className="h-10 w-full" />}
        {e.error && <ErrorState message={`Could not check whether a dispute is allowed. ${e.error}`} onRetry={() => void e.reload()} />}

        {el && el.windowOpen && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-slate-200 p-3">
              <h3 className="mb-1 text-sm font-medium text-slate-800">Weight</h3>
              {block
                ? <Alert id="weight-block" tone="amber" className="mb-2">{block}</Alert>
                : <p className="mb-2 text-sm text-slate-700">Dispatched {formatKg(el.dispatchedWeightKg!)}, received {formatKg(el.receivedWeightKg!)}. The {el.discrepancyPercent}% difference is above the {el.tolerancePercent}% contractual tolerance.</p>}
              <Button variant="secondary" size="sm" disabled={!el.weightDisputeAllowed} aria-describedby={block ? 'weight-block' : undefined} onClick={() => setRaising('WEIGHT')}>Raise weight dispute</Button>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <h3 className="mb-1 text-sm font-medium text-slate-800">Quality</h3>
              <p className="mb-2 text-sm text-slate-700">Raise this if the produce does not match the grade you agreed.</p>
              <Button variant="secondary" size="sm" disabled={!el.qualityDisputeAllowed} onClick={() => setRaising('QUALITY')}>Raise quality dispute</Button>
            </div>
          </div>
        )}

        {order.disputes.length > 0 ? <DisputeRows disputes={order.disputes} /> : el && !el.windowOpen && <p className="text-sm text-slate-600">No disputes were raised on this order.</p>}
      </div>
      {raising && <RaiseDispute key={raising} order={order} type={raising} open onClose={() => setRaising(null)} onChanged={async () => { await onChanged(); await e.reload(); }} />}
    </Card>
  );
}
