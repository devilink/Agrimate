import { cx } from '@/components/ui';
import { IconCheck, IconCheckCircle, IconShield, IconSprout, IconX } from '@/components/icons';
import { CHECKLIST, TRUSTED_MIN_TRADES, trustLevel } from '@/lib/trust';
import type { Party } from '@/lib/types';

type P = Pick<Party, 'verified' | 'kyc_verified' | 'gst_verified' | 'bank_verified' | 'is_fpo' | 'completed_trades'>;

/** Compact badges for cards and headers: Trusted / Verified, plus FPO. Nothing for unverified parties. */
export function TrustBadges({ party, className }: { party: P | undefined; className?: string }) {
  if (!party) return null;
  const level = trustLevel(party);
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-1', className)}>
      {level === 'trusted' && (
        <span title={`Checklist complete and ${party.completed_trades} completed trades`}
          className="inline-flex items-center gap-1 rounded-full bg-harvest-50 px-2 py-0.5 text-[0.7rem] font-semibold text-harvest-700 ring-1 ring-inset ring-harvest-500/25">
          <IconShield className="size-3.5" />Trusted
        </span>
      )}
      {level === 'verified' && (
        <span title="Verified by the Agrimate team"
          className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[0.7rem] font-semibold text-brand-800 ring-1 ring-inset ring-brand-600/20">
          <IconCheckCircle className="size-3.5" />Verified
        </span>
      )}
      {party.is_fpo && (
        <span title="Registered Farmer Producer Organisation"
          className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[0.7rem] font-semibold text-sky-800 ring-1 ring-inset ring-sky-600/20">
          <IconSprout className="size-3.5" />FPO
        </span>
      )}
    </span>
  );
}

/** The verification checklist, read-only. */
export function TrustChecklist({ party }: { party: P }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-2 text-sm">
        {CHECKLIST.map((c) => (
          <li key={c.key} className="flex items-start gap-2.5">
            <span className={cx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', party[c.key] ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-400')}>
              {party[c.key] ? <IconCheck className="size-3" strokeWidth={3} /> : <IconX className="size-3" strokeWidth={3} />}
            </span>
            <span><span className="font-medium text-stone-800">{c.label}</span><span className="block text-xs text-stone-500">{c.hint}</span></span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-stone-500">
        {party.completed_trades} completed trade{party.completed_trades === 1 ? '' : 's'} on Agrimate.
        Trusted traders are verified, have identity, bank and GSTIN (or FPO) checked, and {TRUSTED_MIN_TRADES}+ completed trades.
      </p>
    </div>
  );
}
