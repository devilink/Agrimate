'use client';
/**
 * Transport manager desk. Open requests are funded routes waiting for a truck; accepting one claims it atomically.
 * Then the same steps as the logistics app: E-Way bill, pickup, and digital proof of delivery.
 */
import { useState } from 'react';
import type { AvailableTrip, MyTrip, VehicleView } from '@agrimate/api-client';
import { Alert, Badge, Button, Card, Field, Input, Money, Select, Table, Td, cn, humanise } from '@agrimate/ui';
import { api, errorMessage, handleAuthError } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { ConfirmDialog, Ist, PageHeader, Q, Section, Tabs } from '@/components/console';
import { currentPosition, FilePick, kg, Stat, type UploadedFile } from '@/components/field-tools';
import { useMe } from '@/components/shell';

const STATUS_TONE: Record<string, string> = { OPEN: 'amber', ACCEPTED: 'blue', PICKED_UP: 'blue', DELIVERED: 'green', CANCELLED: 'slate' };
type View = 'active' | 'done';

export default function TransportDesk() {
  const me = useMe();
  const verified = me.logistics?.status === 'VERIFIED';
  const available = useLoad(() => (verified ? api.get<AvailableTrip[]>('/trips/available') : Promise.resolve([])), [verified]);
  const mine = useLoad(() => api.get<MyTrip[]>('/trips/mine'), []);
  const vehicles = useLoad(() => api.get<VehicleView[]>('/logistics/vehicles'), []);
  const [view, setView] = useState<View>('active');
  const [accepting, setAccepting] = useState<AvailableTrip | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const reload = () => { void available.reload(); void mine.reload(); };
  const trips = mine.data ?? [];
  const active = trips.filter((t) => t.status === 'ACCEPTED' || t.status === 'PICKED_UP');
  const shown = view === 'active' ? active : trips.filter((t) => t.status === 'DELIVERED' || t.status === 'CANCELLED');
  const open = trips.find((t) => t.id === openId) ?? null;
  const earned = trips.filter((t) => t.status === 'DELIVERED').reduce((s, t) => s + BigInt(t.payoutPaise), 0n);

  return (
    <>
      <PageHeader title="Transport desk" description={`Signed in as ${me.logistics?.companyName ?? me.name}. Take transport requests and move them from pickup to proof of delivery.`} actions={<Button variant="secondary" size="sm" onClick={reload}>Refresh</Button>} />

      {!verified && (
        <Alert tone="amber" className="mb-4">
          Your transport account is <strong>{humanise(me.logistics?.status ?? 'NOT_SUBMITTED').toLowerCase()}</strong>{me.logistics?.statusNote ? `: ${me.logistics.statusNote}` : ''}. Transport requests appear once an admin approves your RC, licence and fitness documents.
        </Alert>
      )}
      {flash && <Alert tone="green" role="status" className="mb-4">{flash}</Alert>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open requests" value={available.data?.length ?? 0} tone={(available.data?.length ?? 0) > 0 ? 'amber' : 'slate'} />
        <Stat label="To pick up" value={trips.filter((t) => t.status === 'ACCEPTED').length} tone="sky" />
        <Stat label="In transit" value={trips.filter((t) => t.status === 'PICKED_UP').length} tone="sky" />
        <Stat label="Delivered (earned)" value={`${trips.filter((t) => t.status === 'DELIVERED').length} · ₹${(Number(earned) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} tone="emerald" />
      </div>

      {open && <TripPanel key={open.id} trip={open} onClose={() => setOpenId(null)} onChanged={reload} />}

      <Section title="Transport requests" description="Funded routes waiting for a vehicle. The freight is already in escrow.">
        <Q q={available} rows={3} isEmpty={(d) => d.length === 0} emptyTitle="No open requests right now" emptyBody="New requests appear here as soon as a buyer pays the freight.">
          {(d) => (
            <Table head={['Order', 'Produce', 'Load', 'Route', 'Distance', 'Vehicle class', 'You earn', 'Deliver by', '']}>
              {d.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">{t.orderCode}</Td>
                  <Td>{t.commodity}</Td>
                  <Td className="tabular-nums">{kg(t.quantityKg)}</Td>
                  <Td className="tabular-nums whitespace-nowrap">{t.pickupPin} → {t.dropPin}</Td>
                  <Td className="tabular-nums">{t.distanceKm.toLocaleString('en-IN')} km</Td>
                  <Td>{humanise(t.tierCode)}</Td>
                  <Td className="font-medium"><Money paise={t.payoutPaise} /></Td>
                  <Td><Ist at={t.slaDeadlineAt} /></Td>
                  <Td className="text-right"><Button size="sm" onClick={() => setAccepting(t)}>Accept</Button></Td>
                </tr>
              ))}
            </Table>
          )}
        </Q>
      </Section>

      <Section title="My trips" actions={<Tabs label="Filter trips" value={view} onChange={setView} items={[{ key: 'active', label: 'Active', count: active.length }, { key: 'done', label: 'Completed' }]} />}>
        <Q q={mine} rows={3} isEmpty={() => shown.length === 0} emptyTitle={view === 'active' ? 'No active trips' : 'No completed trips yet'}>
          {() => (
            <Table head={['Order', 'Produce', 'Route', 'Vehicle', 'Status', 'Payout', '']}>
              {shown.map((t) => (
                <tr key={t.id} className={cn(t.id === openId && 'bg-emerald-50/60')}>
                  <Td className="font-medium">{t.orderCode}</Td>
                  <Td>{t.commodity} · <span className="tabular-nums">{kg(t.quantityKg)}</span></Td>
                  <Td className="tabular-nums whitespace-nowrap">{t.pickupPin} → {t.dropPin}</Td>
                  <Td className="font-mono text-xs">{t.vehicleRegNo ?? '—'}</Td>
                  <Td><Badge tone={STATUS_TONE[t.status] ?? 'slate'}>{humanise(t.status)}</Badge></Td>
                  <Td><Money paise={t.payoutPaise} /></Td>
                  <Td className="text-right"><Button size="sm" variant={t.status === 'DELIVERED' ? 'secondary' : 'primary'} onClick={() => setOpenId(t.id)}>{t.status === 'DELIVERED' ? 'View' : 'Continue'}</Button></Td>
                </tr>
              ))}
            </Table>
          )}
        </Q>
      </Section>

      {accepting && <AcceptDialog trip={accepting} vehicles={vehicles.data ?? []} onClose={() => setAccepting(null)} onAccepted={(id) => { setFlash(`Order ${accepting.orderCode} is yours. Upload the E-Way bill before pickup.`); setOpenId(id); reload(); }} />}
    </>
  );
}

function AcceptDialog({ trip, vehicles, onClose, onAccepted }: { trip: AvailableTrip; vehicles: VehicleView[]; onClose: () => void; onAccepted: (id: string) => void }) {
  const fits = vehicles.filter((v) => v.capacityKg >= trip.quantityKg);
  const [picked, setPicked] = useState('');
  // Vehicles may load after the dialog opens, so the default is derived rather than captured once.
  const vehicleId = picked || fits[0]?.id || '';
  const [attest, setAttest] = useState(false);
  return (
    <ConfirmDialog title={`Accept order ${trip.orderCode}?`} confirmLabel="Accept the trip" canConfirm={!!vehicleId && attest} onClose={onClose}
      onConfirm={async () => { await api.post(`/trips/${trip.id}/accept`, { vehicleId, noCoLoadingAttested: true }); onAccepted(trip.id); }}
      extra={
        <div className="space-y-3">
          <Field label="Vehicle" hint={fits.length ? `Needs at least ${kg(trip.quantityKg)} capacity.` : undefined}>
            <Select value={vehicleId} onChange={(e) => setPicked(e.target.value)} disabled={!fits.length}>
              {!fits.length && <option value="">No vehicle of yours can carry {kg(trip.quantityKg)}</option>}
              {fits.map((v) => <option key={v.id} value={v.id}>{v.regNo} · {v.tier.name} · {kg(v.capacityKg)}</option>)}
            </Select>
          </Field>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" className="mt-1" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
            I confirm this vehicle will carry no other commercial goods on this trip.
          </label>
        </div>
      }>
      <p>{kg(trip.quantityKg)} of {trip.commodity}, PIN {trip.pickupPin} to {trip.dropPin}, about {trip.distanceKm.toLocaleString('en-IN')} km. You are paid <Money paise={trip.payoutPaise} /> on proof of delivery.</p>
      <p>If another partner accepts first, you will be told and nothing is booked.</p>
    </ConfirmDialog>
  );
}

function TripPanel({ trip, onClose, onChanged }: { trip: MyTrip; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ewayNo, setEwayNo] = useState(trip.ewayBillNumber ?? '');
  const [ewayFile, setEwayFile] = useState<UploadedFile[]>([]);
  const [pod, setPod] = useState<UploadedFile[]>([]);
  const [signature, setSignature] = useState<UploadedFile[]>([]);
  const [otp, setOtp] = useState('');
  const [received, setReceived] = useState(String(trip.quantityKg));

  async function act(name: string, fn: () => Promise<string>) {
    setBusy(name); setError(null); setNotice(null);
    try { setNotice(await fn()); onChanged(); } catch (e) { handleAuthError(e); setError(errorMessage(e)); } finally { setBusy(null); }
  }

  const saveEway = () => act('eway', async () => {
    if (ewayNo.trim().length < 6) throw new Error('Enter the full E-Way bill number.');
    if (!ewayFile[0]) throw new Error('Attach the E-Way bill.');
    await api.post(`/trips/${trip.id}/eway-bill`, { ewayBillNumber: ewayNo.trim(), fileId: ewayFile[0].id });
    return 'E-Way bill saved. You can mark pickup once the stock has passed inspection and is loaded.';
  });

  const pickup = () => act('pickup', async () => {
    await api.post(`/trips/${trip.id}/pickup`);
    return 'Picked up. The buyer has been sent a delivery code to give the driver at the drop point.';
  });

  const deliver = () => act('deliver', async () => {
    const w = Number(received);
    if (!Number.isInteger(w) || w < 0) throw new Error('Enter the received weight in whole kilograms.');
    if (!pod[0]) throw new Error('Attach a photo of the unloaded stock.');
    if (!otp.trim() && !signature[0]) throw new Error('Enter the buyer\'s delivery code, or attach the receiver\'s signature.');
    const pos = await currentPosition();
    await api.post(`/trips/${trip.id}/deliver`, { podPhotoFileId: pod[0].id, ...pos, receivedWeightKg: w, ...(otp.trim() ? { receiverOtp: otp.trim() } : {}), ...(signature[0] ? { signatureFileId: signature[0].id } : {}) });
    return 'Delivered. Your payout is released on proof of delivery.';
  });

  const steps = [
    { label: 'Accepted', done: true },
    { label: 'E-Way bill', done: !!trip.ewayBillNumber },
    { label: 'Picked up', done: !!trip.pickedUpAt },
    { label: 'Delivered', done: !!trip.deliveredAt },
  ];

  return (
    <Card className="mb-6 border-emerald-200">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Order {trip.orderCode} · {trip.vehicleRegNo ?? 'no vehicle'}</p>
          <h2 className="text-lg font-semibold text-slate-900">{trip.commodity} · {kg(trip.quantityKg)}</h2>
          <p className="text-sm text-slate-600">PIN {trip.pickupPin} → {trip.dropPin} · {trip.distanceKm.toLocaleString('en-IN')} km · payout <Money paise={trip.payoutPaise} /></p>
        </div>
        <div className="flex gap-2">
          <a className="inline-flex h-8 items-center rounded-md border border-slate-300 px-3 text-sm text-slate-800 hover:bg-slate-50" href={`https://www.google.com/maps/dir/?api=1&destination=${trip.pickupLat},${trip.pickupLng}`} target="_blank" rel="noreferrer">Pickup directions</a>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>

      <ol className="mb-5 grid gap-2 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.label} className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm', s.done ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 text-slate-700')}>
            <span aria-hidden className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold', s.done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700')}>{s.done ? '✓' : i + 1}</span>
            {s.label}<span className="sr-only">{s.done ? ' (done)' : ''}</span>
          </li>
        ))}
      </ol>

      {notice && <Alert tone="green" role="status" className="mb-4">{notice}</Alert>}
      {error && <Alert tone="red" role="alert" className="mb-4">{error}</Alert>}

      {trip.status === 'ACCEPTED' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={(e) => { e.preventDefault(); void saveEway(); }} className="space-y-3 rounded-md border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">1. E-Way bill</h3>
            <Field label="E-Way bill number"><Input required minLength={6} value={ewayNo} disabled={!!busy} onChange={(e) => setEwayNo(e.target.value.toUpperCase())} /></Field>
            <FilePick label="E-Way bill document" purpose="EWAY_BILL" orderId={trip.orderId} accept="image/*,application/pdf" single files={ewayFile} onChange={setEwayFile} disabled={!!busy} />
            <Button type="submit" variant="secondary" disabled={!!busy}>{busy === 'eway' ? 'Saving…' : trip.ewayBillNumber ? 'Replace E-Way bill' : 'Save E-Way bill'}</Button>
          </form>
          <div className="space-y-3 rounded-md border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">2. Pickup</h3>
            <p className="text-sm text-slate-700">Mark pickup when the stock is loaded. This only works once the buyer has paid in full and the stock has passed inspection.</p>
            <Button onClick={() => void pickup()} disabled={!!busy || !trip.ewayBillNumber}>{busy === 'pickup' ? 'Working…' : 'Mark picked up'}</Button>
            {!trip.ewayBillNumber && <p className="text-xs text-slate-500">Save the E-Way bill first.</p>}
          </div>
        </div>
      )}

      {trip.status === 'PICKED_UP' && (
        <form onSubmit={(e) => { e.preventDefault(); void deliver(); }} className="space-y-4 rounded-md border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Proof of delivery</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Received weight (kg)" hint="As weighed at the drop point."><Input type="number" min={0} step={1} required value={received} disabled={!!busy} onChange={(e) => setReceived(e.target.value)} /></Field>
            <Field label="Buyer's delivery code" hint="Six digits, sent to the buyer at pickup."><Input inputMode="numeric" maxLength={6} value={otp} disabled={!!busy} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FilePick label="Photo of the unloaded stock" purpose="POD_PHOTO" orderId={trip.orderId} single files={pod} onChange={setPod} disabled={!!busy} />
            <FilePick label="Receiver's signature (if no code)" purpose="POD_SIGNATURE" orderId={trip.orderId} single files={signature} onChange={setSignature} disabled={!!busy} />
          </div>
          <p className="text-xs text-slate-500">Your browser shares its location once, to stamp where the delivery happened.</p>
          <Button type="submit" disabled={!!busy}>{busy === 'deliver' ? 'Recording…' : 'Record delivery'}</Button>
        </form>
      )}

      {trip.status === 'DELIVERED' && <Alert tone="green">Delivered <Ist at={trip.deliveredAt} />. E-Way bill {trip.ewayBillNumber ?? '—'}.</Alert>}
    </Card>
  );
}
