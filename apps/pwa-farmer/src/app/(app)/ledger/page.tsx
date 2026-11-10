'use client';
import type { FarmerLedger, MeView } from '@agrimate/api-client';
import { formatINR, formatIST } from '@agrimate/shared';
import { ShieldIcon } from '@/components/icons';
import { BigLink, ErrorNotice, ListSkeleton, Notice, PageTitle, Panel, Pill, SectionTitle } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useApi } from '@/lib/use-api';

const PAYOUT_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = { PROCESSED: 'green', PENDING: 'amber', BLOCKED: 'red', FAILED: 'red' };

export default function LedgerPage() {
  const { t, has } = useI18n();
  const { data, loading, error } = useApi<FarmerLedger>('/ledger/me');
  const me = useApi<MeView>('/auth/me');

  /** Ledger postings are from the platform's books: a credit to what it owes the farmer is negative there, so flip the sign. */
  const forFarmer = (amount: string) => -BigInt(amount);
  /** The API's only automatic block reason is the bank-name check, in English. Anything else is shown as sent. */
  const blockedReason = (note: string | null) => (!note || note.startsWith('Bank-holder name') ? t('ledger.blockedBankName') : note);

  if (loading) return <ListSkeleton />;
  if (!data) return <div className="space-y-4"><PageTitle>{t('ledger.title')}</PageTitle><ErrorNotice error={error} /></div>;

  const negative = BigInt(data.negativeBalancePaise) > 0n;
  const anyBlocked = data.payouts.some((p) => p.status === 'BLOCKED');
  const payoutsOff = me.data?.farmer && !me.data.farmer.payoutsEnabled;

  return (
    <div className="space-y-4">
      <PageTitle>{t('ledger.title')}</PageTitle>

      <Panel>
        <p className="text-slate-800">{t('ledger.payable')}</p>
        <p className="text-3xl font-extrabold tabular-nums">{formatINR(data.payablePaise)}</p>
      </Panel>

      {negative && (
        <Notice tone="error" title={t('home.negativeTitle', { amount: formatINR(data.negativeBalancePaise) })}>
          <p className="mb-2">{t('ledger.negativeWhat')}</p>
          <p>{t('ledger.negativeHow')}</p>
        </Notice>
      )}

      {(anyBlocked || payoutsOff) && (
        <Notice tone="warn" title={t('ledger.blockedTitle')}>
          <p className="mb-2">{t('ledger.blockedBody')}</p>
          <BigLink href="/kyc" variant="secondary" icon={ShieldIcon}>{t('home.kycSee')}</BigLink>
        </Notice>
      )}

      <SectionTitle>{t('ledger.payouts')}</SectionTitle>
      {data.payouts.length === 0 && <Notice tone="info">{t('ledger.noPayouts')}</Notice>}
      {data.payouts.map((p) => (
        <Panel key={p.id}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-2xl font-extrabold tabular-nums">{formatINR(p.amountPaise)}</p>
            <Pill tone={PAYOUT_TONE[p.status] ?? 'slate'}>{has(`payout.${p.status}`) ? t(`payout.${p.status}`) : p.status}</Pill>
          </div>
          <p className="text-slate-800">{p.orderCode} · {formatIST(p.createdAt)}</p>
          {p.status === 'BLOCKED' && <Notice tone="error" className="mt-2" title={t('ledger.whyBlocked')}>{blockedReason(p.statusNote)}</Notice>}
          {p.status === 'FAILED' && <Notice tone="error" className="mt-2">{t('ledger.payoutFailed')}</Notice>}
        </Panel>
      ))}

      {data.entries.length > 0 && (
        <>
          <SectionTitle>{t('ledger.history')}</SectionTitle>
          <Panel>
            <ul>
              {data.entries.map((e) => {
                const amount = forFarmer(e.amountPaise);
                return (
                  <li key={e.id} className="flex items-baseline justify-between gap-3 border-b border-slate-300 py-2 last:border-b-0">
                    <span><span className="block font-semibold">{has(`journal.${e.type}`) ? t(`journal.${e.type}`) : t('journal.OTHER')}</span><span className="text-slate-800">{formatIST(e.createdAt)}</span></span>
                    <span className={`shrink-0 font-bold tabular-nums ${amount < 0n ? 'text-red-800' : 'text-emerald-900'}`}>{amount > 0n ? '+' : ''}{formatINR(amount)}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}
