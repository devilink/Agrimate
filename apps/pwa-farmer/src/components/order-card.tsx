'use client';
import type { FarmerOrder, OrderListItem } from '@agrimate/api-client';
import { useI18n } from '@/lib/i18n';
import { useMasters } from '@/lib/masters';
import { nextStep, type NextStep } from '@/lib/order-logic';
import { qtyText } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { ChevronIcon } from './icons';
import { BigCountdown, BigLink, Notice, OrderStatePill, Panel } from './ui';
import { Skeleton } from '@agrimate/ui';
import Link from 'next/link';

const NOTICE_TONE: Record<NextStep['tone'], 'info' | 'wait' | 'success' | 'error'> = { act: 'info', wait: 'wait', done: 'success', alert: 'error' };

export function NextStepBox({ order, primary = true }: { order: FarmerOrder; primary?: boolean }) {
  const { t } = useI18n();
  const step = nextStep(order);
  return (
    <div className="space-y-3">
      <Notice tone={NOTICE_TONE[step.tone]} title={t('next.title')}>{t(step.text, step.vars)}</Notice>
      {step.href && step.action && <BigLink href={step.href} variant={primary ? 'primary' : 'secondary'}>{t(step.action)}</BigLink>}
    </div>
  );
}

/** Home card. The order list omits selfCertRequired, so working out the next step needs the order itself. */
export function ActiveOrderCard({ item, primary }: { item: OrderListItem; primary: boolean }) {
  const { t } = useI18n();
  const { namesFromList } = useMasters();
  const { data: order } = useApi<FarmerOrder>(`/orders/${item.id}`);
  const names = namesFromList(item.commodity, item.grade);
  return (
    <Panel className="space-y-3">
      <Link prefetch={false} href={`/orders/detail?id=${item.id}`} className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xl font-bold text-slate-950">{names.commodity}, {qtyText(item.quantityKg, t)}</p>
          <p className="text-slate-800">{names.grade} · {item.code}</p>
          <div className="mt-1"><OrderStatePill state={item.state} /></div>
        </div>
        <ChevronIcon className="mt-1 shrink-0 text-slate-700" />
      </Link>
      <BigCountdown to={item.slaDeadlineAt} />
      {order ? <NextStepBox order={order} primary={primary} /> : <Skeleton className="h-20 w-full rounded-xl" />}
    </Panel>
  );
}
