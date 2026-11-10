'use client';
import type { RfqView } from '@agrimate/api-client';
import { formatIST } from '@agrimate/shared';
import { SendIcon } from '@/components/icons';
import { QueueList } from '@/components/queue-list';
import { BigLink, ErrorNotice, ListSkeleton, Notice, PageTitle, Panel, Pill, Row } from '@/components/ui';
import { pricePerKg, qtyText } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMasters } from '@/lib/masters';
import { useApi } from '@/lib/use-api';

export default function RfqFeedPage() {
  const { t } = useI18n();
  const { commodityName, gradeName } = useMasters();
  const { data, loading, error } = useApi<RfqView[]>('/rfqs');
  return (
    <div className="space-y-4">
      <PageTitle>{t('rfqs.title')}</PageTitle>
      <p className="text-lg text-slate-800">{t('rfqs.intro')}</p>
      <QueueList kinds={['BID']} />
      <ErrorNotice error={!data ? error : null} />
      {loading ? <ListSkeleton /> : data?.length === 0 ? <Notice tone="info" title={t('rfqs.emptyTitle')}>{t('rfqs.emptyBody')}</Notice> : data?.map((r, i) => (
        <Panel key={r.id}>
          <p className="text-xl font-bold">{commodityName(r.commodity)}, {qtyText(r.quantityKg, t)}</p>
          <p className="text-slate-800">{gradeName(r.commodity.code, r.grade)} · {r.buyerName}</p>
          {r.organicRequired && <p className="mt-1"><Pill tone="green">{t('rfqs.organicOnly')}</Pill></p>}
          <div className="my-2">
            <Row label={t('rfqs.target')}>{pricePerKg(r.targetPricePaisePerKg, t)}</Row>
            <Row label={t('rfqs.neededBy')}>{formatIST(r.neededBy)}</Row>
            <Row label={t('rfqs.deliverTo')}>{r.deliveryPin}</Row>
            {r.myBid && <Row label={t('rfqs.yourBid')}>{pricePerKg(r.myBid.pricePaisePerKg, t)}</Row>}
          </div>
          <BigLink href={`/rfqs/bid?id=${r.id}`} icon={SendIcon} variant={i === 0 && !r.myBid ? 'primary' : 'secondary'}>{r.myBid ? t('rfqs.changeBid') : t('rfqs.bid')}</BigLink>
        </Panel>
      ))}
    </div>
  );
}
