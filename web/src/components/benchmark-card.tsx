import Link from 'next/link';
import { Card, cx } from '@/components/ui';
import { IconScale } from '@/components/icons';
import { dateIN } from '@/lib/money';
import { perQuintal, pctDiff } from '@/lib/units';
import type { Benchmark } from '@/lib/prices';

/** This post's price next to the reference market price the Agrimate team entered. */
export function BenchmarkCard({ benchmark, price, commodityId, priceLabel }: {
  benchmark: Benchmark | null; price: number | null; commodityId: string; priceLabel: string;
}) {
  return (
    <Card title="Market reference" icon={<IconScale />}>
      {!benchmark ? (
        <p className="text-sm text-stone-500">No reference prices from the last 30 days for this commodity yet.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs text-stone-500">Average modal price</div>
              <div className="font-display text-2xl font-semibold tabular-nums text-stone-900">{perQuintal(benchmark.modal)}<span className="text-sm font-normal text-stone-500"> / qtl</span></div>
            </div>
            {price ? (
              <div className="text-right">
                <div className="text-xs text-stone-500">{priceLabel}</div>
                <div className={cx('font-semibold tabular-nums', price > benchmark.modal ? 'text-harvest-700' : 'text-brand-700')}>
                  {perQuintal(price)} ({pctDiff(price, benchmark.modal)})
                </div>
              </div>
            ) : null}
          </div>
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-100">
            {benchmark.markets.slice(0, 5).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate">{m.market}{m.state ? <span className="text-stone-400"> · {m.state}</span> : null}</span>
                <span className="shrink-0 tabular-nums text-stone-700">{perQuintal(m.modal_paise_per_kg)} <span className="text-xs text-stone-400">{dateIN(m.price_date)}</span></span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-stone-500">
            Entered by the Agrimate team from mandi reports, latest {dateIN(benchmark.latestDate)}. A guide only, not a quote.{' '}
            <Link href={`/prices?c=${commodityId}`} className="font-medium text-brand-700 hover:underline">Price history →</Link>
          </p>
        </div>
      )}
    </Card>
  );
}
