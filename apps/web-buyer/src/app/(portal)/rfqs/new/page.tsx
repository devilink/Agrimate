'use client';
import type { Commodity, PriceSuggestion, RfqView } from '@agrimate/api-client';
import { formatINR, formatTonnes, isValidPin, istDateString } from '@agrimate/shared';
import { Alert, Button, Card, CardTitle, Field, Input, Select, Skeleton } from '@agrimate/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Checkbox, ErrorState, Fact, FormError, GradeSpecTable, KybBlockedNotice, PageHeader, PinInput } from '@/components/common';
import { api } from '@/lib/api';
import { useAction, useResource } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { formatKg, lineTotalPaise, paiseToRupeesInput, rupeesToPaise, tonnesToKg } from '@/lib/units';

const MIN_KG = 100;

export default function NewRfqPage() {
  const router = useRouter();
  const { me, kybVerified } = useSession();
  const commodities = useResource(() => api.get<Commodity[]>('/masters/commodities'), []);

  const [commodityId, setCommodityId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [tonnes, setTonnes] = useState('');
  const [pin, setPin] = useState(me.buyer?.defaultPin ?? '');
  const [neededBy, setNeededBy] = useState('');
  const [target, setTarget] = useState('');
  const [organic, setOrganic] = useState(false);
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();

  const commodity = commodities.data?.find((c) => c.id === commodityId);
  const grade = commodity?.grades.find((g) => g.id === gradeId);
  const suggestion = useResource<PriceSuggestion>(commodityId ? () => api.get<PriceSuggestion>(`/market/suggestion?commodityId=${commodityId}`) : null, [commodityId]);

  // A grade from the previous commodity must not survive a commodity change.
  useEffect(() => { setGradeId(''); }, [commodityId]);

  const minDate = useMemo(() => istDateString(new Date(Date.now() + 86_400_000)), []);
  const kg = tonnesToKg(tonnes);
  const paise = rupeesToPaise(target);
  const errors = {
    commodity: !commodityId ? 'Choose a commodity.' : undefined,
    grade: !gradeId ? 'Choose a grade.' : undefined,
    tonnes: kg === null ? 'Enter a volume in tonnes, up to 3 decimals.' : kg < MIN_KG ? 'The minimum volume is 0.1 tonne.' : undefined,
    pin: !isValidPin(pin) ? 'Enter a 6 digit delivery PIN.' : undefined,
    neededBy: !neededBy ? 'Choose a date.' : neededBy < minDate ? 'Choose a date after today.' : undefined,
    target: paise === null ? 'Enter a price in rupees per kg, up to 2 decimals.' : paise === '0' ? 'The price must be above zero.' : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const totalPaise = kg && paise && paise !== '0' ? lineTotalPaise(kg, paise) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (hasErrors || kg === null || paise === null) return;
    void run(async () => {
      const rfq = await api.post<RfqView>('/rfqs', {
        commodityId, gradeId, quantityKg: kg, deliveryPin: pin,
        // The chosen calendar date in IST, kept to its last moment so that the whole day counts.
        neededBy: new Date(`${neededBy}T23:59:59.999+05:30`).toISOString(),
        targetPricePaisePerKg: paise, organicRequired: organic,
      });
      router.push(`/rfqs?rfq=${rfq.id}`);
    });
  };

  const shown = (m: string | undefined) => (touched ? m : undefined);

  return (
    <>
      <PageHeader title="Post RFQ" description="Ask farmers to bid on a volume, grade and delivery location." />
      <div className="mb-4 max-w-5xl"><KybBlockedNotice action="post an RFQ" /></div>
      {commodities.error && <ErrorState message={commodities.error} onRetry={() => void commodities.reload()} />}
      <form onSubmit={submit} noValidate className="grid max-w-5xl gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card>
            <CardTitle>Produce</CardTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Commodity" error={shown(errors.commodity)}>
                <Select value={commodityId} disabled={busy || commodities.loading} onChange={(e) => setCommodityId(e.target.value)}>
                  <option value="">{commodities.loading ? 'Loading' : 'Choose a commodity'}</option>
                  {commodities.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Grade" error={shown(errors.grade)}>
                <Select value={gradeId} disabled={busy || !commodity} onChange={(e) => setGradeId(e.target.value)}>
                  <option value="">{commodity ? 'Choose a grade' : 'Choose a commodity first'}</option>
                  {commodity?.grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </Select>
              </Field>
            </div>
            {grade && (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-medium text-slate-800">Grade parameters</h3>
                <GradeSpecTable parameters={grade.parameters} />
                <p className="mt-2 text-xs text-slate-500">Inspection checks the produce against these values.</p>
              </div>
            )}
            <div className="mt-4"><Checkbox label="Certified organic only" checked={organic} disabled={busy} onChange={setOrganic} /></div>
          </Card>
          <Card>
            <CardTitle>Volume and delivery</CardTitle>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Volume (tonnes)" error={shown(errors.tonnes)} hint={kg ? `${formatKg(kg)}` : 'Minimum 0.1 tonne'}>
                <Input inputMode="decimal" value={tonnes} disabled={busy} onChange={(e) => setTonnes(e.target.value)} placeholder="10" />
              </Field>
              <Field label="Delivery PIN" error={shown(errors.pin)}><PinInput value={pin} disabled={busy} onChange={setPin} /></Field>
              <Field label="Needed by" error={shown(errors.neededBy)}><Input type="date" min={minDate} value={neededBy} disabled={busy} onChange={(e) => setNeededBy(e.target.value)} /></Field>
            </div>
          </Card>
          <Card>
            <CardTitle>Target price</CardTitle>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field label="Target price (₹ per kg)" error={shown(errors.target)}>
                <Input inputMode="decimal" value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)} placeholder="25.50" />
              </Field>
              <div className="space-y-1 text-sm" aria-live="polite">
                <p className="font-medium text-slate-700">Suggested market average</p>
                {!commodityId && <p className="text-slate-500">Choose a commodity to see it.</p>}
                {commodityId && suggestion.loading && <Skeleton className="h-5 w-32" />}
                {commodityId && !suggestion.loading && suggestion.error && <p className="text-red-700">{suggestion.error}</p>}
                {commodityId && !suggestion.loading && suggestion.data?.averagePaisePerKg === null && <p className="text-slate-500">No recent market data for this commodity.</p>}
                {commodityId && !suggestion.loading && suggestion.data?.averagePaisePerKg && (
                  <>
                    <p className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums text-slate-900">{formatINR(suggestion.data.averagePaisePerKg)}/kg</span>
                      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setTarget(paiseToRupeesInput(suggestion.data!.averagePaisePerKg!))}>Use this price</Button>
                    </p>
                    <p className="text-xs text-slate-500">Average of {suggestion.data.sampleSize} market quotes over the last {suggestion.data.windowDays} days.</p>
                  </>
                )}
              </div>
            </div>
            <Alert tone="blue" className="mt-4">The target price locks when you post. Bids cannot exceed it and it cannot be edited later. To change it, cancel the RFQ and post a new one.</Alert>
          </Card>
        </div>
        <Card className="self-start lg:sticky lg:top-6">
          <CardTitle>Review</CardTitle>
          <dl className="divide-y divide-slate-100">
            <Fact label="Produce">{commodity ? `${commodity.name}${grade ? `, ${grade.name}` : ''}` : '—'}</Fact>
            <Fact label="Volume">{kg ? formatTonnes(kg) : '—'}</Fact>
            <Fact label="Target price"><span className="tabular-nums">{paise && paise !== '0' ? `${formatINR(paise)}/kg` : '—'}</span></Fact>
            <Fact label="Value at target"><span className="tabular-nums">{totalPaise ? formatINR(totalPaise) : '—'}</span></Fact>
          </dl>
          <div className="mt-3 space-y-3">
            <FormError message={error} />
            <Button type="submit" className="w-full" disabled={busy || !kybVerified}>{busy ? 'Posting' : 'Post RFQ and lock price'}</Button>
          </div>
        </Card>
      </form>
    </>
  );
}
