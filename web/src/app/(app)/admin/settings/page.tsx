import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCommodities } from '@/lib/data';
import { dateTimeIN } from '@/lib/money';
import { createAdmin, saveCommodity, saveVehicleRate, updateSettings } from '@/app/actions/admin';
import { ActionForm, Submit } from '@/components/action-form';
import { Card, Field, Input, PageHeader, Select } from '@/components/ui';
import { IconClock, IconLeaf, IconRupee, IconTruck, IconUser } from '@/components/icons';
import type { VehicleRate } from '@/lib/types';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: settings }, commodities, { data: audit }, { data: rates }] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).single(),
    getCommodities(true),
    supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(8),
    supabase.from('vehicle_rates').select('*').order('capacity_kg'),
  ]);
  const vehicles = (rates ?? []) as VehicleRate[];

  return (
    <>
      <PageHeader title="Settings" subtitle="Platform fee, commodities and admin accounts." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card title="Platform fee" icon={<IconRupee />}>
            <ActionForm action={updateSettings}>
              <Field label="Fee deducted from the farmer's amount (%)" hint="Applies to new orders only. Each order keeps the fee it was created with.">
                <Input name="commission_pct" inputMode="decimal" defaultValue={(settings?.commission_bps ?? 0) / 100} required />
              </Field>
              <Submit>Save</Submit>
            </ActionForm>
          </Card>

          <Card title="Add an admin" icon={<IconUser />}>
            <ActionForm action={createAdmin} resetOnSuccess>
              <Field label="Email"><Input name="login_email" type="email" required /></Field>
              <Field label="Temporary password"><Input name="password" type="text" minLength={8} maxLength={72} required autoComplete="off" /></Field>
              <Submit variant="secondary">Create admin</Submit>
            </ActionForm>
          </Card>

          <Card title="Freight rate card" icon={<IconTruck />} description="Used to suggest freight on orders: the larger of rate × distance and the minimum, per trip. You confirm the amount on each order.">
            <div className="space-y-4">
              {vehicles.map((v) => (
                <ActionForm key={v.id} action={saveVehicleRate} hidden={{ id: v.id }} className="space-y-2 border-b border-stone-100 pb-4">
                  <VehicleFields v={v} />
                  <Submit small variant="secondary">Save</Submit>
                </ActionForm>
              ))}
              <ActionForm action={saveVehicleRate} resetOnSuccess className="space-y-2">
                <p className="text-sm font-semibold text-stone-900">Add a vehicle</p>
                <VehicleFields />
                <Submit small>Add</Submit>
              </ActionForm>
            </div>
          </Card>

          <Card title="Recent admin activity" icon={<IconClock />} action={<Link href="/admin/audit" className="text-sm font-semibold text-brand-700 hover:underline">Full log →</Link>}>
            <ul className="divide-y divide-stone-100 text-sm">
              {(audit ?? []).map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="text-stone-800">{a.action}{a.entity_id ? <span className="ml-1.5 font-mono text-xs text-stone-400">{String(a.entity_id).slice(0, 8)}</span> : null}</span>
                  <span className="shrink-0 text-xs text-stone-500">{dateTimeIN(a.created_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card title="Commodities" icon={<IconLeaf />} description="Grades are comma separated. Hidden commodities stay on old orders.">
          <div className="space-y-4">
            {commodities.map((c) => (
              <ActionForm key={c.id} action={saveCommodity} hidden={{ id: c.id }} className="space-y-2 border-b border-stone-100 pb-4">
                <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                  <Input name="name" defaultValue={c.name} required maxLength={80} aria-label="Name" />
                  <Input name="grades" defaultValue={c.grades.join(', ')} aria-label="Grades (comma separated)" />
                  <Select name="active" defaultValue={c.active ? 'on' : 'off'} aria-label="Active">
                    <option value="on">Active</option>
                    <option value="off">Hidden</option>
                  </Select>
                </div>
                <Submit small variant="secondary">Save</Submit>
              </ActionForm>
            ))}
            <ActionForm action={saveCommodity} resetOnSuccess className="space-y-2">
              <p className="text-sm font-semibold text-stone-900">Add a commodity</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                <Input name="name" placeholder="Name" required maxLength={80} />
                <Input name="grades" placeholder="Grades, comma separated" />
              </div>
              <Submit small>Add</Submit>
            </ActionForm>
          </div>
        </Card>
      </div>
    </>
  );
}

function VehicleFields({ v }: { v?: VehicleRate }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
      <Input name="name" defaultValue={v?.name ?? ''} placeholder="e.g. 10-wheeler" required maxLength={80} aria-label="Vehicle" className="col-span-2 sm:col-span-1" />
      <Input name="capacity_t" inputMode="decimal" defaultValue={v ? v.capacity_kg / 1000 : ''} placeholder="Tonnes" required aria-label="Capacity (tonnes)" />
      <Input name="rate_per_km" inputMode="decimal" defaultValue={v ? v.rate_paise_per_km / 100 : ''} placeholder="₹ / km" required aria-label="Rate per km (₹)" />
      <Input name="min_charge" inputMode="decimal" defaultValue={v?.min_charge_paise ? v.min_charge_paise / 100 : ''} placeholder="Min ₹" aria-label="Minimum charge per trip (₹)" />
      <Select name="active" defaultValue={v && !v.active ? 'off' : 'on'} aria-label="Active">
        <option value="on">Active</option>
        <option value="off">Hidden</option>
      </Select>
    </div>
  );
}
