'use client';
import type { FarmerLedger, MeView, OrderListItem } from '@agrimate/api-client';
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
