'use client';
import type { FarmerOrder, OrderEventView, Party, Tranche } from '@agrimate/api-client';
import { formatINR, formatIST, type GradeParameter } from '@agrimate/shared';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { CameraIcon, CheckIcon, ClockIcon, PhoneIcon, TruckIcon, VideoIcon } from '@/components/icons';
import { NextStepBox } from '@/components/order-card';
import { BigCountdown, BigLink, ErrorNotice, ListSkeleton, Notice, OrderStatePill, PageTitle, Panel, Pill, Row, SectionTitle, cn } from '@/components/ui';
import { api } from '@/lib/api';
import { pricePerKg, qtyText } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMasters } from '@/lib/masters';
import { buildTimeline } from '@/lib/order-logic';
import { useApi } from '@/lib/use-api';

function Timeline({ order, events }: { order: FarmerOrder; events: OrderEventView[] | undefined }) {
  const { t } = useI18n();
  const steps = buildTimeline(order, events);
  return (
    <ol>
      {steps.map((s, i) => (
        <li key={s.key} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2', s.done ? 'border-emerald-800 bg-emerald-800 text-white' : s.current ? 'border-amber-700 bg-amber-200 text-amber-950' : 'border-slate-400 bg-white text-slate-500')}>
              {s.done ? <CheckIcon size={20} /> : s.current ? <ClockIcon size={20} /> : null}
            </span>
            {i < steps.length - 1 && <span className={cn('min-h-5 w-1 flex-1', s.done ? 'bg-emerald-800' : 'bg-slate-300')} />}
          </div>
          <div className="pb-3">
            <p className={cn('font-bold', !s.done && !s.current && 'text-slate-600')}>{t(`timeline.${s.key}`)}</p>
            {s.at && <p className="text-slate-800">{formatIST(s.at)}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function TrancheRow({ tr }: { tr: Tranche }) {
  const { t } = useI18n();
  const tone = tr.status === 'PAID' ? 'green' : tr.status === 'PARTIAL' ? 'amber' : 'slate';
  return (
    <div className="border-b border-slate-300 py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold">{t(`tranche.${tr.kind}`)}</p>
        <Pill tone={tone}>{t(`trancheStatus.${tr.status}`)}</Pill>
      </div>
      <p className="tabular-nums text-slate-800">{t('tranche.received', { received: formatINR(tr.receivedPaise), expected: formatINR(tr.expectedPaise) })}</p>
      {tr.paidAt && <p className="text-slate-800">{formatIST(tr.paidAt)}</p>}
    </div>
  );
}

function BuyerContact({ buyer }: { buyer: Party }) {
  const { t } = useI18n();
  return (
    <Panel>
      <SectionTitle>{t('order.buyer')}</SectionTitle>
      <p className="mb-2 text-lg font-bold">{buyer.name}</p>
      {buyer.phoneUnlocked
        ? <a href={`tel:${buyer.phone}`} className="flex min-h-14 items-center justify-center gap-3 rounded-xl border-2 border-slate-800 px-4 text-lg font-bold text-slate-950"><PhoneIcon size={24} />{buyer.phone}</a>
        : <p className="text-slate-800">{t('order.phoneLocked', { phone: buyer.phone })}</p>}
    </Panel>
  );
}

function InspectionReport({ order }: { order: FarmerOrder }) {
  const { t, has } = useI18n();
  const [photos, setPhotos] = useState<string[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const i = order.inspection;
  if (!i) return null;
  const params = (order.grade.parameters ?? []) as GradeParameter[];
  const label = (p: GradeParameter) => (has(`param.${p.key}`) ? t(`param.${p.key}`) : p.label);
  const limit = (p: GradeParameter) => (p.max !== undefined && p.min !== undefined ? `${p.min}-${p.max} ${p.unit}` : p.max !== undefined ? t('inspection.max', { v: `${p.max} ${p.unit}` }) : p.min !== undefined ? t('inspection.min', { v: `${p.min} ${p.unit}` }) : '');

  async function loadPhotos() {
    setError(null);
    try {
      // Signed links are fetched only on request: photos are large and many farmers are on prepaid data.
      setPhotos(await Promise.all((i?.photoFileIds ?? []).map(async (id) => (await api.get<{ url: string }>(`/files/${id}/download-url`)).url)));
    } catch (e) { setError(e); }
  }

  return (
    <Panel>
      <SectionTitle>{t('inspection.title')}</SectionTitle>
      <Row label={t('inspection.status')}>{has(`inspection.state.${i.status}`) ? t(`inspection.state.${i.status}`) : i.status}</Row>
      <Row label={t('inspection.scheduled')}>{formatIST(i.scheduledFor)}</Row>
      {i.inspectedAt && <Row label={t('inspection.done')}>{formatIST(i.inspectedAt)}</Row>}
      {i.scaleWeightKg !== null && <Row label={t('inspection.weight')}>{qtyText(i.scaleWeightKg, t)}</Row>}
      {i.readings && (
        <ul className="mt-2 space-y-2">
          {params.map((p) => {
            const value = i.readings?.[p.key];
            const bad = i.gradeCheck?.outOfSpec.includes(p.key);
            return (
              <li key={p.key} className={cn('rounded-lg border-2 p-2', bad ? 'border-red-700 bg-red-50' : 'border-emerald-800 bg-emerald-50')}>
                <div className="flex justify-between gap-2 font-bold"><span>{label(p)}</span><span className="tabular-nums">{value ?? '-'} {p.unit}</span></div>
                <p className="flex items-center justify-between gap-2 text-slate-900"><span>{limit(p)}</span><span className="font-bold">{bad ? t('inspection.outOfSpec') : t('inspection.inSpec')}</span></p>
              </li>
            );
          })}
        </ul>
      )}
      {i.gradeCheck && !i.gradeCheck.ok && <Notice tone="error" className="mt-2">{t('next.inspectionFailed')}</Notice>}
      {i.deviationAcceptedAt && <Notice tone="success" className="mt-2">{t('inspection.deviationAccepted')}</Notice>}
      {i.photoFileIds.length > 0 && !photos && <button type="button" onClick={loadPhotos} className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-800 font-bold"><CameraIcon />{t('inspection.seePhotos', { n: i.photoFileIds.length })}</button>}
      <ErrorNotice error={error} className="mt-2" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photos && <div className="mt-3 grid grid-cols-2 gap-2">{photos.map((src) => <img key={src} src={src} alt={t('inspection.photoAlt')} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />)}</div>}
    </Panel>
  );
}

function SettlementPreview({ order }: { order: FarmerOrder }) {
  const { t } = useI18n();
  const s = order.settlementPreview;
  const refunded = BigInt(order.buyerRefundPaise) > 0n;
  const waived = order.inspection?.status === 'WAIVED_SELF_CERT';
  return (
    <Panel>
      <SectionTitle>{order.state === 'SETTLED' ? t('settlement.finalTitle') : t('settlement.title')}</SectionTitle>
      <Row label={t('settlement.gmv', { qty: qtyText(order.quantityKg, t), price: pricePerKg(order.pricePaisePerKg, t) })}>{formatINR(order.gmvPaise)}</Row>
      {refunded && <Row label={t('settlement.refund')}>- {formatINR(order.buyerRefundPaise)}</Row>}
      <Row label={t('settlement.commission', { pct: order.commissionBps / 100 })}>- {formatINR(s.commission)}</Row>
      <Row label={waived ? t('settlement.feeWaived') : t('settlement.fee')}>- {formatINR(s.inspectionFee)}</Row>
      {BigInt(s.negativeOffset) > 0n && <Row label={t('settlement.recovered')}>- {formatINR(s.negativeOffset)}</Row>}
      <Row label={t('settlement.payout')} strong>{formatINR(s.farmerPayout)}</Row>
      {BigInt(s.negativeRemaining) > 0n && <p className="mt-2 text-slate-800">{t('settlement.remaining', { amount: formatINR(s.negativeRemaining) })}</p>}
      {order.state !== 'SETTLED' && <p className="mt-2 text-slate-800">{t('settlement.note')}</p>}
    </Panel>
  );
}

export function DetailClient() {
  const { t, has } = useI18n();
  const id = useSearchParams().get('id');
  const { commodityName, gradeName } = useMasters();
  const { data: order, loading, error } = useApi<FarmerOrder>(id ? `/orders/${id}` : null);
  const { data: events } = useApi<OrderEventView[]>(id ? `/orders/${id}/events` : null);

  if (!id) return <Notice tone="warn">{t('error.notFound')}</Notice>;
  if (loading) return <ListSkeleton />;
  if (!order) return <div className="space-y-4"><PageTitle back="/orders">{t('orders.title')}</PageTitle><ErrorNotice error={error} /></div>;

  const allowsSelfCert = order.selfCertRequired;
  const canDispatch = ['INSPECTED', 'SELF_CERTIFIED', 'IN_TRANSIT'].includes(order.state);

  return (
    <div className="space-y-4">
      <PageTitle back="/orders">{commodityName(order.commodity)}, {qtyText(order.quantityKg, t)}</PageTitle>
      <p className="-mt-3 text-slate-800">{gradeName(order.commodity.code, order.grade)} · {order.code}</p>
      <div className="flex flex-wrap items-center gap-2"><OrderStatePill state={order.state} />{order.isOrganic && <Pill tone="green">{t('common.organic')}</Pill>}{order.selfCertifiedBadge && <Pill tone="amber">{t('order.selfCertifiedBadge')}</Pill>}</div>
      <BigCountdown to={order.slaDeadlineAt} />
      <NextStepBox order={order} />
      {allowsSelfCert && <BigLink href={`/orders/self-cert?id=${order.id}`} variant="secondary" icon={VideoIcon}>{t('order.selfCertLink')}</BigLink>}
      {canDispatch && <BigLink href={`/orders/dispatch?id=${order.id}`} variant="secondary" icon={CameraIcon}>{t('order.dispatchLink', { n: order.dispatchPhotos.length })}</BigLink>}

      <Panel>
        <SectionTitle>{t('order.payments')}</SectionTitle>
        <p className="mb-1 text-slate-800">{t('order.paymentsIntro')}</p>
        {order.tranches.length ? order.tranches.map((tr) => <TrancheRow key={tr.kind} tr={tr} />) : <p>{t('order.paymentsNone')}</p>}
      </Panel>

      <BuyerContact buyer={order.buyer} />

      <Panel>
        <SectionTitle>{t('order.progress')}</SectionTitle>
        <Timeline order={order} events={events} />
      </Panel>

      {order.trip && (
        <Panel>
          <SectionTitle><span className="inline-flex items-center gap-2"><TruckIcon />{t('order.transport')}</span></SectionTitle>
          <Row label={t('order.tripStatus')}>{has(`tripStatus.${order.trip.status}`) ? t(`tripStatus.${order.trip.status}`) : order.trip.status}</Row>
          {order.trip.vehicleRegNo && <Row label={t('order.vehicle')}>{order.trip.vehicleRegNo}</Row>}
          <Row label={t('order.distance')}>{t('unit.km', { n: Math.round(order.trip.distanceKm) })}</Row>
        </Panel>
      )}

      <Panel>
        <SectionTitle>{t('order.places')}</SectionTitle>
        <Row label={t('order.pickupPin')}>{order.pickupPin}</Row>
        <Row label={t('order.deliveryPin')}>{order.deliveryPin}</Row>
        {order.dispatchedWeightKg !== null && <Row label={t('order.dispatchedWeight')}>{qtyText(order.dispatchedWeightKg, t)}</Row>}
        {order.receivedWeightKg !== null && <Row label={t('order.receivedWeight')}>{qtyText(order.receivedWeightKg, t)}</Row>}
      </Panel>

      <SettlementPreview order={order} />
      <InspectionReport order={order} />
    </div>
  );
}
