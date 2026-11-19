import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { getCommodities, getPartiesOfType, getPartyMap, partyLabel } from '@/lib/data';
import { dateIN, dateTimeIN, kg, rupees } from '@/lib/money';
import { DOC_KIND_LABEL, PAYMENT_METHOD_LABEL, STATUS_LABEL, orderTotals, rolesOn, transitionsFor } from '@/lib/orders';
import {
  addNote, assignInspector, assignTransport, changeStatus, recordPayment, submitInspection, updateOrderDetails, voidPayment,
} from '@/app/actions/orders';
import { ActionForm, Submit } from '@/components/action-form';
import { DocumentUpload } from '@/components/document-upload';
import { PartySelect } from '@/components/party-select';
import { PayButton } from '@/components/pay-button';
import { Badge, Card, Checkbox, Dl, Empty, Field, Input, Notice, PageHeader, Select, Textarea, cx, statusTone } from '@/components/ui';
import {
  IconCheck, IconClipboardCheck, IconFile, IconMessage, IconPackage, IconRefresh, IconTruck, IconUsers, IconWallet,
} from '@/components/icons';
import type { DocumentRow, Order, OrderEvent, OrderStatus, Party, PartyPrivate, Payment } from '@/lib/types';

const UUID = /^[0-9a-f-]{36}$/i;

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const viewer = await requireViewer();
  const supabase = await createClient();

  // Every read uses the signed-in user's client, so row-level security decides what is visible.
  const { data } = await supabase.from('orders').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  const order = data as Order;

  const [{ data: ev }, { data: pay }, { data: docs }, commodities] = await Promise.all([
    supabase.from('order_events').select('*').eq('order_id', id).order('created_at', { ascending: false }),
    supabase.from('payments').select('*').eq('order_id', id).order('created_at', { ascending: false }),
    supabase.from('documents').select('*').eq('order_id', id).order('created_at', { ascending: false }),
    getCommodities(true),
  ]);
  const events = (ev ?? []) as OrderEvent[];
  const payments = (pay ?? []) as Payment[];
  const documents = (docs ?? []) as DocumentRow[];
  const parties = await getPartyMap([order.buyer_id, order.farmer_id, order.transporter_id, order.inspector_id]);
  const roles = rolesOn(order, viewer.party?.id ?? null, viewer.isAdmin);
  const isAdmin = roles.includes('admin');
  const isBuyer = roles.includes('buyer');
  const isFarmer = roles.includes('farmer');
  const isTrader = isAdmin || isBuyer || isFarmer; // sees prices
  const t = orderTotals(order, payments);
  const transitions = transitionsFor(order, roles);
  const commodity = commodities.find((c) => c.id === order.commodity_id)?.name ?? '';
  const closed = order.status === 'completed' || order.status === 'cancelled';

  let contacts: PartyPrivate[] = [];
  let transporters: Party[] = [];
  let inspectors: Party[] = [];
  if (isAdmin) {
    const ids = [order.buyer_id, order.farmer_id, order.transporter_id, order.inspector_id].filter(Boolean) as string[];
    const [c, tr, ins] = await Promise.all([
      supabase.from('party_private').select('*').in('party_id', ids),
      getPartiesOfType('transporter'),
      getPartiesOfType('inspector'),
    ]);
    contacts = (c.data ?? []) as PartyPrivate[];
    transporters = tr;
    inspectors = ins;
  }

  return (
    <>
      <PageHeader
        back={{ href: '/orders', label: 'All orders' }}
        eyebrow={<span className="font-mono normal-case tracking-normal">{order.code}</span>}
        title={`${commodity}${order.grade ? ` · ${order.grade}` : ''}`}
        subtitle={<><Badge tone={statusTone(order.status)} dot>{STATUS_LABEL[order.status]}</Badge><span>{kg(order.quantity_kg)}</span><span className="text-stone-300">·</span><span>Created {dateIN(order.created_at)}</span></>}
      />
      <StatusTrack status={order.status} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Order details" icon={<IconPackage />}>
            <Dl items={[
              ['Buyer', partyLabel(parties.get(order.buyer_id))],
              ['Farmer / FPO', partyLabel(parties.get(order.farmer_id))],
              ['Quantity', kg(order.quantity_kg)],
              ...(isTrader ? [['Price per kg', rupees(order.price_paise_per_kg)], ['Goods value', rupees(t.goods)]] as [string, string][] : []),
              ['Pickup', order.pickup_location ?? '—'],
              ['Delivery', order.delivery_location ?? '—'],
              ['Expected date', dateIN(order.expected_date)],
              ['Received quantity', order.received_qty_kg === null ? '—' : kg(order.received_qty_kg)],
            ]} />
          </Card>

          {transitions.length > 0 && (
            <Card title="Update status" icon={<IconRefresh />} description="Moves the order forward and adds an entry to the timeline." className="ring-2 ring-brand-600/10">
              <ActionForm action={changeStatus} hidden={{ order_id: order.id, from: order.status }} resetOnSuccess>
                <Field label="New status">
                  <Select name="to" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {transitions.map((x) => <option key={x.to} value={x.to}>{x.label}</option>)}
                  </Select>
                </Field>
                {isBuyer && order.status === 'in_transit' && (
                  <Field label="Quantity received (kg)" hint="From the weighbridge slip, if you have it"><Input name="received_qty_kg" type="number" min={0} /></Field>
                )}
                <Field label={isAdmin ? 'Note (required for admin changes)' : 'Note'} hint="Shown on the timeline to everyone on this order">
                  <Textarea name="note" maxLength={2000} />
                </Field>
                <Submit>Update</Submit>
              </ActionForm>
            </Card>
          )}

          <Card title="Quality check" icon={<IconClipboardCheck />}>
            <Dl items={[
              ['Inspector', order.inspector_id ? partyLabel(parties.get(order.inspector_id)) : 'Not assigned'],
              ['Result', order.inspection_result ? <Badge tone={statusTone(order.inspection_result)}>{order.inspection_result}</Badge> : '—'],
            ]} />
            {order.inspection_notes && <p className="mt-3 whitespace-pre-line text-sm text-stone-700">{order.inspection_notes}</p>}
            {(roles.includes('inspector') || isAdmin) && ['confirmed', 'quality_check', 'ready'].includes(order.status) && order.inspector_id && (
              <ActionForm action={submitInspection} hidden={{ order_id: order.id }} className="mt-5 border-t border-stone-100 pt-5">
                <Field label="Result">
                  <Select name="result" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    <option value="pass">Pass: matches the agreed grade</option>
                    <option value="fail">Fail: does not match</option>
                  </Select>
                </Field>
                <Field label="Findings" hint="Moisture, foreign matter, size, weight checked, etc. Upload photos and the report below.">
                  <Textarea name="notes" required maxLength={2000} />
                </Field>
                <Submit>Submit inspection</Submit>
              </ActionForm>
            )}
            {isAdmin && !closed && (
              <ActionForm action={assignInspector} hidden={{ order_id: order.id }} className="mt-5 border-t border-stone-100 pt-5">
                <PartySelect parties={inspectors} label="Assign inspector" name="inspector_id" required={false} defaultValue={order.inspector_id ?? ''} />
                <Submit variant="secondary" small>Save inspector</Submit>
              </ActionForm>
            )}
          </Card>

          <Card title="Transport" icon={<IconTruck />}>
            <Dl items={[
              ['Transporter', order.transporter_id ? partyLabel(parties.get(order.transporter_id)) : 'Not assigned (own arrangement)'],
              ['Vehicle', order.vehicle_no ?? '—'],
              ['Driver', [order.driver_name, order.driver_phone].filter(Boolean).join(' · ') || '—'],
              ...((isAdmin || isBuyer || roles.includes('transporter')) ? [['Freight', rupees(t.freight)]] as [string, string][] : []),
            ]} />
            {isAdmin && !closed && (
              <ActionForm action={assignTransport} hidden={{ order_id: order.id }} className="mt-5 border-t border-stone-100 pt-5">
                <PartySelect parties={transporters} label="Transporter" name="transporter_id" required={false} defaultValue={order.transporter_id ?? ''} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Vehicle number"><Input name="vehicle_no" defaultValue={order.vehicle_no ?? ''} maxLength={20} /></Field>
                  <Field label="Freight charged to buyer (₹)"><Input name="freight" inputMode="decimal" defaultValue={order.freight_paise ? order.freight_paise / 100 : ''} /></Field>
                  <Field label="Driver name"><Input name="driver_name" defaultValue={order.driver_name ?? ''} maxLength={80} /></Field>
                  <Field label="Driver phone"><Input name="driver_phone" type="tel" defaultValue={order.driver_phone ?? ''} maxLength={20} /></Field>
                </div>
                <Submit variant="secondary" small>Save transport</Submit>
              </ActionForm>
            )}
          </Card>

          <Card title="Documents" icon={<IconFile />}>
            {documents.length === 0 ? <Empty>No documents yet.</Empty> : (
              <ul className="space-y-2 text-sm">
                {documents.map((d) => (
                  <li key={d.id}>
                    <a href={`/orders/${order.id}/documents/${d.id}`} target="_blank" rel="noopener noreferrer"
                      className="group flex items-center gap-3 rounded-xl border border-stone-200 px-3 py-2.5 transition-colors hover:border-brand-200 hover:bg-brand-50/40">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-stone-100 text-stone-500 group-hover:bg-white group-hover:text-brand-700"><IconFile className="size-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-stone-900">{d.file_name}</span>
                        <span className="block text-xs text-stone-500">{DOC_KIND_LABEL[d.kind]} · {dateTimeIN(d.created_at)}</span>
                      </span>
                      <span className="text-xs font-semibold text-brand-700">Open ↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 border-t border-stone-100 pt-5"><DocumentUpload orderId={order.id} /></div>
          </Card>

          <Card title="Timeline and notes" icon={<IconMessage />}>
            <ActionForm action={addNote} hidden={{ order_id: order.id }} resetOnSuccess className="mb-5">
              <Field label="Add a note" hint="Phone calls, agreed changes, reminders. Everyone on this order sees it.">
                <Textarea name="message" required maxLength={2000} />
              </Field>
              {isAdmin && (
                <Checkbox name="internal" label="Internal note" hint="Only admins see it" />
              )}
              <Submit variant="secondary" small>Add note</Submit>
            </ActionForm>
            <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-stone-200">
              {events.map((e) => (
                <li key={e.id} className="relative pl-7 text-sm">
                  <span className={cx(
                    'absolute left-0 top-1 size-[15px] rounded-full border-[3px] border-white ring-1',
                    e.to_status ? 'bg-brand-600 ring-brand-200' : e.visibility === 'admin' ? 'bg-harvest-400 ring-harvest-200' : 'bg-stone-300 ring-stone-200',
                  )} />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
                    <span className="font-semibold text-stone-800">{e.actor_label}</span>
                    <span>{dateTimeIN(e.created_at)}</span>
                    {e.visibility === 'admin' && <Badge tone="amber">internal</Badge>}
                    {e.to_status && <Badge tone={statusTone(e.to_status)}>{STATUS_LABEL[e.to_status]}</Badge>}
                  </div>
                  {e.message && <p className={cx('mt-1.5 whitespace-pre-line leading-relaxed text-stone-700', e.visibility === 'admin' && 'rounded-lg bg-harvest-50/70 px-3 py-2')}>{e.message}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          {(isTrader || payments.length > 0) && (
            <Card title="Money" icon={<IconWallet />}>
              <dl className="space-y-2 text-sm">
                {(isAdmin || isBuyer) && <>
                  <Row k="Goods" v={rupees(t.goods)} />
                  <Row k="Freight" v={rupees(t.freight)} />
                  <Row k="Buyer pays" v={rupees(t.buyerTotal)} strong />
                  <Row k="Received" v={rupees(t.receivedIn)} />
                  <Row k="Balance due" v={rupees(t.buyerBalance)} strong />
                </>}
                {(isAdmin || isFarmer) && <>
                  <div className="my-3 border-t border-dashed border-stone-200" />
                  <Row k="Goods value" v={rupees(t.goods)} />
                  <Row k={`Platform fee (${order.commission_bps / 100}%)`} v={`− ${rupees(t.commission)}`} />
                  <Row k="Farmer receives" v={rupees(t.farmerPayable)} strong />
                  <Row k="Paid to farmer" v={rupees(t.paidToFarmer)} />
                  {isFarmer && <Row k="Buyer has paid" v={rupees(t.receivedIn)} />}
                </>}
                {isAdmin && order.transporter_id && <>
                  <div className="my-3 border-t border-dashed border-stone-200" />
                  <Row k="Paid to transporter" v={rupees(t.paidToTransporter)} />
                </>}
              </dl>
              {isBuyer && t.buyerBalance > 0 && order.status !== 'cancelled' && (
                <div className="mt-5 border-t border-stone-100 pt-5">
                  {env.razorpayEnabled && <PayButton orderId={order.id} balancePaise={t.buyerBalance} />}
                  <p className="mt-3 text-xs text-stone-500">
                    Paying by bank transfer, UPI or cheque instead? Pay to Agrimate&apos;s account and add a note here with the
                    UTR / reference. Our team will confirm it.
                  </p>
                </div>
              )}
            </Card>
          )}

          <Card title="Payments" icon={<IconWallet />}>
            {payments.length === 0 ? <Empty>No payments recorded.</Empty> : (
              <ul className="space-y-3 text-sm">
                {payments.map((p) => (
                  <li key={p.id} className={cx('rounded-xl border border-stone-200 px-3 py-2.5', p.status === 'void' && 'bg-stone-50 opacity-60 line-through')}>
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{p.direction === 'in' ? 'From buyer' : `To ${partyLabel(parties.get(p.payee_party_id ?? ''))}`}</span>
                      <span className="font-semibold tabular-nums">{rupees(p.amount_paise)}</span>
                    </div>
                    <div className="text-xs text-stone-500">
                      {PAYMENT_METHOD_LABEL[p.method]} · {dateIN(p.paid_on)}{p.reference ? ` · ref ${p.reference}` : ''}
                    </div>
                    {p.note && <div className="text-xs text-stone-500">{p.note}</div>}
                    {isAdmin && p.status === 'confirmed' && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-medium text-rose-700 hover:text-rose-800">Void this payment…</summary>
                        <ActionForm action={voidPayment} hidden={{ payment_id: p.id }} className="mt-2">
                          <Input name="reason" placeholder="Reason (e.g. cheque bounced)" required maxLength={300} />
                          <Submit small variant="danger">Void payment</Submit>
                        </ActionForm>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {isAdmin && (
            <Card title="Record a payment">
              <ActionForm action={recordPayment} hidden={{ order_id: order.id }} resetOnSuccess>
                <Field label="Direction">
                  <Select name="direction" required defaultValue="in">
                    <option value="in">Received from buyer</option>
                    <option value="out">Paid out</option>
                  </Select>
                </Field>
                <Field label="Paid to (for payouts)">
                  <Select name="payee" defaultValue="farmer">
                    <option value="farmer">Farmer</option>
                    {order.transporter_id && <option value="transporter">Transporter</option>}
                    {order.inspector_id && <option value="inspector">Inspector</option>}
                  </Select>
                </Field>
                <Field label="Method">
                  <Select name="method" required defaultValue="bank_transfer">
                    <option value="bank_transfer">Bank transfer (NEFT/RTGS/IMPS)</option>
                    <option value="upi">UPI</option>
                    <option value="cheque">Cheque</option>
                    <option value="cash">Cash</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Amount (₹)"><Input name="amount" inputMode="decimal" required /></Field>
                <Field label="UTR / transaction ID / cheque no."><Input name="reference" maxLength={120} /></Field>
                <Field label="Date"><Input name="paid_on" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
                <Field label="Note"><Input name="note" maxLength={500} /></Field>
                <Submit>Record payment</Submit>
              </ActionForm>
            </Card>
          )}

          {isAdmin && (
            <Card title="Contacts" description="Admin only" icon={<IconUsers />}>
              <ul className="space-y-3 text-sm">
                {[['Buyer', order.buyer_id], ['Farmer', order.farmer_id], ['Transporter', order.transporter_id], ['Inspector', order.inspector_id]]
                  .filter(([, pid]) => pid)
                  .map(([label, pid]) => {
                    const c = contacts.find((x) => x.party_id === pid);
                    return (
                      <li key={label}>
                        <div className="text-xs font-medium text-stone-500">{label}</div>
                        <Link href={`/admin/parties/${pid}`} className="font-semibold text-brand-700 hover:text-brand-900 hover:underline">{parties.get(pid!)?.name}</Link>
                        <div className="text-stone-600">{[c?.phone, c?.email].filter(Boolean).join(' · ') || 'No contact details'}</div>
                      </li>
                    );
                  })}
              </ul>
            </Card>
          )}

          {isAdmin && (
            <Card title="Edit details">
              <ActionForm action={updateOrderDetails} hidden={{ order_id: order.id }}>
                <Field label="Pickup location"><Input name="pickup_location" defaultValue={order.pickup_location ?? ''} maxLength={300} /></Field>
                <Field label="Delivery location"><Input name="delivery_location" defaultValue={order.delivery_location ?? ''} maxLength={300} /></Field>
                <Field label="Expected date"><Input name="expected_date" type="date" defaultValue={order.expected_date ?? ''} /></Field>
                <Submit variant="secondary" small>Save</Submit>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className={strong ? 'font-medium text-stone-800' : 'text-stone-500'}>{k}</dt>
      <dd className={strong ? 'font-semibold tabular-nums text-stone-900' : 'tabular-nums text-stone-800'}>{v}</dd>
    </div>
  );
}

const TRACK: OrderStatus[] = ['confirmed', 'quality_check', 'ready', 'in_transit', 'delivered', 'completed'];

/** Where the order is on the normal path. Disputed and cancelled orders get a banner instead. */
function StatusTrack({ status }: { status: OrderStatus }) {
  if (status === 'disputed') {
    return <Notice tone="red"><span className="font-semibold">This order is disputed.</span> The Agrimate team is looking into it. Updates appear on the timeline below.</Notice>;
  }
  if (status === 'cancelled') {
    return <Notice tone="red"><span className="font-semibold">This order was cancelled.</span> See the timeline for the reason.</Notice>;
  }
  const at = TRACK.indexOf(status);
  return (
    <div className="mb-8 rounded-2xl border border-stone-200/80 bg-white px-4 py-5 shadow-card sm:px-6">
      <ol className="flex items-start">
        {TRACK.map((s, i) => {
          const done = i < at || status === 'completed';
          const current = i === at && status !== 'completed';
          return (
            <li key={s} className="relative flex flex-1 flex-col items-center text-center" aria-current={current ? 'step' : undefined}>
              {i > 0 && <span className={cx('absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2', i <= at ? 'bg-brand-600' : 'bg-stone-200')} />}
              <span className={cx(
                'relative z-10 grid size-7 place-items-center rounded-full text-xs font-bold ring-4 ring-white',
                done ? 'bg-brand-600 text-white' : current ? 'bg-harvest-400 text-brand-950' : 'bg-stone-100 text-stone-400',
              )}>
                {done ? <IconCheck className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cx('mt-2 hidden px-1 text-xs font-medium sm:block', current ? 'text-stone-900' : done ? 'text-stone-600' : 'text-stone-400')}>{STATUS_LABEL[s]}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-center text-sm font-medium text-stone-700 sm:hidden">Now: {STATUS_LABEL[status]}</p>
    </div>
  );
}
