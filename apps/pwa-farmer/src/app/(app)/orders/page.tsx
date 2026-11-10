'use client';
import type { OrderListItem } from '@agrimate/api-client';
import { formatINR, formatIST } from '@agrimate/shared';
import Link from 'next/link';
import { ChevronIcon, ListIcon } from '@/components/icons';
import { BigLink, ErrorNotice, ListSkeleton, Notice, OrderStatePill, PageTitle, Panel } from '@/components/ui';
import { qtyText } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMasters } from '@/lib/masters';
import { useApi } from '@/lib/use-api';

export default function OrdersPage() {
  const { t } = useI18n();
  const { namesFromList } = useMasters();
  const { data, loading, error } = useApi<OrderListItem[]>('/orders');
  return (
    <div className="space-y-4">
      <PageTitle>{t('orders.title')}</PageTitle>
      <ErrorNotice error={!data ? error : null} />
      {loading ? <ListSkeleton /> : data?.length === 0 ? (
        <>
          <Notice tone="info" title={t('home.noOrdersTitle')}>{t('home.noOrdersBody')}</Notice>
          <BigLink href="/rfqs" icon={ListIcon}>{t('home.seeRequests')}</BigLink>
        </>
      ) : data?.map((o) => {
        const names = namesFromList(o.commodity, o.grade);
        return (
          <Link prefetch={false} key={o.id} href={`/orders/detail?id=${o.id}`} className="block">
            <Panel className="active:bg-slate-100">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xl font-bold">{names.commodity}, {qtyText(o.quantityKg, t)}</p>
                  <p className="text-slate-800">{names.grade} · {o.code}</p>
                  <div className="my-1"><OrderStatePill state={o.state} /></div>
                  {o.gmvPaise && <p className="text-lg font-bold">{formatINR(o.gmvPaise)}</p>}
                  <p className="text-slate-800">{formatIST(o.createdAt)}</p>
                </div>
                <ChevronIcon className="mt-1 shrink-0 text-slate-700" />
              </div>
            </Panel>
          </Link>
        );
      })}
    </div>
  );
}
