'use client';

import { useState } from 'react';
import { Field, Input, Select, buttonClass } from '@/components/ui';
import type { VehicleRate } from '@/lib/types';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/**
 * The freight amount on an order, with an estimate from the admin's rate card: per trip, the larger of rate × km and
 * the minimum charge; trips = quantity ÷ vehicle capacity, rounded up. The admin can always type their own amount.
 */
export function FreightInput({ vehicles, quantityKg, defaultRupees }: { vehicles: VehicleRate[]; quantityKg: number; defaultRupees: string }) {
  const [value, setValue] = useState(defaultRupees);
  const fits = vehicles.find((v) => v.capacity_kg >= quantityKg) ?? vehicles[vehicles.length - 1];
  const [vehicleId, setVehicleId] = useState(fits?.id ?? '');
  const [km, setKm] = useState('');

  const v = vehicles.find((x) => x.id === vehicleId);
  const distance = Number(km);
  const trips = v ? Math.max(1, Math.ceil(quantityKg / v.capacity_kg)) : 0;
  const perTrip = v && distance > 0 ? Math.max(v.min_charge_paise, v.rate_paise_per_km * distance) : 0;
  const estimate = Math.round((perTrip * trips) / 100); // rupees

  return (
    <div className="space-y-2 sm:col-span-2">
      <Field label="Freight charged to buyer (₹)">
        <Input name="freight" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      {vehicles.length > 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50/60 p-3">
          <div className="mb-2 text-xs font-semibold text-stone-600">Estimate from the rate card</div>
          <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_auto]">
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Vehicle">
              {vehicles.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.capacity_kg / 1000} t)</option>)}
            </Select>
            <Input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/[^\d]/g, ''))} placeholder="Road distance (km)" aria-label="Road distance in km" />
            <button type="button" disabled={!estimate} onClick={() => setValue(String(estimate))} className={buttonClass('secondary', true)}>
              Use {estimate ? inr.format(estimate) : 'estimate'}
            </button>
          </div>
          {estimate > 0 && v && (
            <p className="mt-2 text-xs text-stone-500">
              {trips} trip{trips === 1 ? '' : 's'} × {inr.format(perTrip / 100)} ({distance} km × {inr.format(v.rate_paise_per_km / 100)}/km
              {perTrip === v.min_charge_paise ? ', minimum charge' : ''})
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-stone-500">Add vehicles to the freight rate card in Settings to get estimates here.</p>
      )}
    </div>
  );
}
