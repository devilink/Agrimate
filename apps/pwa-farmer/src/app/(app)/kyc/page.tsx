'use client';
import type { MeView } from '@agrimate/api-client';
import { IFSC_RE, PAN_RE, PIN_RE } from '@agrimate/shared';
import { useEffect, useState } from 'react';
import { CheckIcon, LocationIcon, ShieldIcon } from '@/components/icons';
import { BigButton, BigLink, ErrorNotice, Field, ListSkeleton, Notice, PageTitle, Panel, Row, TextInput, cn } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { GpsError, getPosition } from '@/lib/media';
import { useApi } from '@/lib/use-api';

interface KycResult { kycStatus: string; kycNote: string | null; payoutsEnabled: boolean; bankLast4: string | null; panLast4: string | null }

/** The API's note is English: `Bank holder name "X" does not match PAN name "Y"`. The two names are worth showing as they are. */
const namesInNote = (note: string | null | undefined) => {
  const m = /"([^"]+)".*"([^"]+)"/.exec(note ?? '');
  return m ? { bank: m[1]!, pan: m[2]! } : null;
};

/** States the outcome plainly, in particular that payouts are blocked and what to do about it. */
function KycOutcome({ status, note, payoutsEnabled, bankLast4, panLast4 }: { status: string; note: string | null | undefined; payoutsEnabled: boolean; bankLast4?: string | null; panLast4?: string | null }) {
  const { t } = useI18n();
  const details = (bankLast4 || panLast4) && (
    <Panel>
      {panLast4 && <Row label={t('kyc.panEnding')}>{panLast4}</Row>}
      {bankLast4 && <Row label={t('kyc.bankEnding')}>{bankLast4}</Row>}
      <Row label={t('kyc.payouts')}>{payoutsEnabled ? t('kyc.payoutsOn') : t('kyc.payoutsOff')}</Row>
    </Panel>
  );
  if (status === 'VERIFIED') return <div className="space-y-3"><Notice tone="success" title={t('kyc.verifiedTitle')}>{t('kyc.verifiedBody')}</Notice>{details}</div>;
  if (status === 'MANUAL_REVIEW') {
    const names = namesInNote(note);
    const bankProblem = note?.startsWith('Bank account could not');
    return (
      <div className="space-y-3">
        <Notice tone="error" title={bankProblem ? t('kyc.bankInvalidTitle') : t('kyc.mismatchTitle')}>
          <p>{bankProblem ? t('kyc.bankInvalidBody') : t('kyc.mismatchBody')}</p>
          {names && <div className="mt-2 rounded-lg bg-white p-2 text-slate-950"><Row label={t('kyc.nameAtBank')}>{names.bank}</Row><Row label={t('kyc.nameOnPan')}>{names.pan}</Row></div>}
        </Notice>
        <Notice tone="info" title={t('kyc.whatNextTitle')}>{t('kyc.whatNextBody')}</Notice>
        {details}
      </div>
    );
  }
  if (status === 'REJECTED') return <Notice tone="error" title={t('kyc.rejectedTitle')}>{t('kyc.rejectedBody')}</Notice>;
  return null;
}

export default function KycPage() {
  const { t } = useI18n();
  const { data: me, loading, reload } = useApi<MeView>('/auth/me');
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<KycResult | null>(null);
  const [pan, setPan] = useState('');
  const [panName, setPanName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [holder, setHolder] = useState('');
  const [pin, setPin] = useState('');
  const [isFpo, setIsFpo] = useState(false);
  const [fpoName, setFpoName] = useState('');
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsState, setGpsState] = useState<'idle' | 'finding' | 'failed' | 'denied'>('idle');
  const [pinPlace, setPinPlace] = useState<{ pin: string; district?: string; state?: string; known: boolean } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Tell the farmer straight away which place the PIN is, and whether the master knows it at all.
  useEffect(() => {
    if (!PIN_RE.test(pin)) { setPinPlace(null); return; }
    let live = true;
    api.get<{ district: string; state: string }>(`/masters/pincodes/${pin}`)
      .then((p) => { if (live) setPinPlace({ pin, district: p.district, state: p.state, known: true }); })
      .catch(() => { if (live) setPinPlace({ pin, known: false }); });
    return () => { live = false; };
  }, [pin]);

  if (loading) return <ListSkeleton rows={2} />;
  const farmer = me?.farmer;
  const status = result?.kycStatus ?? farmer?.kycStatus ?? 'NOT_SUBMITTED';
  const showForm = editing || status === 'NOT_SUBMITTED';

  const errors = {
    pan: pan && !PAN_RE.test(pan) ? t('kyc.panInvalid') : null,
    ifsc: ifsc && !IFSC_RE.test(ifsc) ? t('kyc.ifscInvalid') : null,
    pin: pin && !PIN_RE.test(pin) ? t('kyc.pinInvalid') : null,
    bank: bankAccount && (bankAccount.length < 6 || bankAccount.length > 20) ? t('kyc.bankInvalid') : null,
  };
  const complete = PAN_RE.test(pan) && panName.trim().length >= 2 && bankAccount.length >= 6 && bankAccount.length <= 20 && IFSC_RE.test(ifsc) && holder.trim().length >= 2 && PIN_RE.test(pin) && (!isFpo || fpoName.trim().length >= 2);

  async function findLocation() {
    setGpsState('finding');
    try {
      const p = await getPosition();
      setGps({ lat: p.lat, lng: p.lng });
      setGpsState('idle');
    } catch (e) {
      setGpsState(e instanceof GpsError && e.reason === 'denied' ? 'denied' : 'failed');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!complete || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<KycResult>('/onboarding/farmer/kyc', {
        pan, panName: panName.trim(), bankAccount, ifsc, bankHolderName: holder.trim(), pin,
        type: isFpo ? 'FPO' : 'INDIVIDUAL',
        ...(isFpo ? { fpoName: fpoName.trim() } : {}),
        ...(gps ?? {}),
      });
      setResult(r);
      setSubmitted(true);
      setEditing(false);
      setPan(''); setBankAccount('');
      await reload();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <PageTitle back="/account">{t('kyc.title')}</PageTitle>
      {!showForm && (
        <>
          <KycOutcome status={status} note={result?.kycNote ?? farmer?.kycNote} payoutsEnabled={result?.payoutsEnabled ?? farmer?.payoutsEnabled ?? false} bankLast4={result?.bankLast4 ?? farmer?.bankLast4} panLast4={result?.panLast4 ?? farmer?.panLast4} />
          {submitted && <BigLink href="/">{t('kyc.goHome')}</BigLink>}
          <BigButton variant={status === 'VERIFIED' || submitted ? 'secondary' : 'primary'} icon={ShieldIcon} onClick={() => { setEditing(true); setSubmitted(false); }}>{t('kyc.change')}</BigButton>
        </>
      )}
      {showForm && (
        <form onSubmit={submit} className="space-y-5">
          {status !== 'NOT_SUBMITTED' && <Notice tone="warn">{t('kyc.changeWarning')}</Notice>}
          <p className="text-lg text-slate-800">{t('kyc.intro')}</p>

          <Field label={t('kyc.pan')} hint={t('kyc.panHint')} error={errors.pan}>
            <TextInput autoCapitalize="characters" autoComplete="off" maxLength={10} className="uppercase tracking-wider" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          </Field>
          <Field label={t('kyc.panName')} hint={t('kyc.panNameHint')}>
            <TextInput autoCapitalize="characters" autoComplete="off" value={panName} onChange={(e) => setPanName(e.target.value)} onBlur={() => { if (!holder) setHolder(panName); }} />
          </Field>
          <Field label={t('kyc.bankAccount')} error={errors.bank}>
            <TextInput inputMode="numeric" autoComplete="off" maxLength={20} value={bankAccount} onChange={(e) => setBankAccount(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label={t('kyc.ifsc')} hint={t('kyc.ifscHint')} error={errors.ifsc}>
            <TextInput autoCapitalize="characters" autoComplete="off" maxLength={11} className="uppercase tracking-wider" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          </Field>
          <Field label={t('kyc.holder')} hint={t('kyc.holderHint')}>
            <TextInput autoCapitalize="characters" autoComplete="off" value={holder} onChange={(e) => setHolder(e.target.value)} />
          </Field>
          <Field label={t('kyc.pin')} error={errors.pin} hint={pinPlace?.known ? t('kyc.pinPlace', { district: pinPlace.district ?? '', state: pinPlace.state ?? '' }) : undefined}>
            <TextInput inputMode="numeric" autoComplete="postal-code" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          </Field>
          {pinPlace && !pinPlace.known && !gps && <Notice tone="warn">{t('kyc.pinUnknown')}</Notice>}

          <Panel className="space-y-3">
            <p className="font-bold">{t('kyc.locationTitle')}</p>
            <p className="text-slate-800">{t('kyc.locationBody')}</p>
            {gps
              ? <Notice tone="success">{t('kyc.locationSaved')}</Notice>
              : <BigButton variant="secondary" icon={LocationIcon} disabled={gpsState === 'finding'} onClick={findLocation}>{gpsState === 'finding' ? t('common.wait') : t('kyc.locationAction')}</BigButton>}
            {gpsState === 'denied' && <Notice tone="error">{t('gps.denied')}</Notice>}
            {gpsState === 'failed' && <Notice tone="error">{t('gps.failed')}</Notice>}
          </Panel>

          <fieldset>
            <legend className="mb-1 font-bold">{t('kyc.sellerType')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {[false, true].map((fpo) => (
                <button key={String(fpo)} type="button" aria-pressed={isFpo === fpo} onClick={() => setIsFpo(fpo)} className={cn('min-h-14 rounded-xl border-2 border-slate-800 px-2 font-bold', isFpo === fpo ? 'bg-emerald-800 text-white' : 'bg-white text-slate-950')}>{fpo ? t('kyc.typeFpo') : t('kyc.typeIndividual')}</button>
              ))}
            </div>
          </fieldset>
          {isFpo && <Field label={t('kyc.fpoName')}><TextInput value={fpoName} onChange={(e) => setFpoName(e.target.value)} /></Field>}

          <ErrorNotice error={error} />
          <BigButton type="submit" icon={CheckIcon} disabled={!complete || busy}>{busy ? t('common.wait') : t('kyc.submit')}</BigButton>
          {status !== 'NOT_SUBMITTED' && <BigButton variant="secondary" onClick={() => setEditing(false)}>{t('common.cancel')}</BigButton>}
        </form>
      )}
    </div>
  );
}
