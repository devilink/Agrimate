import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { dateIN, rupees } from '@/lib/money';
import { STATUS_LABEL } from '@/lib/orders';
import { createLoginForParty, updateParty } from '@/app/actions/admin';
import { ActionForm, Submit } from '@/components/action-form';
import { PartyFormFields } from '@/components/party-form-fields';
import { TrustBadges } from '@/components/trust';
import { Badge, Card, Checkbox, Dl, Empty, Field, Input, PageHeader, statusTone } from '@/components/ui';
import { IconLock, IconPackage, IconShield, IconUser } from '@/components/icons';
import { CHECKLIST, TRUSTED_MIN_TRADES, trustLevel } from '@/lib/trust';
import type { Order, Party, PartyPrivate } from '@/lib/types';

const UUID = /^[0-9a-f-]{36}$/i;

export default async function PartyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: p }, { data: priv }, { data: orders }] = await Promise.all([
    supabase.from('parties').select('*').eq('id', id).maybeSingle(),
    supabase.from('party_private').select('*').eq('party_id', id).maybeSingle(),
    supabase.from('orders').select('*')
      .or(`buyer_id.eq.${id},farmer_id.eq.${id},transporter_id.eq.${id},inspector_id.eq.${id}`)
      .order('created_at', { ascending: false }).limit(500),
  ]);
  if (!p) notFound();
  const party = p as Party;
  const list = (orders ?? []) as Order[];
  const asTrader = list.filter((o) => o.buyer_id === id || o.farmer_id === id);
  const completedValue = asTrader.filter((o) => o.status === 'completed').reduce((s, o) => s + Number(o.goods_paise), 0);
  const openOrders = list.filter((o) => !['completed', 'cancelled'].includes(o.status)).length;
  const disputes = list.filter((o) => o.status === 'disputed').length;

  return (
    <>
      <PageHeader
        title={party.name}
        back={{ href: '/admin/parties', label: 'All parties' }}
        eyebrow={party.type}
        subtitle={<>{!party.active ? <Badge tone="red" dot>deactivated</Badge> : party.verified ? <Badge tone="green" dot>verified</Badge> : <Badge tone="amber" dot>unverified</Badge>}<span>Joined {dateIN(party.created_at)}</span></>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Details" icon={<IconUser />}>
          <ActionForm action={updateParty} hidden={{ party_id: party.id }} className="space-y-6">
            <PartyFormFields party={party} priv={priv as PartyPrivate | null} showAdminNotes />
            <div className="grid gap-3 sm:grid-cols-2">
              <Checkbox name="verified" defaultChecked={party.verified} label="Verified" hint="Can list, offer and buy" />
              <Checkbox name="active" defaultChecked={party.active} label="Active" hint="Unticking blocks their login" />
            </div>
            <fieldset>
              <legend className="mb-3 text-sm font-semibold text-stone-900">Verification checklist <span className="font-normal text-stone-500">· shown to members as badges</span></legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {CHECKLIST.map((c) => <Checkbox key={c.key} name={c.key} defaultChecked={party[c.key]} label={c.label} hint={c.hint} />)}
              </div>
            </fieldset>
            <Submit>Save</Submit>
          </ActionForm>
        </Card>
        <div className="space-y-6">
          <Card title="Login" icon={<IconLock />}>
            {party.user_id ? (
              <p className="text-sm text-stone-600">This party has a login{priv?.email ? ` (${priv.email})` : ''}.</p>
            ) : (
              <ActionForm action={createLoginForParty} hidden={{ party_id: party.id }}>
                <p className="text-sm text-stone-600">Offline party. Create a login so they can see their orders.</p>
                <Field label="Email"><Input name="login_email" type="email" required defaultValue={priv?.email ?? ''} /></Field>
                <Field label="Temporary password" hint="Share privately; ask them to change it."><Input name="password" type="text" minLength={8} maxLength={72} required autoComplete="off" /></Field>
                <Submit variant="secondary">Create login</Submit>
              </ActionForm>
            )}
          </Card>
          <Card title="Trust and trade" icon={<IconShield />} action={<TrustBadges party={party} />}>
            <Dl items={[
              ['Completed trades', String(party.completed_trades)],
              ['Open orders', String(openOrders)],
              [party.type === 'buyer' ? 'Bought (completed)' : party.type === 'farmer' ? 'Sold (completed)' : 'Completed value', rupees(completedValue)],
              ['Disputes', String(disputes)],
            ]} />
            <p className="mt-4 text-xs text-stone-500">
              {trustLevel(party) === 'trusted' ? 'Shown as a Trusted trader.' : `Trusted traders need the full checklist and ${TRUSTED_MIN_TRADES}+ completed trades.`}
            </p>
          </Card>
          <Card title="Orders" icon={<IconPackage />}>
            {(orders ?? []).length === 0 ? <Empty>No orders.</Empty> : (
              <ul className="-mx-2 text-sm">
                {list.slice(0, 50).map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-stone-50">
                      <span className="font-mono text-[0.8125rem] font-semibold text-brand-700">{o.code}</span>
                      <span className="ml-auto tabular-nums text-stone-600">{rupees(o.goods_paise)}</span>
                      <Badge tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
