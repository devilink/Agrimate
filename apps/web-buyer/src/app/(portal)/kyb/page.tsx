'use client';
import { gstinMatchesPan, isValidGstin, isValidPan, isValidPin } from '@agrimate/shared';
import { Alert, Button, Card, CardTitle, Field, Input, StateBadge } from '@agrimate/ui';
import { type FormEvent, useState } from 'react';
import { Fact, FormError, PageHeader, PinInput } from '@/components/common';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';

const STATUS_TEXT: Record<string, { tone: 'green' | 'amber' | 'red'; text: string }> = {
  VERIFIED: { tone: 'green', text: 'Your business is verified. You can post RFQs and accept offers.' },
  NOT_SUBMITTED: { tone: 'amber', text: 'Trading is blocked until your business is verified. Submit your GSTIN and PAN below.' },
  PENDING: { tone: 'amber', text: 'Your details are being checked. Trading stays blocked until this finishes.' },
  MANUAL_REVIEW: { tone: 'amber', text: 'Automatic checks could not confirm your details, so our team is reviewing them. Trading stays blocked until they approve.' },
  REJECTED: { tone: 'red', text: 'Verification was rejected. Trading is blocked. Correct your details and submit again.' },
};

export default function KybPage() {
  const { me, reloadMe } = useSession();
  const b = me.buyer;
  const status = b?.kybStatus ?? 'NOT_SUBMITTED';
  const info = STATUS_TEXT[status] ?? STATUS_TEXT.NOT_SUBMITTED!;

  const [companyName, setCompanyName] = useState(b?.companyName ?? '');
  const [gstin, setGstin] = useState(b?.gstin ?? '');
  const [pan, setPan] = useState('');
  const [defaultPin, setDefaultPin] = useState(b?.defaultPin ?? '');
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();

  const errors = {
    companyName: companyName.trim().length < 2 ? 'Enter the registered business name.' : undefined,
    gstin: !isValidGstin(gstin) ? 'Enter a valid 15 character GSTIN. The check digit must match.' : undefined,
    pan: !isValidPan(pan) ? 'Enter a valid 10 character PAN, like AABCB1234C.' : isValidGstin(gstin) && !gstinMatchesPan(gstin, pan) ? 'This PAN does not match characters 3 to 12 of the GSTIN.' : undefined,
    defaultPin: defaultPin && !isValidPin(defaultPin) ? 'Enter a 6 digit PIN, or leave this empty.' : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (hasErrors) return;
    void run(async () => {
      await api.post('/onboarding/buyer/kyb', { companyName: companyName.trim(), gstin, pan, ...(defaultPin ? { defaultPin } : {}) });
      await reloadMe();
      setPan('');
      setTouched(false);
    });
  };

  return (
    <>
      <PageHeader title="Business verification" description="We verify your GSTIN and PAN before you can trade on Agrimate." />
      <div className="grid max-w-5xl gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Alert tone={info.tone}>{info.text}{b?.kybNote ? ` Note from review: ${b.kybNote}` : ''}</Alert>
          {status !== 'VERIFIED' && (
            <Card>
              <CardTitle>Business details</CardTitle>
              <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Registered business name" error={touched ? errors.companyName : undefined}><Input autoComplete="organization" value={companyName} disabled={busy} onChange={(e) => setCompanyName(e.target.value)} /></Field>
                </div>
                <Field label="GSTIN" error={touched ? errors.gstin : undefined}><Input maxLength={15} spellCheck={false} placeholder="18AABCB1234C1ZD" value={gstin} disabled={busy} onChange={(e) => setGstin(e.target.value.toUpperCase().trim())} /></Field>
                <Field label="PAN" error={touched ? errors.pan : undefined}><Input maxLength={10} spellCheck={false} placeholder="AABCB1234C" value={pan} disabled={busy} onChange={(e) => setPan(e.target.value.toUpperCase().trim())} /></Field>
                <Field label="Default delivery PIN (optional)" error={touched ? errors.defaultPin : undefined}><PinInput value={defaultPin} disabled={busy} onChange={setDefaultPin} /></Field>
                <div className="space-y-3 sm:col-span-2">
                  <FormError message={error} />
                  <Button type="submit" disabled={busy}>{busy ? 'Submitting' : 'Submit for verification'}</Button>
                </div>
              </form>
            </Card>
          )}
        </div>
        <Card className="self-start">
          <CardTitle>Current status</CardTitle>
          <dl className="divide-y divide-slate-100">
            <Fact label="Status"><StateBadge state={status} /></Fact>
            <Fact label="Business">{b?.companyName ?? '—'}</Fact>
            <Fact label="GSTIN"><span className="tabular-nums">{b?.gstin ?? '—'}</span></Fact>
            <Fact label="Default PIN"><span className="tabular-nums">{b?.defaultPin ?? '—'}</span></Fact>
          </dl>
        </Card>
      </div>
    </>
  );
}
