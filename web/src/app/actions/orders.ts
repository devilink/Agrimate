'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { actorLabel, requireAdmin, requireViewer, type Viewer } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { check, date, fail, int, optionalUuid, required, run, text, uuid, type ActionState } from '@/lib/action';
import { rupees, toPaise } from '@/lib/money';
import { orderTotals, rolesOn, STATUS_LABEL, STATUS_ORDER, transitionsFor, DOC_KIND_LABEL, PAYMENT_METHOD_LABEL } from '@/lib/orders';
import type { DocKind, Order, OrderStatus, Payment, PaymentMethod } from '@/lib/types';

async function loadOrder(id: string): Promise<Order> {
  const { data } = await adminClient().from('orders').select('*').eq('id', id).maybeSingle();
  if (!data) fail('Order not found.');
  return data as Order;
}

/** Loads the order and confirms the viewer is on it (or is an admin). */
async function orderForViewer(id: string) {
  const viewer = await requireViewer();
  const order = await loadOrder(id);
  const roles = rolesOn(order, viewer.party?.id ?? null, viewer.isAdmin);
  if (roles.length === 0) fail('Order not found.');
  return { viewer, order, roles };
}

async function addEvent(order_id: string, viewer: Viewer, kind: string, message: string, visibility: 'all' | 'admin' = 'all') {
  check(await adminClient().from('order_events').insert({
    order_id, kind, message, visibility, actor_id: viewer.userId, actor_label: actorLabel(viewer),
  }));
}

function done(orderId: string) {
  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/orders');
}

export async function changeStatus(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const { viewer, order, roles } = await orderForViewer(uuid(form, 'order_id'));
    const to = form.get('to') as OrderStatus;
    if (!STATUS_ORDER.includes(to)) fail('Invalid status.');
    if (form.get('from') !== order.status) fail('The order changed in the meantime. Reload the page.');
    const allowed = transitionsFor(order, roles).find((t) => t.to === to);
    if (!allowed) fail('You cannot make that change on this order.');
    const note = text(form, 'note', 2000);
    if (allowed.needsNote && !note) fail('Add a note explaining the change.');

    if (to === 'delivered' && roles.includes('buyer') && form.get('received_qty_kg')) {
      const received = int(form, 'received_qty_kg', 'Received quantity', { min: 0 });
      check(await adminClient().from('orders').update({ received_qty_kg: received }).eq('id', order.id));
    }
    check(await adminClient().rpc('set_order_status', {
      p_order: order.id, p_from: order.status, p_to: to, p_actor: viewer.userId,
      p_actor_label: actorLabel(viewer), p_message: note,
    }));
    done(order.id);
    return `Status changed to ${STATUS_LABEL[to]}.`;
  });
}

export async function addNote(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const { viewer, order } = await orderForViewer(uuid(form, 'order_id'));
    const message = required(form, 'message', 'Note', 2000);
    const internal = viewer.isAdmin && form.get('internal') === 'on';
    await addEvent(order.id, viewer, 'note', message, internal ? 'admin' : 'all');
    done(order.id);
    return internal ? 'Internal note added (only admins see it).' : 'Note added.';
  });
}

/** Admin: choose who transports the goods and what the buyer pays for freight. */
export async function assignTransport(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireAdmin();
    const order = await loadOrder(uuid(form, 'order_id'));
    const transporter_id = optionalUuid(form, 'transporter_id');
    if (transporter_id) {
      const { data } = await adminClient().from('parties').select('type').eq('id', transporter_id).maybeSingle();
      if (data?.type !== 'transporter') fail('Choose a transporter.');
    }
    const freightRaw = form.get('freight');
    const freight_paise = freightRaw === '' || freightRaw === null ? 0 : toPaise(freightRaw) ?? fail('Enter freight in rupees.');
    const changes = {
      transporter_id,
      vehicle_no: text(form, 'vehicle_no', 20)?.toUpperCase() ?? null,
      driver_name: text(form, 'driver_name', 80),
      driver_phone: text(form, 'driver_phone', 20),
      freight_paise,
      updated_at: new Date().toISOString(),
    };
    check(await adminClient().from('orders').update(changes).eq('id', order.id));
    const who = transporter_id
      ? (await adminClient().from('parties').select('name').eq('id', transporter_id).single()).data?.name
      : 'buyer/farmer own arrangement';
    await addEvent(order.id, viewer, 'assignment',
      `Transport: ${who}${changes.vehicle_no ? `, vehicle ${changes.vehicle_no}` : ''}. Freight ${rupees(freight_paise)}.`);
    done(order.id);
    return 'Transport details saved.';
  });
}

export async function assignInspector(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireAdmin();
    const order = await loadOrder(uuid(form, 'order_id'));
    const inspector_id = optionalUuid(form, 'inspector_id');
    let name = 'none';
    if (inspector_id) {
      const { data } = await adminClient().from('parties').select('type, name').eq('id', inspector_id).maybeSingle();
      if (data?.type !== 'inspector') fail('Choose an inspector.');
      name = data.name;
    }
    check(await adminClient().from('orders')
      .update({ inspector_id, inspection_result: null, updated_at: new Date().toISOString() }).eq('id', order.id));
    await addEvent(order.id, viewer, 'assignment', `Quality inspector: ${name}.`);
    if (inspector_id && order.status === 'confirmed') {
      check(await adminClient().rpc('set_order_status', {
        p_order: order.id, p_from: 'confirmed', p_to: 'quality_check', p_actor: viewer.userId,
        p_actor_label: actorLabel(viewer), p_message: 'Quality check scheduled.',
      }));
    }
    done(order.id);
    return 'Inspector saved.';
  });
}

export async function submitInspection(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const { viewer, order, roles } = await orderForViewer(uuid(form, 'order_id'));
    if (!roles.includes('inspector') && !roles.includes('admin')) fail('Only the assigned inspector can do this.');
    if (!['confirmed', 'quality_check', 'ready'].includes(order.status)) fail('The order is past the quality check.');
    const result = form.get('result');
    if (result !== 'pass' && result !== 'fail') fail('Choose pass or fail.');
    const notes = required(form, 'notes', 'Inspection notes', 2000);
    check(await adminClient().from('orders')
      .update({ inspection_result: result, inspection_notes: notes, updated_at: new Date().toISOString() }).eq('id', order.id));
    await addEvent(order.id, viewer, 'note', `Quality inspection ${result === 'pass' ? 'PASSED' : 'FAILED'}: ${notes}`);
    if (result === 'pass' && order.status === 'quality_check') {
      check(await adminClient().rpc('set_order_status', {
        p_order: order.id, p_from: 'quality_check', p_to: 'ready', p_actor: viewer.userId,
        p_actor_label: actorLabel(viewer), p_message: 'Passed quality check.',
      }));
    }
    done(order.id);
    return result === 'pass' ? 'Inspection recorded. The order is ready for dispatch.' : 'Inspection recorded. Our team will follow up.';
  });
}

export async function updateOrderDetails(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireAdmin();
    const order = await loadOrder(uuid(form, 'order_id'));
    check(await adminClient().from('orders').update({
      pickup_location: text(form, 'pickup_location', 300),
      delivery_location: text(form, 'delivery_location', 300),
      expected_date: date(form, 'expected_date'),
      updated_at: new Date().toISOString(),
    }).eq('id', order.id));
    await addEvent(order.id, viewer, 'note', 'Pickup / delivery details updated.');
    done(order.id);
    return 'Details saved.';
  });
}

const MANUAL_METHODS: PaymentMethod[] = ['bank_transfer', 'upi', 'cheque', 'cash', 'other'];

/** Admin: record money that moved outside the website (NEFT, UPI, cheque, cash), in or out. */
export async function recordPayment(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireAdmin();
    const order = await loadOrder(uuid(form, 'order_id'));
    const db = adminClient();
    const direction = form.get('direction');
    if (direction !== 'in' && direction !== 'out') fail('Choose received or paid out.');
    const method = form.get('method') as PaymentMethod;
    if (!MANUAL_METHODS.includes(method)) fail('Choose how the money moved.');
    const amount = toPaise(form.get('amount')) ?? fail('Enter the amount in rupees.');
    const reference = text(form, 'reference', 120);
    if ((method === 'bank_transfer' || method === 'upi' || method === 'cheque') && !reference) {
      fail('Enter the UTR / transaction ID / cheque number, so the payment can be matched to the bank statement.');
    }

    let payee: string | null = null;
    if (direction === 'out') {
      const to = form.get('payee');
      payee = to === 'farmer' ? order.farmer_id : to === 'transporter' ? order.transporter_id
        : to === 'inspector' ? order.inspector_id : null;
      if (!payee) fail('Choose who was paid (and make sure they are assigned to the order).');
    }

    const { data: existing } = await db.from('payments').select('*').eq('order_id', order.id);
    const t = orderTotals(order, (existing ?? []) as Payment[]);
    if (direction === 'in' && amount > t.buyerBalance) {
      fail(`That is more than the buyer still owes (${rupees(t.buyerBalance)}). Adjust freight first if the deal changed.`);
    }
    if (direction === 'out' && payee === order.farmer_id && amount > t.farmerPayable - t.paidToFarmer) {
      fail(`That is more than the farmer is still owed (${rupees(t.farmerPayable - t.paidToFarmer)}).`);
    }

    check(await db.from('payments').insert({
      order_id: order.id, direction, payee_party_id: payee, method, amount_paise: amount, reference,
      paid_on: date(form, 'paid_on') ?? new Date().toISOString().slice(0, 10),
      note: text(form, 'note', 500), recorded_by: viewer.userId,
    }));
    const what = direction === 'in' ? 'Payment received from buyer' : `Payout to ${form.get('payee')}`;
    await addEvent(order.id, viewer, 'payment',
      `${what}: ${rupees(amount)} by ${PAYMENT_METHOD_LABEL[method]}${reference ? ` (ref ${reference})` : ''}.`);
    done(order.id);
    return 'Payment recorded.';
  });
}

export async function voidPayment(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const viewer = await requireAdmin();
    const db = adminClient();
    const { data: p } = await db.from('payments').select('*').eq('id', uuid(form, 'payment_id')).maybeSingle();
    if (!p || p.status !== 'confirmed') fail('Payment not found or already voided.');
    const reason = required(form, 'reason', 'Reason', 300);
    check(await db.from('payments').update({ status: 'void', note: `${p.note ?? ''} [void: ${reason}]`.trim() }).eq('id', p.id));
    await addEvent(p.order_id, viewer, 'payment', `Payment of ${rupees(p.amount_paise)} voided: ${reason}`);
    done(p.order_id);
    return p.method === 'razorpay'
      ? 'Voided here. Issue the actual refund from the Razorpay dashboard.'
      : 'Payment voided.';
  });
}

/** Admin: an order agreed outside the website (phone, mandi, WhatsApp). */
export async function createManualOrder(_: ActionState, form: FormData): Promise<ActionState> {
  let id = '';
  const result = await run(async () => {
    const viewer = await requireAdmin();
    const db = adminClient();
    const buyer_id = uuid(form, 'buyer_id');
    const farmer_id = uuid(form, 'farmer_id');
    const { data: parties } = await db.from('parties').select('id, type').in('id', [buyer_id, farmer_id]);
    if (parties?.find((p) => p.id === buyer_id)?.type !== 'buyer') fail('Choose a buyer.');
    if (parties?.find((p) => p.id === farmer_id)?.type !== 'farmer') fail('Choose a farmer.');
    const commodity_id = uuid(form, 'commodity_id');
    const quantity_kg = int(form, 'quantity_kg', 'Quantity (kg)');
    const price = toPaise(form.get('price')) ?? fail('Enter the price per kg.');
    const { data: s } = await db.from('settings').select('commission_bps').eq('id', 1).single();
    const pct = form.get('commission_pct');
    const commission_bps = pct === null || pct === '' ? s?.commission_bps ?? 0 : Math.round(Number(pct) * 100);
    if (!Number.isInteger(commission_bps) || commission_bps < 0 || commission_bps > 2000) fail('Commission must be 0 to 20%.');

    const row = check(await db.from('orders').insert({
      buyer_id, farmer_id, commodity_id, grade: text(form, 'grade', 60), quantity_kg, price_paise_per_kg: price,
      goods_paise: quantity_kg * price, commission_bps,
      pickup_location: text(form, 'pickup_location', 300), delivery_location: text(form, 'delivery_location', 300),
      expected_date: date(form, 'expected_date'), created_by: viewer.userId,
    }).select('id').single());
    id = row.id;
    check(await db.from('order_events').insert({
      order_id: id, kind: 'created', to_status: 'confirmed', actor_id: viewer.userId, actor_label: actorLabel(viewer),
      message: text(form, 'note', 2000) ?? 'Order entered by the Agrimate team.',
    }));
  });
  if (result?.error) return result;
  revalidatePath('/orders');
  redirect(`/orders/${id}`);
}

// ---- Documents: the browser uploads straight to Supabase Storage with a one-time signed URL ---------------------

const DOC_KINDS = Object.keys(DOC_KIND_LABEL) as DocKind[];
const MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

export async function startUpload(input: { orderId: string; kind: string; fileName: string; contentType: string; size: number }) {
  const r = await run(async () => {
    const { order } = await orderForViewer(input.orderId);
    if (!DOC_KINDS.includes(input.kind as DocKind)) fail('Choose a document type.');
    if (!MIME.includes(input.contentType)) fail('Upload a photo (JPG, PNG, WebP, HEIC) or a PDF.');
    if (!(input.size > 0 && input.size <= 10 * 1024 * 1024)) fail('Files must be under 10 MB.');
    const path = `${order.id}/${randomUUID()}`;
    const { data, error } = await adminClient().storage.from('documents').createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error('no upload url');
    return JSON.stringify({ path: data.path, token: data.token });
  });
  if (r?.error) return { error: r.error };
  return JSON.parse(r!.ok!) as { path: string; token: string };
}

export async function finishUpload(input: { orderId: string; kind: string; fileName: string; path: string }) {
  return run(async () => {
    const { viewer, order } = await orderForViewer(input.orderId);
    if (!DOC_KINDS.includes(input.kind as DocKind)) fail('Choose a document type.');
    // The path must be one we issued for this order: "<order id>/<uuid>".
    if (!new RegExp(`^${order.id}/[0-9a-f-]{36}$`).test(input.path)) fail('Invalid upload.');
    const db = adminClient();
    const { data: exists } = await db.storage.from('documents').exists(input.path);
    if (!exists) fail('The upload did not finish. Please try again.');
    const fileName = input.fileName.replace(/[^\w.\- ()]/g, '_').slice(0, 200) || 'file';
    check(await db.from('documents').insert({
      order_id: order.id, kind: input.kind, file_name: fileName, storage_path: input.path, uploaded_by: viewer.userId,
    }));
    await addEvent(order.id, viewer, 'document', `${DOC_KIND_LABEL[input.kind as DocKind]} uploaded: ${fileName}`);
    done(order.id);
    return 'Uploaded.';
  });
}
