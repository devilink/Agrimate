'use client';
import type { BuyerOrder, OrderEventView } from '@agrimate/api-client';
import { formatIST } from '@agrimate/shared';
import { Alert, Button, Card, CardTitle, Field, Input } from '@agrimate/ui';
import { type FormEvent, useState } from 'react';
import { Fact, FileButton, FileThumb, FormError } from '@/components/common';
import { type UploadedFile, FileUpload } from '@/components/file-upload';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { formatKg, tonnesToKg } from '@/lib/units';

function ConfirmDelivery({ order, onChanged }: { order: BuyerOrder; onChanged: () => Promise<void> }) {
  const [tonnes, setTonnes] = useState('');
  const [photo, setPhoto] = useState<UploadedFile[]>([]);
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const kg = tonnesToKg(tonnes);
  const invalid = kg === null ? 'Enter the received weight in tonnes, up to 3 decimals.' : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (kg === null) return;
    void run(async () => {
      await api.post(`/orders/${order.id}/confirm-delivery`, { receivedWeightKg: kg, ...(photo[0] ? { podPhotoFileId: photo[0].id } : {}) });
      await onChanged();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-md border border-slate-200 p-3">
      <h3 className="text-sm font-medium text-slate-800">Confirm delivery</h3>
      <p className="text-sm text-slate-600">Your confirmation is the proof of delivery for your own transport. The received weight is recorded once and cannot be changed, and it decides whether a weight dispute is possible.</p>
      <div className="grid max-w-lg items-start gap-3 sm:grid-cols-2">
        <Field label="Received weight (tonnes)" error={touched ? invalid : undefined} hint={kg !== null ? formatKg(kg) : undefined}>
          <Input inputMode="decimal" value={tonnes} disabled={busy} onChange={(e) => setTonnes(e.target.value)} />
        </Field>
        <FileUpload label="Delivery photo (optional)" purpose="POD_PHOTO" orderId={order.id} accept="image/*" files={photo} onChange={setPhoto} disabled={busy} single />
      </div>
      <FormError message={error} />
      <Button type="submit" disabled={busy}>{busy ? 'Confirming' : 'Confirm delivery'}</Button>
    </form>
  );
}

export function DeliveryCard({ order, events, onChanged }: { order: BuyerOrder; events: OrderEventView[] | null; onChanged: () => Promise<void> }) {
  const external = order.logisticsMode === 'EXTERNAL';
  const depart = useAction();
  const canDepart = external && (order.state === 'INSPECTED' || order.state === 'SELF_CERTIFIED');
  // External delivery photos are stored only in the DELIVERED event, not on the order.
  const eventPhoto = events?.find((e) => e.to === 'DELIVERED')?.payload.podPhotoFileId;
  const podPhoto = order.trip?.podPhotoFileId ?? (typeof eventPhoto === 'string' ? eventPhoto : null);

  return (
    <Card>
      <CardTitle>Delivery and proof of delivery</CardTitle>
      <div className="space-y-4">
        {canDepart && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 p-3">
            <p className="min-w-60 flex-1 text-sm text-slate-700">Quality is certified and the balance is in escrow. Mark the vehicle as departed once it leaves the farm.</p>
            <Button disabled={depart.busy} onClick={() => void depart.run(async () => { await api.post(`/orders/${order.id}/depart`); await onChanged(); })}>{depart.busy ? 'Saving' : 'Mark as departed'}</Button>
            <div className="w-full empty:hidden"><FormError message={depart.error} /></div>
          </div>
        )}
        {!external && (order.state === 'INSPECTED' || order.state === 'SELF_CERTIFIED') && <Alert tone="blue">The logistics partner confirms departure when they pick up the load.</Alert>}
        {!external && order.state === 'IN_TRANSIT' && <Alert tone="blue">The driver records proof of delivery. We send you a delivery code by SMS to give the driver when the load arrives.</Alert>}
        {external && order.state === 'IN_TRANSIT' && <ConfirmDelivery order={order} onChanged={onChanged} />}

        <dl className="grid gap-x-8 sm:grid-cols-2">
          <Fact label="Dispatched weight">{order.dispatchedWeightKg !== null ? formatKg(order.dispatchedWeightKg) : '—'}</Fact>
          <Fact label="Received weight">{order.receivedWeightKg !== null ? formatKg(order.receivedWeightKg) : '—'}</Fact>
          <Fact label="Picked up">{order.trip?.pickedUpAt ? formatIST(order.trip.pickedUpAt) : '—'}</Fact>
          <Fact label="Delivered">{order.deliveredAt ? formatIST(order.deliveredAt) : '—'}</Fact>
        </dl>

        {(podPhoto || order.trip?.ewayBillFileId) && (
          <div className="flex flex-wrap items-end gap-3">
            {podPhoto && <div><p className="mb-1 text-sm font-medium text-slate-800">Proof of delivery</p><FileThumb fileId={podPhoto} label="Proof of delivery photo" /></div>}
            {order.trip?.ewayBillFileId && <FileButton fileId={order.trip.ewayBillFileId} label="Open E-Way bill" />}
          </div>
        )}
      </div>
    </Card>
  );
}
