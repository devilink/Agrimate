'use client';
import type { BuyerOrder, FreightQuote } from '@agrimate/api-client';
import { formatINR, normalisePhone, PHONE_RE, VEHICLE_NO_RE } from '@agrimate/shared';
import { Alert, Button, Card, CardTitle, Field, Input, Money, Skeleton, StateBadge } from '@agrimate/ui';
import { type FormEvent, useState } from 'react';
import { ErrorState, Fact, FormError } from '@/components/common';
import { api } from '@/lib/api';
import { useAction, useResource } from '@/lib/hooks';

const NO_CO_LOADING = 'No co-loading: the vehicle carries only this order. Carrying other commercial goods with agricultural produce is strictly banned, and every partner attests to this before accepting a trip.';

function FreightRows(f: { distanceKm: number; vehicle: string; ratePerKm: string; haulage: string; loading: string; base: string; markup: string; final: string; ptkm: string }) {
  return (
    <dl className="divide-y divide-slate-100">
      <Fact label="Distance"><span className="tabular-nums">{f.distanceKm.toLocaleString('en-IN')} km</span></Fact>
      <Fact label="Vehicle">{f.vehicle}</Fact>
      <Fact label="Vehicle rate"><span className="tabular-nums">{formatINR(f.ratePerKm)}/km</span></Fact>
      <Fact label="Haulage (distance × rate)"><Money paise={f.haulage} /></Fact>
      <Fact label="Loading fee"><Money paise={f.loading} /></Fact>
      <Fact label="Base cost"><Money paise={f.base} /></Fact>
      <Fact label="Platform markup"><Money paise={f.markup} /></Fact>
      <Fact label="Final freight"><Money paise={f.final} className="font-semibold" /></Fact>
      <Fact label="Rate per tonne-km"><span className="tabular-nums">{formatINR(f.ptkm, { alwaysPaise: true })}/tonne-km</span></Fact>
    </dl>
  );
}

function ChooseLogistics({ order, onChanged }: { order: BuyerOrder; onChanged: () => Promise<void> }) {
  const canBook = order.state === 'LOGISTICS_PENDING';
  const [mode, setMode] = useState<'PLATFORM' | 'EXTERNAL'>('PLATFORM');
  const quote = useResource(() => api.get<FreightQuote>(`/orders/${order.id}/freight-quote`), [order.id]);
  const book = useAction();
  const ext = useAction();
  const [vehicleNo, setVehicleNo] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [touched, setTouched] = useState(false);

  const phone = normalisePhone(driverPhone.trim());
  const vehicleError = !VEHICLE_NO_RE.test(vehicleNo) ? 'Enter the registration like AS01AB1234.' : undefined;
  const phoneError = !PHONE_RE.test(phone) ? 'Enter a 10 digit Indian mobile number.' : undefined;

  const declare = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (vehicleError || phoneError) return;
    void ext.run(async () => {
      await api.post(`/orders/${order.id}/logistics/external`, { vehicleNo, driverPhone: phone });
      await onChanged();
    });
  };
  const bookPlatform = () => void book.run(async () => {
    await api.post(`/orders/${order.id}/logistics/platform`);
    await onChanged();
  });

  const tabClass = (on: boolean) => `flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${on ? 'border-emerald-700 bg-emerald-50' : 'border-slate-300 bg-white'}`;

  return (
    <div className="space-y-4">
      {!canBook && <Alert tone="amber">You can arrange logistics after the advance is locked. The quote below is for planning.</Alert>}
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Transport</legend>
        <label className={tabClass(mode === 'PLATFORM')}>
          <input type="radio" name="logistics" className="mt-0.5 accent-emerald-700" checked={mode === 'PLATFORM'} onChange={() => setMode('PLATFORM')} />
          <span><span className="block font-medium text-slate-900">Agrimate transport</span><span className="text-slate-600">A verified partner carries the load. Freight is paid in full into escrow first.</span></span>
        </label>
        <label className={tabClass(mode === 'EXTERNAL')}>
          <input type="radio" name="logistics" className="mt-0.5 accent-emerald-700" checked={mode === 'EXTERNAL'} onChange={() => setMode('EXTERNAL')} />
          <span><span className="block font-medium text-slate-900">Your own transport</span><span className="text-slate-600">You arrange the vehicle and confirm delivery yourself.</span></span>
        </label>
      </fieldset>

      {mode === 'PLATFORM' && (
        <div className="space-y-3">
          {quote.loading && !quote.data && <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>}
          {quote.error && <ErrorState message={quote.error} onRetry={() => void quote.reload()} />}
          {quote.data && (
            <>
              <FreightRows distanceKm={quote.data.distanceKm} vehicle={`${quote.data.tierName} for ${quote.data.tonnes} t`} ratePerKm={quote.data.vehicleRatePaisePerKm} haulage={quote.data.haulagePaise} loading={quote.data.loadingFeePaise} base={quote.data.baseCostPaise} markup={quote.data.markupPaise} final={quote.data.finalFreightPaise} ptkm={quote.data.displayPtkmPaise} />
              <p className="rounded-md bg-slate-50 p-2.5 text-xs text-slate-700">{NO_CO_LOADING}</p>
              <FormError message={book.error} />
              <Button disabled={!canBook || book.busy} onClick={bookPlatform}>{book.busy ? 'Booking' : `Book transport for ${formatINR(quote.data.finalFreightPaise)}`}</Button>
            </>
          )}
        </div>
      )}

      {mode === 'EXTERNAL' && (
        <form onSubmit={declare} noValidate className="space-y-3">
          <div className="grid max-w-lg gap-3 sm:grid-cols-2">
            <Field label="Vehicle number" error={touched ? vehicleError : undefined}><Input placeholder="AS01AB1234" spellCheck={false} value={vehicleNo} disabled={ext.busy} onChange={(e) => setVehicleNo(e.target.value.toUpperCase().replace(/[\s-]/g, ''))} /></Field>
            <Field label="Driver phone" error={touched ? phoneError : undefined}><Input type="tel" placeholder="+91 98765 43210" value={driverPhone} disabled={ext.busy} onChange={(e) => setDriverPhone(e.target.value)} /></Field>
          </div>
          <FormError message={ext.error} />
          <Button type="submit" disabled={!canBook || ext.busy}>{ext.busy ? 'Saving' : 'Save transport details'}</Button>
        </form>
      )}
    </div>
  );
}

export function LogisticsCard({ order, onChanged }: { order: BuyerOrder; onChanged: () => Promise<void> }) {
  const closed = ['CANCELLED', 'REFUNDED', 'FARMER_DEFAULTED', 'BUYER_DEFAULTED'].includes(order.state);
  return (
    <Card>
      <CardTitle>Logistics</CardTitle>
      {!order.logisticsMode && closed && <p className="text-sm text-slate-600">No logistics were arranged for this order.</p>}
      {!order.logisticsMode && !closed && <ChooseLogistics order={order} onChanged={onChanged} />}
      {order.logisticsMode === 'EXTERNAL' && (
        <dl className="max-w-md divide-y divide-slate-100">
          <Fact label="Transport">Your own transport</Fact>
          <Fact label="Vehicle number"><span className="tabular-nums">{order.external?.vehicleNo ?? '—'}</span></Fact>
          <Fact label="Driver phone"><span className="tabular-nums">{order.external?.driverPhone ?? '—'}</span></Fact>
        </dl>
      )}
      {order.logisticsMode === 'PLATFORM' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-medium text-slate-800">Trip</h3>
            <dl className="divide-y divide-slate-100">
              <Fact label="Transport">Agrimate transport</Fact>
              <Fact label="Trip status">{order.trip ? <StateBadge state={order.trip.status} /> : '—'}</Fact>
              <Fact label="Vehicle"><span className="tabular-nums">{order.trip?.vehicleRegNo ?? 'Not assigned yet'}</span></Fact>
              <Fact label="E-Way bill no"><span className="tabular-nums">{order.trip?.ewayBillNumber ?? '—'}</span></Fact>
            </dl>
            {order.trip && !order.trip.fundedAt && <p className="mt-2 text-xs text-slate-600">Partners are offered this route once the freight is fully in escrow.</p>}
            <p className="mt-3 rounded-md bg-slate-50 p-2.5 text-xs text-slate-700">{NO_CO_LOADING}</p>
          </div>
          {order.freight && (
            <div>
              <h3 className="mb-1 text-sm font-medium text-slate-800">Freight</h3>
              <FreightRows
                distanceKm={order.freight.distanceKm} vehicle={order.trip?.tierCode.toLowerCase().replace(/_/g, ' ') ?? '—'} ratePerKm={order.freight.ratePaisePerKm}
                haulage={(BigInt(order.freight.baseCostPaise) - BigInt(order.freight.loadingFeePaise)).toString()} loading={order.freight.loadingFeePaise}
                base={order.freight.baseCostPaise} markup={order.freight.markupPaise} final={order.freight.finalFreightPaise} ptkm={order.freight.displayPtkmPaise}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
