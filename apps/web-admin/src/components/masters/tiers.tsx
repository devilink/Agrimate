'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { InspectionFeeTier, VehicleTier } from '@agrimate/api-client';
import { Alert, Button, Field, Input, Money, Table, Td } from '@agrimate/ui';
import { formatINR } from '@agrimate/shared';
import { api, errorMessage, handleAuthError } from '@/lib/api';
import { paiseToRupees, rupeesToPaise } from '@/lib/money';
import { useLoad } from '@/lib/use-load';
import { ConfirmDialog, InlineSuccess, Mono, Q, Section } from '@/components/console';

export function VehicleTiers() {
  const q = useLoad(() => api.get<VehicleTier[]>('/masters/vehicle-tiers'), []);
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <>
      <Alert tone="blue" className="mb-3">Trips snapshot the rate when freight is quoted, so a new rate applies to new quotes only.</Alert>
      {flash && <InlineSuccess onDismiss={() => setFlash(null)}>{flash}</InlineSuccess>}
      <Q q={q} isEmpty={(d) => d.length === 0} emptyTitle="No vehicle tiers">
        {(rows) => (
          <Table className="mb-6" head={['Code', 'Name', 'Capacity', 'Current rate', 'New rate (rupees per km)']}>
            {rows.map((t) => <RateRow key={t.id} tier={t} onSaved={async (m) => { setFlash(m); await q.reload(); }} />)}
          </Table>
        )}
      </Q>
      <AddTier onDone={async (m) => { setFlash(m); await q.reload(); }} />
    </>
  );
}

function RateRow({ tier, onSaved }: { tier: VehicleTier; onSaved: (m: string) => Promise<void> }) {
  const [value, setValue] = useState(paiseToRupees(tier.ratePaisePerKm));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(paiseToRupees(tier.ratePaisePerKm)), [tier.ratePaisePerKm]);
  const parsed = rupeesToPaise(value);
  const changed = parsed.ok && parsed.paise !== tier.ratePaisePerKm;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.ok) return;
    setBusy(true); setError(null);
    try {
      await api.patch(`/masters/vehicle-tiers/${tier.id}`, { ratePaisePerKm: parsed.paise });
      await onSaved(`${tier.name} rate is now ${formatINR(parsed.paise)} per km.`);
    } catch (err) { handleAuthError(err); setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <tr>
      <Td><Mono>{tier.code}</Mono></Td><Td>{tier.name}</Td><Td className="whitespace-nowrap tabular-nums">{tier.minKg} to {tier.maxKg} kg</Td><Td className="whitespace-nowrap"><Money paise={tier.ratePaisePerKm} /> per km</Td>
      <Td>
        <form onSubmit={save} className="flex items-center gap-2">
          <Input aria-label={`New rate for ${tier.name} in rupees per km`} inputMode="decimal" className="h-8 w-28 px-2" value={value} onChange={(e) => setValue(e.target.value)} />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save'}</Button>
        </form>
        {!parsed.ok && value.trim() && <p role="alert" className="mt-1 text-xs text-red-700">{parsed.error}</p>}
        {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
      </Td>
    </tr>
  );
}

function AddTier({ onDone }: { onDone: (m: string) => Promise<void> }) {
  const [f, setF] = useState({ code: '', name: '', minKg: '', maxKg: '', rate: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rate = rupeesToPaise(f.rate);
  const intOk = (s: string) => /^\d+$/.test(s.trim());
  const codeOk = /^[A-Z0-9_]+$/.test(f.code);
  const rangeOk = intOk(f.minKg) && intOk(f.maxKg) && Number(f.maxKg) >= 1 && Number(f.minKg) <= Number(f.maxKg);
  const valid = codeOk && !!f.name.trim() && rangeOk && rate.ok;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!rate.ok || !valid) return;
    setBusy(true); setError(null);
    try {
      await api.post('/masters/vehicle-tiers', { code: f.code, name: f.name.trim(), minKg: Number(f.minKg), maxKg: Number(f.maxKg), ratePaisePerKm: rate.paise });
      setF({ code: '', name: '', minKg: '', maxKg: '', rate: '' });
      await onDone(`Vehicle tier ${f.name.trim()} added.`);
    } catch (err) { handleAuthError(err); setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Section title="Add a vehicle tier">
      <form onSubmit={submit} className="grid max-w-3xl grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-5">
        <Field label="Code"><Input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Minimum kg"><Input required inputMode="numeric" value={f.minKg} onChange={(e) => setF({ ...f, minKg: e.target.value })} /></Field>
        <Field label="Maximum kg"><Input required inputMode="numeric" value={f.maxKg} onChange={(e) => setF({ ...f, maxKg: e.target.value })} /></Field>
        <Field label="Rupees per km"><Input required inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
        <div className="col-span-full flex items-center gap-3">
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !valid}>{busy ? 'Adding…' : 'Add tier'}</Button>
          {f.code && !codeOk && <span role="alert" className="text-xs text-red-700">Code uses capital letters, digits and underscores only.</span>}
          {f.minKg && f.maxKg && !rangeOk && <span role="alert" className="text-xs text-red-700">Enter whole kg, with the minimum no higher than the maximum.</span>}
        </div>
        {error && <Alert tone="red" role="alert" className="col-span-full">{error}</Alert>}
      </form>
    </Section>
  );
}

interface FeeRow { max: string; fee: string }

export function InspectionTiers() {
  const q = useLoad(() => api.get<InspectionFeeTier[]>('/masters/inspection-tiers'), []);
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <>
      <Alert tone="blue" className="mb-3">Orders snapshot the inspection fee when created, so changes apply to new orders only. Exactly one tier must be open-ended, or some weights would have no fee.</Alert>
      {flash && <InlineSuccess onDismiss={() => setFlash(null)}>{flash}</InlineSuccess>}
      <Q q={q}>{(rows) => <FeeEditor key={rows.map((r) => r.id).join()} tiers={rows} onSaved={async (m) => { setFlash(m); await q.reload(); }} />}</Q>
    </>
  );
}

function FeeEditor({ tiers, onSaved }: { tiers: InspectionFeeTier[]; onSaved: (m: string) => Promise<void> }) {
  const [rows, setRows] = useState<FeeRow[]>(() => tiers.map((t) => ({ max: t.maxKgInclusive?.toString() ?? '', fee: paiseToRupees(t.feePaise) })));
  const [confirm, setConfirm] = useState(false);
  const set = (i: number, patch: Partial<FeeRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const openEnded = rows.filter((r) => r.max.trim() === '').length;
  const parsedFees = rows.map((r) => rupeesToPaise(r.fee));
  const maxes = rows.filter((r) => r.max.trim() !== '').map((r) => r.max.trim());
  const maxBad = maxes.some((m) => !/^[1-9]\d*$/.test(m));
  const dupes = new Set(maxes.map(Number)).size !== maxes.length;
  const problems = [
    openEnded !== 1 && `Exactly one tier must be open-ended (leave its maximum blank). There ${openEnded === 1 ? 'is' : 'are'} ${openEnded} now.`,
    maxBad && 'Maximum weights must be whole numbers of kg, 1 or more.',
    dupes && 'Two tiers have the same maximum weight.',
    parsedFees.some((f) => !f.ok) && 'Every tier needs a valid fee in rupees.',
  ].filter(Boolean) as string[];

  /** Sorted as the API returns them, so that the confirmation reads in weight order. */
  const payload = rows
    .map((r, i) => { const f = parsedFees[i]!; return { ...(r.max.trim() ? { maxKgInclusive: Number(r.max) } : { maxKgInclusive: null }), feePaise: f.ok ? f.paise : '0' }; })
    .sort((a, b) => (a.maxKgInclusive ?? Infinity) - (b.maxKgInclusive ?? Infinity));

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!problems.length) setConfirm(true); }} className="max-w-xl space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Inspection fee tiers</caption>
          <thead className="text-xs text-slate-600"><tr><th scope="col" className="p-1 font-medium">Up to and including (kg), blank is open-ended</th><th scope="col" className="p-1 font-medium">Fee (rupees)</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="p-1"><Input aria-label={`Tier ${i + 1} maximum kg`} inputMode="numeric" className="h-8 px-2" placeholder="Open-ended" value={r.max} onChange={(e) => set(i, { max: e.target.value })} /></td>
                <td className="p-1"><Input aria-label={`Tier ${i + 1} fee in rupees`} inputMode="decimal" className="h-8 px-2" value={r.fee} onChange={(e) => set(i, { fee: e.target.value })} /></td>
                <td className="p-1"><Button type="button" size="sm" variant="ghost" disabled={rows.length === 1} aria-label={`Remove tier ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setRows((rs) => [...rs, { max: '', fee: '' }])}>Add tier</Button>
      </div>
      {problems.length > 0 && <Alert tone="red" role="alert"><ul className="list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert>}
      <Button type="submit" size="sm" disabled={problems.length > 0}>Review and save</Button>
      {confirm && (
        <ConfirmDialog
          title="Replace inspection fee tiers" confirmLabel="Replace tiers" onClose={() => setConfirm(false)}
          onConfirm={async () => { await api.put('/masters/inspection-tiers', { tiers: payload }); await onSaved('Inspection fee tiers saved.'); }}
        >
          <p>All tiers are replaced with these. New orders use them; existing orders keep the fee they were created with.</p>
          <Table head={['Weight', 'Fee']}>
            {payload.map((t, i) => <tr key={i}><Td>{t.maxKgInclusive === null ? 'Everything above' : `Up to ${t.maxKgInclusive} kg`}</Td><Td>{formatINR(t.feePaise)}</Td></tr>)}
          </Table>
        </ConfirmDialog>
      )}
    </form>
  );
}

