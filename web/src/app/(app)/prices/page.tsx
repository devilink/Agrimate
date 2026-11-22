import Link from 'next/link';
import { requireViewer } from '@/lib/auth';
import { getCommodities } from '@/lib/data';
import { getBenchmark, getPriceHistory } from '@/lib/prices';
import { dateIN } from '@/lib/money';
import { perQuintal } from '@/lib/units';
import { PriceChart, dailyAverages } from '@/components/price-chart';
import { ButtonLink, Card, Empty, FilterPills, Notice, PageHeader, Table, Td } from '@/components/ui';
import { IconScale, IconSliders } from '@/components/icons';

export const metadata = { title: 'Market prices' };

export default async function PricesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const viewer = await requireViewer();
  const { c } = await searchParams;
  const commodities = await getCommodities();
  const commodity = commodities.find((x) => x.id === c) ?? commodities[0];
  const [history, benchmark] = commodity
    ? await Promise.all([getPriceHistory(commodity.id, 90), getBenchmark(commodity.id)])
    : [[], null];

  return (
    <>
      <PageHeader
        title="Market prices"
        subtitle="Reference mandi prices entered by the Agrimate team, in ₹ per quintal. A guide for negotiating, not a quote."
        action={viewer.isAdmin ? <ButtonLink href="/admin/prices" variant="secondary"><IconSliders />Enter prices</ButtonLink> : undefined}
      />
      <FilterPills label="Commodity" items={commodities.map((x) => ({ href: `/prices?c=${x.id}`, label: x.name, active: x.id === commodity?.id }))} />
      {!commodity ? <Empty>No commodities yet.</Empty> : history.length === 0 ? (
        <Empty icon={<IconScale />}>No reference prices for {commodity.name} in the last 90 days.</Empty>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2" title={`${commodity.name}: last 90 days`} icon={<IconScale />}>
            <PriceChart points={dailyAverages(history)} label={`${commodity.name} modal price`} />
          </Card>
          <Card title="Latest by market" description={benchmark ? `Average modal ${perQuintal(benchmark.modal)} / qtl` : 'No entries in the last 30 days'}>
            {benchmark ? (
              <ul className="divide-y divide-stone-100 text-sm">
                {benchmark.markets.map((m) => (
                  <li key={m.id} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-stone-900">{m.market}</span>
                      <span className="text-xs text-stone-500">{[m.state, dateIN(m.price_date)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span className="font-semibold text-stone-900">{perQuintal(m.modal_paise_per_kg)}</span>
                      {(m.min_paise_per_kg || m.max_paise_per_kg) && (
                        <span className="block text-xs text-stone-500">{perQuintal(m.min_paise_per_kg)}–{perQuintal(m.max_paise_per_kg)}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-stone-500">See the history table below.</p>}
          </Card>
          <Card className="lg:col-span-3" title="All entries" padded={false}>
            <div className="px-5 sm:px-6">
              <Table head={['Date', 'Market', 'State', 'Min', 'Modal', 'Max', 'Source']}>
                {history.slice(0, 100).map((m) => (
                  <tr key={m.id}>
                    <Td>{dateIN(m.price_date)}</Td>
                    <Td className="font-medium text-stone-900">{m.market}</Td>
                    <Td>{m.state ?? '—'}</Td>
                    <Td className="tabular-nums">{perQuintal(m.min_paise_per_kg)}</Td>
                    <Td className="font-semibold tabular-nums text-stone-900">{perQuintal(m.modal_paise_per_kg)}</Td>
                    <Td className="tabular-nums">{perQuintal(m.max_paise_per_kg)}</Td>
                    <Td className="text-stone-500">{m.source ?? '—'}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          </Card>
        </div>
      )}
      <Notice tone="blue" className="mt-8">
        Prices are collected from public mandi reports (such as Agmarknet and eNAM) and calls to traders. Local prices vary
        with quality, moisture and arrivals. <Link href="/market" className="font-medium underline underline-offset-2">Back to the market</Link>.
      </Notice>
    </>
  );
}
