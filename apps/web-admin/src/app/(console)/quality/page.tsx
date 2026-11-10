'use client';
/** Quality-check board: every stock inspection, who has it, and how it went. Unassigned ones can be handed to a verifier here. */
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Badge, Field, Select, StateBadge, Table, Td, Button, humanise } from '@agrimate/ui';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { ConfirmDialog, Ist, OrderLink, PageHeader, Q } from '@/components/console';
import { kg, Stat } from '@/components/field-tools';
import type { AdminInspection, AdminInspector } from '@/lib/types';

const STATUSES = ['UNASSIGNED', 'ASSIGNED', 'CHECKED_IN', 'INSPECTED', 'FAILED_GRADE', 'WAIVED_SELF_CERT'];
const TONE: Record<string, string> = { UNASSIGNED: 'red', ASSIGNED: 'amber', CHECKED_IN: 'blue', INSPECTED: 'green', FAILED_GRADE: 'red', WAIVED_SELF_CERT: 'slate' };

export default function QualityBoard() {
  const router = useRouter();
  const status = useSearchParams().get('status') ?? '';
  const rows = useLoad(() => api.get<AdminInspection[]>(`/admin/inspections${status ? `?status=${status}` : ''}`), [status]);
  const all = useLoad(() => api.get<AdminInspection[]>('/admin/inspections'), []);
  const inspectors = useLoad(() => api.get<AdminInspector[]>('/admin/inspectors'), []);
  const [assigning, setAssigning] = useState<AdminInspection | null>(null);
  const [inspectorId, setInspectorId] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const count = (s: string) => (all.data ?? []).filter((r) => r.status === s).length;
  const reload = () => { void rows.reload(); void all.reload(); };

  return (
    <>
      <PageHeader title="Quality checks" description="Stock inspections across all orders, earliest first. Verifiers check in at the pickup point, grade the stock and record the scale weight." />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Unassigned" value={count('UNASSIGNED')} tone={count('UNASSIGNED') ? 'red' : 'slate'} />
        <Stat label="Assigned" value={count('ASSIGNED')} tone="amber" />
        <Stat label="Verifier on site" value={count('CHECKED_IN')} tone="sky" />
        <Stat label="Passed" value={count('INSPECTED')} tone="emerald" />
        <Stat label="Failed grade" value={count('FAILED_GRADE')} tone={count('FAILED_GRADE') ? 'red' : 'slate'} />
      </div>

      {done && <Alert tone="green" role="status" className="mb-3">{done}</Alert>}

      <div className="mb-3 w-56">
        <Field label="Status">
          <Select value={status} onChange={(e) => router.replace(e.target.value ? `/quality?status=${e.target.value}` : '/quality')}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
          </Select>
        </Field>
      </div>

      <Q q={rows} isEmpty={(d) => d.length === 0} emptyTitle="No inspections" emptyBody="Inspections are created when the buyer's advance arrives.">
        {(d) => (
          <Table head={['Order', 'Produce', 'Farmer', 'Scheduled', 'Verifier', 'Status', 'Result', '']}>
            {d.map((r) => (
              <tr key={r.id}>
                <Td><OrderLink id={r.orderId} code={r.orderCode} /><div className="mt-0.5"><StateBadge state={r.orderState} /></div></Td>
                <Td>{r.commodity} · {r.grade}<div className="text-xs text-slate-500 tabular-nums">{kg(r.quantityKg)} · PIN {r.pickupPin}</div></Td>
                <Td>{r.farmer}</Td>
                <Td><Ist at={r.scheduledFor} /></Td>
                <Td>{r.inspector ?? <span className="text-slate-500">{r.selfCertRequired ? 'Self-certification' : 'Nobody'}</span>}{r.assignAttempts > 1 && <div className="text-xs text-slate-500">{r.assignAttempts} assignment attempts</div>}</Td>
                <Td><Badge tone={TONE[r.status] ?? 'slate'}>{humanise(r.status)}</Badge>{r.checkInMetres !== null && <div className="text-xs text-slate-500">Checked in {r.checkInMetres} m away</div>}</Td>
                <Td>
                  {r.gradeCheck ? (r.gradeCheck.ok ? <span className="text-emerald-800">Within spec</span> : <span className="text-red-700">Out of spec: {r.gradeCheck.outOfSpec.join(', ')}</span>) : <span className="text-slate-400">—</span>}
                  {r.scaleWeightKg !== null && <div className="text-xs text-slate-500 tabular-nums">Scale {kg(r.scaleWeightKg)}</div>}
                </Td>
                <Td className="text-right">
                  {['UNASSIGNED', 'ASSIGNED'].includes(r.status) && <Button size="sm" variant={r.status === 'UNASSIGNED' ? 'primary' : 'secondary'} onClick={() => { setAssigning(r); setInspectorId(''); setDone(null); }}>{r.status === 'UNASSIGNED' ? 'Assign' : 'Reassign'}</Button>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Q>

      {assigning && (
        <ConfirmDialog title={`Assign a verifier to ${assigning.orderCode}`} confirmLabel="Assign" canConfirm={!!inspectorId} onClose={() => setAssigning(null)}
          onConfirm={async () => {
            await api.post(`/admin/orders/${assigning.orderId}/assign-inspector`, { inspectorId });
            setDone(`Verifier assigned to ${assigning.orderCode}. They have been notified.`);
            reload();
          }}
          extra={
            <Field label="Verifier" hint="Approved verifiers only. Unavailable ones are marked.">
              <Select value={inspectorId} onChange={(e) => setInspectorId(e.target.value)}>
                <option value="">Choose a verifier</option>
                {(inspectors.data ?? []).filter((i) => i.id !== assigning.inspectorId).map((i) => <option key={i.id} value={i.id}>{i.name} · PIN {i.pin ?? '—'}{i.available ? '' : ' (unavailable)'}</option>)}
              </Select>
            </Field>
          }>
          <p>{assigning.commodity} · {assigning.grade}, {kg(assigning.quantityKg)} at PIN {assigning.pickupPin}, scheduled <Ist at={assigning.scheduledFor} />.</p>
          {assigning.selfCertRequired && <p>The farmer is currently asked to self-certify. Assigning a verifier turns that off.</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
