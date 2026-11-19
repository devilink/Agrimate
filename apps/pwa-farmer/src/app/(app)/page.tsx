'use client';
import type { AnalyticsSummary, FarmerLedger, MeView, OrderListItem } from '@agrimate/api-client';
import { compactINR, Dial, Journey } from '@agrimate/ui/viz';
import { formatINR } from '@agrimate/shared';
import { ListIcon, ShieldIcon, SproutIcon, WalletIcon } from '@/components/icons';
import { ActiveOrderCard } from '@/components/order-card';
import { QueueList } from '@/components/queue-list';
import { BigLink, ErrorNotice, ListSkeleton, Notice, PageTitle } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { ACTIVE_STATES } from '@/lib/order-logic';
import { useApi } from '@/lib/use-api';

export default function HomePage() {
  const { t } = useI18n();
  const me = useApi<MeView>('/auth/me');
  const orders = useApi<OrderListItem[]>('/orders');
  const ledger = useApi<FarmerLedger>('/ledger/me');
  const summary = useApi<AnalyticsSummary>('/analytics/summary?days=90');
  const s = summary.data;
  const words = { good: t('dash.good'), warning: t('dash.watch'), critical: t('dash.act'), none: t('dash.none') };
  const STAGE_TEXT: Record<string, string> = { funding: t('dash.funding'), logistics: t('dash.logistics'), quality: t('dash.qualityStage'), ready: t('dash.ready'), transit: t('dash.transit'), window: t('dash.window'), disputed: t('dash.disputed') };
  const stages = (s?.pipeline ?? []).filter((p) => p.count > 0).map((p) => ({ key: p.key, label: STAGE_TEXT[p.key] ?? p.label, count: p.count, alert: p.key === 'disputed', href: '/orders' }));

  const active = (orders.data ?? [])
    .filter((o) => ACTIVE_STATES.includes(o.state))
    .sort((a, b) => (a.slaDeadlineAt ?? '9').localeCompare(b.slaDeadlineAt ?? '9'));
  const kyc = me.data?.farmer?.kycStatus;
  const negative = ledger.data && BigInt(ledger.data.negativeBalancePaise) > 0n ? ledger.data.negativeBalancePaise : null;

  return (
    <div className="space-y-4">
      <PageTitle>{me.data ? t('home.hello', { name: me.data.name }) : t('home.title')}</PageTitle>

      {kyc === 'NOT_SUBMITTED' && <Notice tone="warn" title={t('home.kycNeededTitle')}><p className="mb-2">{t('home.kycNeededBody')}</p><BigLink href="/kyc" icon={ShieldIcon}>{t('home.kycAction')}</BigLink></Notice>}
      {kyc === 'REJECTED' && <Notice tone="error" title={t('home.kycRejectedTitle')}><p className="mb-2">{t('home.kycRejectedBody')}</p><BigLink href="/kyc" icon={ShieldIcon}>{t('home.kycAction')}</BigLink></Notice>}
      {kyc === 'MANUAL_REVIEW' && <Notice tone="warn" title={t('home.kycReviewTitle')}><p className="mb-2">{t('home.kycReviewBody')}</p><BigLink href="/kyc" variant="secondary" icon={ShieldIcon}>{t('home.kycSee')}</BigLink></Notice>}

      {negative && (
        <Notice tone="error" title={t('home.negativeTitle', { amount: formatINR(negative) })}>
          <p className="mb-2">{t('home.negativeBody')}</p>
          <BigLink href="/ledger" variant="secondary" icon={WalletIcon}>{t('home.negativeAction')}</BigLink>
        </Notice>
      )}

      {s && (
        <section className="space-y-3">
          <div className="rounded-2xl bg-[linear-gradient(115deg,#0f766e_0%,#064e3b_55%,#022c22_100%)] p-4 text-white">
            <p className="text-sm text-emerald-100">{t('dash.received')} · {t('dash.period')}</p>
            <div className="mt-0.5 flex items-center justify-between gap-3">
              <p className="text-4xl font-bold tracking-tight">{compactINR(s.kpis.receivedPaise)}</p>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-white/15 pt-3">
              <div><dd className="text-lg font-bold">{compactINR(s.kpis.escrowPaise)}</dd><dt className="text-xs text-emerald-100">{t('dash.escrow')}</dt></div>
              <div><dd className="text-lg font-bold">{s.kpis.activeOrders}</dd><dt className="text-xs text-emerald-100">{t('dash.live')}</dt></div>
              <div><dd className="text-lg font-bold">{Math.round(s.kpis.quantityKg / 1000)}</dd><dt className="text-xs text-emerald-100">{t('dash.tonnes')}</dt></div>
            </dl>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Dial size={132} label={t('dash.quality')} value={s.dials.qualityPass.value} good={90} warn={75} words={words} />
            <Dial size={132} label={t('dash.paid')} value={s.dials.payoutSuccess?.value ?? null} good={99} warn={95} words={words} href="/ledger" />
          </div>
          {stages.length > 0 && <div><h2 className="mb-2 text-lg font-bold text-slate-950">{t('dash.where')}</h2><Journey stages={stages} /></div>}
        </section>
      )}

      <QueueList kinds={['LISTING', 'BID']} />
      <ErrorNotice error={!orders.data ? orders.error : null} />

      {orders.loading ? <ListSkeleton /> : active.length ? (
        <>
          <h2 className="text-lg font-bold text-slate-950">{t('home.activeOrders', { n: active.length })}</h2>
          {active.map((o, i) => <ActiveOrderCard key={o.id} item={o} primary={i === 0} />)}
        </>
      ) : orders.data ? (
        <div className="space-y-3">
          <Notice tone="info" title={t('home.noOrdersTitle')}>{t('home.noOrdersBody')}</Notice>
          <BigLink href="/rfqs" icon={ListIcon}>{t('home.seeRequests')}</BigLink>
          <BigLink href="/listings/new" variant="secondary" icon={SproutIcon}>{t('home.sellCrop')}</BigLink>
        </div>
      ) : null}
    </div>
  );
}
