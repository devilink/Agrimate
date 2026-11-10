'use client';
/** Transport board: every trip request, whether it is funded and visible to partners, who took it, and where it is. */
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge, Field, Money, Select, StateBadge, Table, Td, humanise } from '@agrimate/ui';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { Ist, OrderLink, PageHeader, Q } from '@/components/console';
import { kg, Stat } from '@/components/field-tools';
import type { AdminTrip } from '@/lib/types';

const STATUSES = ['OPEN', 'ACCEPTED', 'PICKED_UP', 'DELIVERED', 'CANCELLED'];
const TONE: Record<string, string> = { OPEN: 'amber', ACCEPTED: 'blue', PICKED_UP: 'blue', DELIVERED: 'green', CANCELLED: 'slate' };

export default function TransportBoard() {
  const router = useRouter();
  const status = useSearchParams().get('status') ?? '';
  const rows = useLoad(() => api.get<AdminTrip[]>(`/admin/trips${status ? `?status=${status}` : ''}`), [status]);
  const all = useLoad(() => api.get<AdminTrip[]>('/admin/trips'), []);
  const list = all.data ?? [];
  const waitingFunds = list.filter((t) => t.status === 'OPEN' && !t.fundedAt).length;
  const openFunded = list.filter((t) => t.status === 'OPEN' && t.fundedAt).length;

  return (
    <>
      <PageHeader title="Transport requests" description="Platform logistics requests, newest first. A request is only offered to transport partners once its freight is fully in escrow." />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Awaiting freight payment" value={waitingFunds} tone="slate" />
        <Stat label="Open, waiting for a truck" value={openFunded} tone={openFunded ? 'amber' : 'slate'} />
        <Stat label="Accepted" value={list.filter((t) => t.status === 'ACCEPTED').length} tone="sky" />
        <Stat label="In transit" value={list.filter((t) => t.status === 'PICKED_UP').length} tone="sky" />
        <Stat label="Delivered" value={list.filter((t) => t.status === 'DELIVERED').length} tone="emerald" />
      </div>

      <div className="mb-3 w-56">
        <Field label="Status">
          <Select value={status} onChange={(e) => router.replace(e.target.value ? `/transport-requests?status=${e.target.value}` : '/transport-requests')}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
          </Select>
        </Field>
      </div>

      <Q q={rows} isEmpty={(d) => d.length === 0} emptyTitle="No transport requests" emptyBody="Requests appear when a buyer books platform logistics on an order.">
        {(d) => (
          <Table head={['Order', 'Load', 'Route', 'Freight', 'Partner', 'Status', 'Progress']}>
            {d.map((t) => (
              <tr key={t.id}>
                <Td><OrderLink id={t.orderId} code={t.orderCode} /><div className="mt-0.5"><StateBadge state={t.orderState} /></div></Td>
                <Td>{t.commodity}<div className="text-xs text-slate-500 tabular-nums">{kg(t.quantityKg)} · {humanise(t.tierCode)}</div></Td>
                <Td className="tabular-nums whitespace-nowrap">{t.pickupPin} → {t.dropPin}<div className="text-xs text-slate-500">{t.distanceKm.toLocaleString('en-IN')} km</div></Td>
                <Td><Money paise={t.finalFreightPaise} /><div className="text-xs text-slate-500">Partner gets <Money paise={t.payoutPaise} /></div></Td>
                <Td>{t.partner ?? <span className="text-slate-500">Not taken</span>}{t.vehicleRegNo && <div className="font-mono text-xs text-slate-500">{t.vehicleRegNo}</div>}</Td>
                <Td>
                  <Badge tone={TONE[t.status] ?? 'slate'}>{humanise(t.status)}</Badge>
                  {t.status === 'OPEN' && <div className="text-xs text-slate-500">{t.fundedAt ? 'Funded, visible to partners' : 'Freight not paid yet'}</div>}
                </Td>
                <Td className="text-xs text-slate-600">
                  {t.deliveredAt ? <>Delivered <Ist at={t.deliveredAt} />{t.podOtpVerified ? ' · code verified' : ' · signature'}</>
                    : t.pickedUpAt ? <>Picked up <Ist at={t.pickedUpAt} /></>
                    : t.acceptedAt ? <>Accepted <Ist at={t.acceptedAt} />{t.ewayBillNumber ? ` · EWB ${t.ewayBillNumber}` : ' · no E-Way bill yet'}</>
                    : <>Requested <Ist at={t.createdAt} /></>}
                  {t.slaDeadlineAt && !t.deliveredAt && <div>SLA <Ist at={t.slaDeadlineAt} /></div>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Q>
    </>
  );
}
