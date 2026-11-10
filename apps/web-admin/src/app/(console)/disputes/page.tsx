'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Field, Money, Select, StateBadge, Table, Td, humanise } from '@agrimate/ui';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { Ist, OrderLink, PageHeader, Q } from '@/components/console';
import type { AdminDispute } from '@/lib/types';

export default function DisputesPage() {
  const router = useRouter();
  const status = useSearchParams().get('status') ?? 'OPEN';
  const list = useLoad(() => api.get<AdminDispute[]>(`/admin/disputes${status ? `?status=${status}` : ''}`), [status]);
  return (
    <>
      <PageHeader title="Disputes" description="Raised by buyers during the dispute window, or opened by a failed spot test." />
      <div className="mb-3 w-48">
        <Field label="Status">
          <Select value={status} onChange={(e) => router.replace(`/disputes?status=${e.target.value}`)}>
            <option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="">All</option>
          </Select>
        </Field>
      </div>
      <Q q={list} isEmpty={(d) => d.length === 0} emptyTitle={status === 'OPEN' ? 'No open disputes' : 'No disputes match'}>
        {(rows) => (
          <Table head={['Dispute', 'Order', 'Status', 'Weights', 'Discrepancy', 'GMV', 'Outcome', 'Raised']}>
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50">
                <Td><Link href={`/disputes/${d.id}`} className="font-medium text-emerald-800 underline underline-offset-2">{humanise(d.type)}</Link><span className="block max-w-64 truncate text-xs text-slate-500">{d.reason}</span></Td>
                <Td><OrderLink id={d.orderId} code={d.order.code} /></Td>
                <Td><StateBadge state={d.status} /></Td>
                <Td className="whitespace-nowrap tabular-nums">{d.order.dispatchedWeightKg ?? '—'} to {d.order.receivedWeightKg ?? '—'} kg</Td>
                <Td className="tabular-nums">{d.discrepancyPercent != null ? `${d.discrepancyPercent}%` : '—'}</Td>
                <Td><Money paise={d.order.gmvPaise} /></Td>
                <Td>{d.outcome ? humanise(d.outcome) : '—'}</Td>
                <Td><Ist at={d.createdAt} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Q>
    </>
  );
}
