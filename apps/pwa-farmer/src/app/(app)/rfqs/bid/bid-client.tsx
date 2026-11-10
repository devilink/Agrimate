'use client';
import type { MeView, RfqView } from '@agrimate/api-client';
import { formatINR, formatIST } from '@agrimate/shared';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ListIcon, SendIcon, ShieldIcon } from '@/components/icons';
import { BigButton, BigLink, ErrorNotice, Field, ListSkeleton, Notice, PageTitle, Panel, Pill, Row, TextInput } from '@/components/ui';
import { api, currentUserId } from '@/lib/api';
import { isNetworkError } from '@/lib/errors';
import { paiseToRupees, pricePerKg, qtyText, rupeesToPaise } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMasters } from '@/lib/masters';
import { enqueue, flushQueue } from '@/lib/queue';
import { useApi } from '@/lib/use-api';

/** The API has no GET /rfqs/:id, so the request comes out of the feed, which is also what is saved for offline use. */
export function BidClient() {
  const { t } = useI18n();
  const id = useSearchParams().get('id');
  const { commodityName, gradeName } = useMasters();
  const { data, loading, error: loadError } = useApi<RfqView[]>('/rfqs');
  const me = useApi<MeView>('/auth/me');
  const rfq = data?.find((r) => r.id === id);
  const [rupees, setRupees] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<'sent' | 'queued' | null>(null);

  // Prefilled at the buyer's target, so that most farmers only need to press one button.
  const prefill = rfq?.myBid?.pricePaisePerKg ?? rfq?.targetPricePaisePerKg;
  useEffect(() => { if (prefill) setRupees(paiseToRupees(prefill)); }, [prefill]);

  if (loading) return <ListSkeleton rows={2} />;
  if (!rfq) {
    return (
      <div className="space-y-4">
        <PageTitle back="/rfqs">{t('bid.title')}</PageTitle>
        {loadError ? <ErrorNotice error={loadError} /> : <Notice tone="warn">{t('bid.closed')}</Notice>}
        <BigLink href="/rfqs" icon={ListIcon}>{t('bid.backToRequests')}</BigLink>
      </div>
    );
  }

  const paise = rupeesToPaise(rupees);
  const overTarget = paise !== null && BigInt(paise) > BigInt(rfq.targetPricePaisePerKg);
  const invalid = !!rupees && (paise === null || BigInt(paise) <= 0n);
  const canSubmit = paise !== null && BigInt(paise) > 0n && !overTarget;
  const crop = commodityName(rfq.commodity);
  const kyc = me.data?.farmer?.kycStatus;
  const kycBlocked = kyc === 'NOT_SUBMITTED' || kyc === 'REJECTED' || kyc === 'PENDING';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy || !rfq || !paise) return;
    const path = `/rfqs/${rfq.id}/bids`;
    const body = { quantityKg: rfq.quantityKg, pricePaisePerKg: paise };
    const owner = currentUserId() ?? '';
    // Safe to repeat: the API keeps one bid per farmer per request, and a repeat just updates it.
    const queue = () => {
      enqueue({ kind: 'BID', ownerId: owner, method: 'POST', path, body, label: t('bid.queueLabel', { crop, price: rupees }) });
      setOutcome('queued');
    };
    setError(null);
    if (!navigator.onLine) { queue(); return; }
    setBusy(true);
    try {
      await api.post(path, body);
      setOutcome('sent');
    } catch (err) {
      if (isNetworkError(err)) { queue(); void flushQueue(owner); } else setError(err);
    } finally { setBusy(false); }
  }

  if (outcome) {
    return (
      <div className="space-y-4">
        <PageTitle>{t('bid.title')}</PageTitle>
        {outcome === 'sent' ? <Notice tone="success" title={t('bid.sentTitle')}>{t('bid.sentBody')}</Notice> : <Notice tone="wait" title={t('bid.queuedTitle')}>{t('bid.queuedBody')}</Notice>}
        <BigLink href="/rfqs" icon={ListIcon}>{t('bid.backToRequests')}</BigLink>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageTitle back="/rfqs">{t('bid.title')}</PageTitle>
      {kycBlocked && <Notice tone="warn" title={t('listing.kycTitle')}><p className="mb-2">{t('listing.kycBody')}</p><BigLink href="/kyc" icon={ShieldIcon}>{t('home.kycAction')}</BigLink></Notice>}
      <Panel>
        <p className="text-xl font-bold">{crop}</p>
        <p className="mb-2 text-slate-800">{gradeName(rfq.commodity.code, rfq.grade)} · {rfq.buyerName}</p>
        {rfq.organicRequired && <p className="mb-2"><Pill tone="green">{t('rfqs.organicOnly')}</Pill></p>}
        <Row label={t('rfqs.target')}>{pricePerKg(rfq.targetPricePaisePerKg, t)}</Row>
        <Row label={t('rfqs.neededBy')}>{formatIST(rfq.neededBy)}</Row>
        <Row label={t('rfqs.deliverTo')}>{rfq.deliveryPin}</Row>
      </Panel>
      <form onSubmit={submit} className="space-y-5">
        <Field label={t('bid.quantity')} hint={t('bid.quantityHint')}>
          <TextInput readOnly disabled value={qtyText(rfq.quantityKg, t)} />
        </Field>
        <Field label={t('bid.price')} hint={t('bid.priceHint', { max: paiseToRupees(rfq.targetPricePaisePerKg) })} error={overTarget ? t('bid.overTarget', { max: paiseToRupees(rfq.targetPricePaisePerKg) }) : invalid ? t('listing.priceInvalid') : null}>
          <TextInput inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value.replace(/[^\d.]/g, ''))} />
        </Field>
        {canSubmit && paise && <Panel><Row label={t('bid.youGetBeforeFees')} strong>{formatINR(BigInt(paise) * BigInt(rfq.quantityKg))}</Row></Panel>}
        <ErrorNotice error={error} />
        <BigButton type="submit" icon={SendIcon} disabled={!canSubmit || busy || kycBlocked}>{busy ? t('common.wait') : t('bid.submit')}</BigButton>
      </form>
    </div>
  );
}
