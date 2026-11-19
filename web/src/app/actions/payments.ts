'use server';

import { revalidatePath } from 'next/cache';
import { requireViewer } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { check, fail, run } from '@/lib/action';
import { env } from '@/lib/env';
import { orderTotals } from '@/lib/orders';
import { createOrder, fetchPayment, verifyCheckoutSignature } from '@/lib/razorpay';
import type { Order, Payment } from '@/lib/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Buyer starts an online payment. The amount is checked against what is still owed, on the server. */
export async function startRazorpayPayment(orderId: string, amountPaise: number) {
  const r = await run(async () => {
    if (!env.razorpayEnabled) fail('Online payments are not set up yet. Please pay by bank transfer.');
    if (!UUID.test(orderId) || !Number.isInteger(amountPaise)) fail('Invalid request.');
    const viewer = await requireViewer();
    const db = adminClient();
    const { data: order } = await db.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (!order || order.buyer_id !== viewer.party?.id) fail('Only the buyer on this order can pay online.');
    if (order.status === 'cancelled') fail('This order is cancelled.');
    const { data: payments } = await db.from('payments').select('*').eq('order_id', orderId);
    const { buyerBalance } = orderTotals(order as Order, (payments ?? []) as Payment[]);
    if (buyerBalance <= 0) fail('Nothing is due on this order.');
    if (amountPaise < 100 || amountPaise > buyerBalance) fail('Enter an amount between ₹1 and the balance due.');

    const rzp = await createOrder(amountPaise, order.code, { order_id: order.id, order_code: order.code });
    check(await db.from('razorpay_orders').insert({
      id: rzp.id, order_id: order.id, amount_paise: amountPaise, created_by: viewer.userId,
    }));
    return JSON.stringify({
      keyId: env.razorpayKeyId,
      razorpayOrderId: rzp.id,
      amount: amountPaise,
      orderCode: order.code,
      name: viewer.party?.name ?? '',
      email: viewer.email,
    });
  });
  if (r?.error) return { error: r.error };
  return JSON.parse(r!.ok!) as {
    keyId: string; razorpayOrderId: string; amount: number; orderCode: string; name: string; email: string;
  };
}

/** Checkout's success callback. Never trusts the browser: checks the signature, then asks Razorpay directly. */
export async function confirmRazorpayPayment(input: {
  orderId: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string;
}) {
  return run(async () => {
    await requireViewer();
    const { razorpay_order_id: rzpOrder, razorpay_payment_id: paymentId, razorpay_signature: sig } = input;
    if (![rzpOrder, paymentId, sig].every((v) => typeof v === 'string' && v.length > 0 && v.length < 200)) fail('Invalid payment response.');
    if (!verifyCheckoutSignature(rzpOrder, paymentId, sig)) fail('Payment could not be verified. If money left your account, contact us with the payment ID.');

    const payment = await fetchPayment(paymentId);
    if (payment.order_id !== rzpOrder) fail('Payment does not match this order.');
    if (payment.status === 'authorized') {
      return 'Payment authorised. It will show here as soon as Razorpay captures it (usually within minutes).';
    }
    if (payment.status !== 'captured') fail(`Payment is ${payment.status}. Please try again.`);

    check(await adminClient().rpc('record_razorpay_payment', {
      p_razorpay_order: rzpOrder, p_payment_id: paymentId, p_amount: payment.amount,
    }));
    revalidatePath(`/orders/${input.orderId}`);
    return 'Payment received. Thank you!';
  });
}
