'use client';
import type { BuyerOrder } from '@agrimate/api-client';
import { formatIST } from '@agrimate/shared';
import { Alert, Badge, Button, Card, CardTitle, StateBadge, Table, Td } from '@agrimate/ui';
import { useState } from 'react';
import { Fact, FileButton, FileThumb, FormError, Modal, specRange } from '@/components/common';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { formatKg } from '@/lib/units';

function AcceptDeviation({ order, onChanged }: { order: BuyerOrder; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  const balancePaid = order.state === 'INSPECTION_SCHEDULED';
  const submit = () => void run(async () => {
    await api.post(`/orders/${order.id}/deviation/accept`);
    setOpen(false);
    await onChanged();
  });
  return (
    <>
      <Alert tone="red" className="space-y-2">
        <p><strong className="font-medium">The produce failed the grade check.</strong> You can accept it as it is, or wait for our team to review the order.</p>
        <Button variant="danger" size="sm" disabled={!balancePaid} onClick={() => setOpen(true)}>Accept deviation</Button>
        {!balancePaid && <p className="text-xs">Pay the balance before accepting the deviation.</p>}
      </Alert>
      <Modal open={open} title="Accept out-of-spec produce?" onClose={() => setOpen(false)}>
        <div className="space-y-3 text-sm text-slate-700">
          <p>You are taking this produce knowing that the readings marked out of spec do not meet the grade. The order continues at the agreed price, and the produce can leave the farm.</p>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Go back</Button>
            <Button variant="danger" disabled={busy} onClick={submit}>{busy ? 'Accepting' : 'Accept deviation'}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Reads a capture time out of the self-cert metadata, whose shape the API does not type. */
function capturedAt(capture: unknown): string | null {
  const v = (capture as { capturedAt?: unknown } | null)?.capturedAt;
  return typeof v === 'string' ? v : null;
}

export function InspectionCard({ order, onChanged }: { order: BuyerOrder; onChanged: () => Promise<void> }) {
  const i = order.inspection;
  const sc = order.selfCert;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">Quality check</h2>
        {i && <StateBadge state={i.status} />}
      </div>
      <div className="space-y-4">
        {order.selfCertifiedBadge && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="mb-1"><Badge tone="amber" className="border border-amber-400">Self-certified by the farmer</Badge></div>
            <p>No inspector checked this produce. The farmer recorded the weighing and loading on video in the Agrimate app. Review the videos before the produce departs.</p>
            {sc && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {sc.scaleVideoFileId && <FileButton fileId={sc.scaleVideoFileId} label="Watch scale video" />}
                {sc.vehicleVideoFileId && <FileButton fileId={sc.vehicleVideoFileId} label="Watch loading video" />}
              </div>
            )}
            {sc && (
              <dl className="mt-2 max-w-sm">
                {sc.certifiedWeightKg !== null && <Fact label="Certified weight">{formatKg(sc.certifiedWeightKg)}</Fact>}
                {sc.submittedAt && <Fact label="Submitted">{formatIST(sc.submittedAt)}</Fact>}
                {capturedAt(sc.scaleCapture) && <Fact label="Scale video recorded">{formatIST(capturedAt(sc.scaleCapture)!)}</Fact>}
                {capturedAt(sc.vehicleCapture) && <Fact label="Loading video recorded">{formatIST(capturedAt(sc.vehicleCapture)!)}</Fact>}
              </dl>
            )}
          </div>
        )}
        {order.selfCertRequired && !order.selfCertifiedBadge && (
          <Alert tone="amber">No inspector was available, so the farmer must self-certify on video. This order will then carry a self-certified badge.</Alert>
        )}

        {i && i.status !== 'WAIVED_SELF_CERT' && (
          <>
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <Fact label="Scheduled for">{formatIST(i.scheduledFor)}</Fact>
              <Fact label="Inspector">{i.inspectorId ? 'Assigned' : 'Not assigned yet'}</Fact>
              <Fact label="Checked in">{i.checkInAt ? formatIST(i.checkInAt) : '—'}</Fact>
              <Fact label="Inspected">{i.inspectedAt ? formatIST(i.inspectedAt) : '—'}</Fact>
              <Fact label="Scale weight">{i.scaleWeightKg !== null ? formatKg(i.scaleWeightKg) : '—'}</Fact>
              {i.deviationAcceptedAt && <Fact label="Deviation accepted">{formatIST(i.deviationAcceptedAt)}</Fact>}
            </dl>

            {i.readings ? (
              <div>
                <h3 className="mb-2 text-sm font-medium text-slate-800">Readings against {order.grade.name} specification</h3>
                <Table head={['Parameter', 'Specification', 'Reading', 'Result']}>
                  {order.grade.parameters.map((p) => {
                    const v = i.readings?.[p.key];
                    const out = i.gradeCheck?.outOfSpec.includes(p.key) ?? false;
                    return (
                      <tr key={p.key} className={out ? 'bg-red-50' : undefined}>
                        <Td>{p.label}</Td>
                        <Td className="tabular-nums">{specRange(p)}</Td>
                        <Td className="tabular-nums font-medium">{v !== undefined ? `${v}${p.unit ? ` ${p.unit}` : ''}` : '—'}</Td>
                        <Td>{v === undefined ? <Badge>Not recorded</Badge> : out ? <Badge tone="red">Out of spec</Badge> : <Badge tone="green">In spec</Badge>}</Td>
                      </tr>
                    );
                  })}
                </Table>
              </div>
            ) : (
              <p className="text-sm text-slate-600">The inspector has not recorded readings yet.</p>
            )}

            {i.photoFileIds.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium text-slate-800">Inspection photos</h3>
                <div className="flex flex-wrap gap-2">
                  {i.photoFileIds.map((id, n) => <FileThumb key={id} fileId={id} label={`Inspection photo ${n + 1}`} />)}
                </div>
              </div>
            )}

            {i.status === 'FAILED_GRADE' && <AcceptDeviation order={order} onChanged={onChanged} />}
          </>
        )}
      </div>
    </Card>
  );
}
