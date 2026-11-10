'use client';
import type { MeView } from '@agrimate/api-client';
import { formatINR, formatIST } from '@agrimate/shared';
import { useMemo, useState } from 'react';
import { CheckIcon, ShieldIcon, SproutIcon } from '@/components/icons';
import { BigButton, BigLink, ErrorNotice, Field, ListSkeleton, Notice, PageTitle, Panel, Row, SelectInput, TextInput } from '@/components/ui';
import { api, currentUserId } from '@/lib/api';
import { isNetworkError } from '@/lib/errors';
import { rupeesToPaise, tonnesToWholeKg } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMasters } from '@/lib/masters';
import { enqueue, flushQueue } from '@/lib/queue';
import { useApi } from '@/lib/use-api';
import { certIsUsable, type OrganicCert } from '@/lib/organic';

export default function NewListingPage() {
  const { t } = useI18n();
  const { commodities, loading, commodityName, gradeName, error: mastersError } = useMasters();
  const me = useApi<MeView>('/auth/me');
  const certs = useApi<OrganicCert[]>('/onboarding/organic-certs');
  const [commodityId, setCommodityId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [tonnes, setTonnes] = useState('');
  const [rupees, setRupees] = useState('');
  const [certId, setCertId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<'sent' | 'queued' | null>(null);

  const commodity = commodities?.find((c) => c.id === commodityId);
  const grade = commodity?.grades.find((g) => g.id === gradeId);
  const quantityKg = tonnesToWholeKg(tonnes);
  const pricePaise = rupeesToPaise(rupees);
  const qtyError = tonnes && (quantityKg === null || quantityKg < 100) ? t('listing.qtyInvalid') : null;
  const priceError = rupees && (pricePaise === null || BigInt(pricePaise) <= 0n) ? t('listing.priceInvalid') : null;
  const total = useMemo(() => (quantityKg && pricePaise && quantityKg >= 100 ? BigInt(quantityKg) * BigInt(pricePaise) : null), [quantityKg, pricePaise]);
  const kyc = me.data?.farmer?.kycStatus;
  const kycBlocked = kyc === 'NOT_SUBMITTED' || kyc === 'REJECTED' || kyc === 'PENDING';
  const complete = !!commodity && !!grade && !!total && total > 0n;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!complete || busy || !commodity || !grade || !quantityKg || !pricePaise) return;
    const body = { commodityId: commodity.id, gradeId: grade.id, quantityKg, pricePaisePerKg: pricePaise, ...(certId ? { organicCertId: certId } : {}) };
    const owner = currentUserId() ?? '';
    const queue = (maybeSent: boolean) => {
      enqueue({ kind: 'LISTING', ownerId: owner, method: 'POST', path: '/listings', body, label: t('listing.queueLabel', { crop: commodityName(commodity), qty: tonnes }), attempts: maybeSent ? 1 : 0 });
      setOutcome('queued');
    };
    setError(null);
    if (!navigator.onLine) { queue(false); return; }
    setBusy(true);
    try {
      await api.post('/listings', body);
      setOutcome('sent');
    } catch (err) {
      if (isNetworkError(err)) { queue(true); void flushQueue(owner); } else setError(err);
    } finally { setBusy(false); }
  }

  if (outcome) {
    return (
      <div className="space-y-4">
        <PageTitle>{t('listing.title')}</PageTitle>
        {outcome === 'sent' ? <Notice tone="success" title={t('listing.sentTitle')}>{t('listing.sentBody')}</Notice> : <Notice tone="wait" title={t('listing.queuedTitle')}>{t('listing.queuedBody')}</Notice>}
        <BigLink href="/listings" icon={SproutIcon}>{t('listing.seeMine')}</BigLink>
        <BigButton variant="secondary" onClick={() => { setOutcome(null); setTonnes(''); setRupees(''); setCertId(''); }}>{t('listing.another')}</BigButton>
      </div>
    );
  }
  if (loading) return <ListSkeleton rows={2} />;

  return (
    <div className="space-y-4">
      <PageTitle back="/listings">{t('listing.title')}</PageTitle>
      {kycBlocked && <Notice tone="warn" title={t('listing.kycTitle')}><p className="mb-2">{t('listing.kycBody')}</p><BigLink href="/kyc" icon={ShieldIcon}>{t('home.kycAction')}</BigLink></Notice>}
      <ErrorNotice error={!commodities ? mastersError : null} />
      <form onSubmit={submit} className="space-y-5">
        <Field label={t('listing.crop')}>
          <SelectInput value={commodityId} onChange={(e) => { setCommodityId(e.target.value); setGradeId(''); }}>
            <option value="">{t('common.choose')}</option>
            {commodities?.map((c) => <option key={c.id} value={c.id}>{commodityName(c)}</option>)}
          </SelectInput>
        </Field>
        <Field label={t('listing.grade')}>
          <SelectInput value={gradeId} disabled={!commodity} onChange={(e) => setGradeId(e.target.value)}>
            <option value="">{t('common.choose')}</option>
            {commodity?.grades.map((g) => <option key={g.id} value={g.id}>{gradeName(commodity.code, g)}</option>)}
          </SelectInput>
        </Field>
        <Field label={t('listing.tonnes')} hint={t('listing.tonnesHint')} error={qtyError}>
          <TextInput inputMode="decimal" value={tonnes} onChange={(e) => setTonnes(e.target.value.replace(/[^\d.]/g, ''))} />
        </Field>
        <Field label={t('listing.price')} error={priceError}>
          <TextInput inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value.replace(/[^\d.]/g, ''))} />
        </Field>
        <Field label={t('listing.organic')} hint={t('listing.organicHint')}>
          <SelectInput value={certId} onChange={(e) => setCertId(e.target.value)}>
            <option value="">{t('listing.notOrganic')}</option>
            {certs.data?.map((c) => {
              const usable = certIsUsable(c);
              return <option key={c.id} value={c.id} disabled={!usable}>{c.certifier} · {usable ? t('listing.certUntil', { date: formatIST(c.expiresAt) }) : t(`organic.state.${new Date(c.expiresAt) <= new Date() ? 'EXPIRED' : c.status}`)}</option>;
            })}
          </SelectInput>
        </Field>
        <BigLink href="/organic" variant="secondary">{t('listing.addCert')}</BigLink>
        {total !== null && <Panel><Row label={t('listing.total')} strong>{formatINR(total)}</Row></Panel>}
        <ErrorNotice error={error} />
        <BigButton type="submit" icon={CheckIcon} disabled={!complete || busy || kycBlocked}>{busy ? t('common.wait') : t('listing.submit')}</BigButton>
      </form>
    </div>
  );
}
