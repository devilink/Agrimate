import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCommodities } from '@/lib/data';
import { dateIN } from '@/lib/money';
import { INDIAN_STATES } from '@/lib/india';
import { perQuintal } from '@/lib/units';
import { deleteMarketPrice, saveMarketPrice } from '@/app/actions/admin';
import { ActionForm, Submit } from '@/components/action-form';
import { Card, Empty, Field, FilterPills, Input, PageHeader, Select, Table, Td } from '@/components/ui';
import { IconPlus, IconScale } from '@/components/icons';
import type { MarketPrice } from '@/lib/types';

export const metadata = { title: 'Reference prices' };

export default async function AdminPricesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requireAdmin();
  const { c } = await searchParams;
  const supabase = await createClient();
  const commodities = await getCommodities();
  const commodity = commodities.find((x) => x.id === c);
  let q = supabase.from('market_prices').select('*').order('price_date', { ascending: false }).order('created_at', { ascending: false }).limit(100);
  if (commodity) q = q.eq('commodity_id', commodity.id);
  const { data } = await q;
  const rows = (data ?? []) as MarketPrice[];
  const cname = new Map(commodities.map((x) => [x.id, x.name]));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  return (
    <>
      <PageHeader title="Reference prices" subtitle="Mandi prices members see on the Prices page and next to every listing. Enter what you read in Agmarknet / eNAM or hear from traders." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Add a price" icon={<IconPlus />} className="h-fit">
          <ActionForm action={saveMarketPrice}>
            <Field label="Commodity">
              <Select name="commodity_id" required defaultValue={commodity?.id ?? ''}>
                <option value="" disabled>Choose…</option>
                {commodities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </Field>
            <Field label="Market / mandi"><Input name="market" required maxLength={120} placeholder="e.g. Nagaon APMC" /></Field>
            <Field label="State">
              <Select name="state" defaultValue="">
                <option value="">—</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Date"><Input name="price_date" type="date" required defaultValue={today} max={today} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Min ₹/qtl"><Input name="min" inputMode="decimal" /></Field>
              <Field label="Modal ₹/qtl"><Input name="modal" inputMode="decimal" required /></Field>
              <Field label="Max ₹/qtl"><Input name="max" inputMode="decimal" /></Field>
            </div>
            <Field label="Source" hint="Where the number came from"><Input name="source" maxLength={120} placeholder="Agmarknet" /></Field>
            <p className="text-xs text-stone-500">Entering the same commodity, market and date again corrects the earlier entry.</p>
            <Submit>Save price</Submit>
          </ActionForm>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <FilterPills label="Commodity" items={[
            { href: '/admin/prices', label: 'All', active: !commodity },
            ...commodities.map((x) => ({ href: `/admin/prices?c=${x.id}`, label: x.name, active: x.id === commodity?.id })),
          ]} />
          <Card padded={false} title="Recent entries" icon={<IconScale />}>
            {rows.length === 0 ? <div className="px-6 pb-6"><Empty>No prices entered{commodity ? ` for ${commodity.name}` : ''} yet.</Empty></div> : (
              <div className="px-5 sm:px-6">
                <Table head={['Date', 'Commodity', 'Market', 'Min', 'Modal', 'Max', 'Source', '']}>
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <Td>{dateIN(m.price_date)}</Td>
                      <Td>{cname.get(m.commodity_id) ?? '—'}</Td>
                      <Td className="max-w-[12rem] truncate font-medium text-stone-900">{m.market}{m.state ? <span className="block text-xs font-normal text-stone-500">{m.state}</span> : null}</Td>
                      <Td className="tabular-nums">{perQuintal(m.min_paise_per_kg)}</Td>
                      <Td className="font-semibold tabular-nums">{perQuintal(m.modal_paise_per_kg)}</Td>
                      <Td className="tabular-nums">{perQuintal(m.max_paise_per_kg)}</Td>
                      <Td className="max-w-[8rem] truncate text-stone-500">{m.source ?? '—'}</Td>
                      <Td>
                        <ActionForm action={deleteMarketPrice} hidden={{ id: m.id }} className="space-y-1">
                          <Submit small variant="ghost">Delete</Submit>
                        </ActionForm>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
