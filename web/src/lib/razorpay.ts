import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

const API = 'https://api.razorpay.com/v1';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString('base64');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[razorpay]', res.status, body);
    throw new Error(`Razorpay request failed (${res.status})`);
  }
  return body as T;
}

export interface RazorpayOrder { id: string; amount: number; currency: string; status: string }
export interface RazorpayPayment { id: string; order_id: string | null; amount: number; currency: string; status: string }

export function createOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
  return call<RazorpayOrder>('/orders', {
    method: 'POST',
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: receipt.slice(0, 40), notes }),
  });
}

export function fetchPayment(paymentId: string) {
  return call<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`);
}

function safeEqualHex(expectedHex: string, given: string): boolean {
  const a = Buffer.from(expectedHex, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checkout success callback: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  const expected = createHmac('sha256', env.razorpayKeySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Webhook: signature = HMAC_SHA256(raw request body, webhook secret). */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const expected = createHmac('sha256', env.razorpayWebhookSecret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}
