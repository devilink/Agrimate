'use client';
import type { ListingView } from '@agrimate/api-client';
import { formatIST, formatINR } from '@agrimate/shared';
import { useState } from 'react';
import { CheckIcon, PlusIcon, SproutIcon, TrashIcon } from '@/components/icons';
import { QueueList } from '@/components/queue-list';
import { BigButton, BigLink, ErrorNotice, ListSkeleton, Notice, PageTitle, Panel, Pill, Row } from '@/components/ui';
import { api } from '@/lib/api';
import { qtyText, pricePerKg } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMasters } from '@/lib/masters';
import { useApi } from '@/lib/use-api';

const TONE: Record<string, 'green' | 'blue' | 'slate'> = { LISTED: 'green', MATCHED: 'blue', WITHDRAWN: 'slate' };

export default function ListingsPage() {
  const { t } = useI18n();
  const { commodityName, gradeName } = useMasters();
  const { data, loading, error, reload } = useApi<ListingView[]>('/listings?mine=true');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  async function withdraw(id: string) {
    setBusy(id); setActionError(null);
    try { await api.post(`/listings/${id}/withdraw`); await reload(); } catch (e) { setActionError(e); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <PageTitle>{t('listings.title')}</PageTitle>
      <BigLink href="/listings/new" icon={PlusIcon}>{t('listings.new')}</BigLink>
      <BigLink href="/organic" variant="secondary" icon={CheckIcon}>{t('listings.organicLink')}</BigLink>
      <QueueList kinds={['LISTING']} />
      <ErrorNotice error={actionError ?? (!data ? error : null)} />
      {loading ? <ListSkeleton /> : data?.length === 0 ? (
        <Notice tone="info" title={t('listings.emptyTitle')}>{t('listings.emptyBody')}</Notice>
      ) : data?.map((l) => (
        <Panel key={l.id}>
          <div className="mb-1 flex items-start gap-2">
            <SproutIcon className="shrink-0 text-emerald-900" />
            <div className="flex-1">
              <p className="text-xl font-bold">{commodityName(l.commodity)}, {qtyText(l.quantityKg, t)}</p>
              <p className="text-slate-800">{gradeName(l.commodity.code, l.grade)}</p>
            </div>
            <Pill tone={TONE[l.state] ?? 'slate'}>{t(`listings.state.${l.state}`)}</Pill>
          </div>
          <Row label={t('listings.price')}>{pricePerKg(l.pricePaisePerKg, t)}</Row>
          <Row label={t('listings.total')}>{formatINR(l.gmvPaise)}</Row>
          <Row label={t('listings.posted')}>{formatIST(l.createdAt)}</Row>
          {l.isOrganic && <p className="mt-1"><Pill tone="green">{t('common.organic')}</Pill></p>}
          {l.state === 'LISTED' && <BigButton variant="secondary" icon={TrashIcon} className="mt-3" disabled={busy === l.id} onClick={() => withdraw(l.id)}>{busy === l.id ? t('common.wait') : t('listings.withdraw')}</BigButton>}
        </Panel>
      ))}
    </div>
  );
}
