'use client';
import type { BuyerOrder, Tranche } from '@agrimate/api-client';
import { formatINR, formatIST } from '@agrimate/shared';
import { Alert, Button, Card, CardTitle, CopyButton, Money, StateBadge, Table, Td } from '@agrimate/ui';
import { useState } from 'react';
import { FormError } from '@/components/common';
import { api, MOCK_TOOLS } from '@/lib/api';
import { useAction } from '@/lib/hooks';

const TRANCHE_ORDER: Tranche['kind'][] = ['ADVANCE', 'FREIGHT', 'BALANCE'];
const TRANCHE_LABEL: Record<Tranche['kind'], string> = { ADVANCE: 'Advance', FREIGHT: 'Freight', BALANCE: 'Balance' };

const due = (t: Tranche) => { const d = BigInt(t.expectedPaise) - BigInt(t.receivedPaise); return d > 0n ? d : 0n; };

function VanRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <dt className="w-28 shrink-0 text-slate-600">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium break-all text-slate-900 tabular-nums">{value}</dd>
      <dd><CopyButton value={value} label={`Copy`} /></dd>
    </div>
  );
}

export function PaymentCard({ order, onChanged }: { order: BuyerOrder; onChanged: () => Promise<void> }) {
  const tranches = [...order.tranches].sort((a, b) => TRANCHE_ORDER.indexOf(a.kind) - TRANCHE_ORDER.indexOf(b.kind));
  const nextOpen = tranches.find((t) => t.status !== 'PAID');
  const va = order.virtualAccount;
  const sim = useAction();
  const [simNote, setSimNote] = useState<string | null>(null);

  const simulate = () => {
    setSimNote(null);
    void sim.run(async () => {
      const amount = nextOpen ? formatINR(due(nextOpen)) : '';
      await api.post(`/dev/mock-bank/orders/${order.id}/credit`);
      await onChanged();
      setSimNote(`Simulated NEFT credit of ${amount} sent.`);
    });
  };

  return (
    <Card>
      <CardTitle>Payment</CardTitle>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <h3 className="mb-1 text-sm font-medium text-slate-800">Pay by NEFT or RTGS to this account</h3>
          {!va && <p className="text-sm text-slate-600">The account appears once the order is matched.</p>}
          {va && (
            <>
              <dl className="divide-y divide-slate-100">
                <VanRow label="Beneficiary" value={va.beneficiary} />
                <VanRow label="Account no" value={va.accountNumber} />
                <VanRow label="IFSC" value={va.ifsc} />
              </dl>
              {va.closedAt && <p className="mt-1 text-xs text-slate-600">This account closed on {formatIST(va.closedAt)}. Do not send more money to it.</p>}
            </>
          )}
        </div>
        <div className="min-w-0">
          <Table head={['Tranche', 'Amount', 'Received', 'Status', 'Paid on']}>
            {tranches.map((t) => (
              <tr key={t.kind}>
                <Td>{TRANCHE_LABEL[t.kind]}</Td>
                <Td className="whitespace-nowrap"><Money paise={t.expectedPaise} /></Td>
                <Td className="whitespace-nowrap"><Money paise={t.receivedPaise} /></Td>
                <Td><StateBadge state={t.status} /></Td>
                <Td className="text-xs whitespace-nowrap text-slate-600">{t.paidAt ? formatIST(t.paidAt) : '—'}</Td>
              </tr>
            ))}
          </Table>
          <dl className="mt-2 flex flex-wrap justify-between gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-2"><dt className="text-slate-600">In escrow</dt><dd className="font-semibold"><Money paise={order.escrowPaise} /></dd></div>
            {nextOpen && <div className="flex gap-2"><dt className="text-slate-600">Next due: {TRANCHE_LABEL[nextOpen.kind].toLowerCase()}</dt><dd className="font-semibold"><Money paise={due(nextOpen)} /></dd></div>}
            {order.buyerRefundPaise !== '0' && <div className="flex gap-2"><dt className="text-slate-600">Refunded to you</dt><dd className="font-semibold"><Money paise={order.buyerRefundPaise} /></dd></div>}
          </dl>
        </div>
      </div>

      {MOCK_TOOLS && va && nextOpen && !va.closedAt && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-sm">
          <span className="font-medium text-slate-700">Development tool</span>
          <Button variant="secondary" size="sm" disabled={sim.busy} onClick={simulate}>{sim.busy ? 'Crediting' : `Simulate NEFT for ${TRANCHE_LABEL[nextOpen.kind].toLowerCase()} (${formatINR(due(nextOpen))})`}</Button>
          {order.state === 'LOGISTICS_PENDING' && !order.logisticsMode && nextOpen.kind === 'BALANCE' && <span className="text-xs text-slate-600">Choose logistics first if you want freight to be collected before the balance.</span>}
          {simNote && <span role="status" className="text-xs text-emerald-800">{simNote}</span>}
          <div className="w-full empty:hidden"><FormError message={sim.error} /></div>
        </div>
      )}
      {order.state === 'BUYER_DEFAULTED' && <Alert tone="red" className="mt-4">The balance was not paid by the deadline, so this order is under admin review.</Alert>}
    </Card>
  );
}
