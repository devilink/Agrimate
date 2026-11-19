import { NextResponse, type NextRequest } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { verifyWebhookSignature } from '@/lib/razorpay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Razorpay calls this for payment.captured (subscribe to that event in the Razorpay dashboard). It's the safety net
 * for buyers who close the tab before the browser callback runs. Recording is idempotent, so both paths can fire.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text(); // the signature covers the exact bytes, so read them before parsing
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  if (!signature || !verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  let event: { event?: string; payload?: { payment?: { entity?: { id: string; order_id: string | null; amount: number; status: string } } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const payment = event.payload?.payment?.entity;
  if (event.event !== 'payment.captured' || !payment?.order_id || payment.status !== 'captured') {
    return NextResponse.json({ ignored: true });
  }

  const db = adminClient();
  const { data: known } = await db.from('razorpay_orders').select('id').eq('id', payment.order_id).maybeSingle();
  if (!known) return NextResponse.json({ ignored: 'not an Agrimate order' });

  const { error } = await db.rpc('record_razorpay_payment', {
    p_razorpay_order: payment.order_id, p_payment_id: payment.id, p_amount: payment.amount,
  });
  if (error) {
    console.error('[razorpay webhook]', error);
    // 500 makes Razorpay retry later.
    return NextResponse.json({ error: 'could not record' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
