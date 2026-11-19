'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmRazorpayPayment, startRazorpayPayment } from '@/app/actions/payments';
import { buttonClass, cx, Field, FormMessage, Input } from '@/components/ui';
import { IconLock, Spinner } from '@/components/icons';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
  }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay'));
    document.body.appendChild(s);
  });
}

export function PayButton({ orderId, balancePaise }: { orderId: string; balancePaise: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState((balancePaise / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});

  async function pay() {
    setMsg({});
    const paise = Math.round(Number(amount.replace(/,/g, '')) * 100);
    if (!Number.isFinite(paise) || paise < 100 || paise > balancePaise) {
      setMsg({ error: 'Enter an amount between ₹1 and the balance due.' });
      return;
    }
    setBusy(true);
    try {
      const started = await startRazorpayPayment(orderId, paise);
      if ('error' in started) { setMsg({ error: started.error }); setBusy(false); return; }
      await loadCheckout();
      const rzp = new window.Razorpay!({
        key: started.keyId,
        order_id: started.razorpayOrderId,
        amount: started.amount,
        currency: 'INR',
        name: 'Agrimate',
        description: `Order ${started.orderCode}`,
        prefill: { name: started.name, email: started.email },
        theme: { color: '#1f563d' },
        handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          const r = await confirmRazorpayPayment({ orderId, ...resp });
          setMsg(r ?? {});
          setBusy(false);
          router.refresh();
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on('payment.failed', () => setMsg({ error: 'Payment failed. No money was taken, or it will be refunded automatically by your bank.' }));
      rzp.open(); // stays busy until the window closes or the payment completes, so it can't be opened twice
    } catch {
      setMsg({ error: 'Could not start the payment. Please try again.' });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Amount to pay now (₹)" hint="Pay the full balance or an advance.">
        <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
      </Field>
      <button type="button" onClick={pay} disabled={busy} className={cx(buttonClass('primary'), 'h-11 w-full')}>
        {busy ? <Spinner /> : <IconLock />}
        {busy ? 'Opening secure checkout…' : 'Pay online'}
      </button>
      <p className="text-center text-xs text-stone-500">UPI, cards and netbanking, via Razorpay</p>
      <FormMessage error={msg.error} ok={msg.ok} />
    </div>
  );
}
