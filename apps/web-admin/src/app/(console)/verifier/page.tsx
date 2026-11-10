'use client';
/**
 * Quality verifier desk. The same job flow as the inspector app: GPS check-in at the pickup point, then the grading
 * form with photos and scale weight, then close the inspection. The API enforces every step; this page explains them.
 */
import { useMemo, useState } from 'react';
import type { InspectorJob } from '@agrimate/api-client';
import { checkReadings, type GradeParameter } from '@agrimate/shared';
import { Alert, Badge, Button, Card, Field, Input, Table, Td, cn, humanise } from '@agrimate/ui';
import { api, errorMessage, handleAuthError } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { ConfirmDialog, Ist, PageHeader, Q, Section, Tabs } from '@/components/console';
import { currentPosition, FilePick, kg, Stat, type UploadedFile } from '@/components/field-tools';
import { useMe } from '@/components/shell';

const STATUS_TONE: Record<string, string> = { ASSIGNED: 'amber', CHECKED_IN: 'blue', INSPECTED: 'green', FAILED_GRADE: 'red', UNASSIGNED: 'slate', WAIVED_SELF_CERT: 'slate' };
const ACTIVE = ['ASSIGNED', 'CHECKED_IN'];
type View = 'active' | 'done' | 'all';

const istDay = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function VerifierDesk() {
  const me = useMe();
  const jobs = useLoad(() => api.get<InspectorJob[]>('/inspector/jobs'), []);
  const [view, setView] = useState<View>('active');
  const [openId, setOpenId] = useState<string | null>(null);

  const list = jobs.data ?? [];
  const today = istDay(new Date());
  const counts = {
    today: list.filter((j) => istDay(j.scheduledFor) === today && ACTIVE.includes(j.status)).length,
    waiting: list.filter((j) => j.status === 'ASSIGNED').length,
    inField: list.filter((j) => j.status === 'CHECKED_IN').length,
    passed: list.filter((j) => j.status === 'INSPECTED').length,
    failed: list.filter((j) => j.status === 'FAILED_GRADE').length,
  };
  const shown = list.filter((j) => (view === 'all' ? true : view === 'active' ? ACTIVE.includes(j.status) : !ACTIVE.includes(j.status)));
  const open = list.find((j) => j.id === openId) ?? null;
  const status = me.inspector?.status ?? 'NOT_SUBMITTED';

  return (
    <>
      <PageHeader title={`Quality check desk`} description={`Signed in as ${me.name}. Inspect stock at the pickup point and record its grade before it ships.`} actions={<Button variant="secondary" size="sm" onClick={() => void jobs.reload()}>Refresh</Button>} />

      {status !== 'VERIFIED' && (
        <Alert tone="amber" className="mb-4">
          Your verifier account is <strong>{humanise(status).toLowerCase()}</strong>{me.inspector?.statusNote ? `: ${me.inspector.statusNote}` : ''}. Jobs are only assigned once an admin approves your qualification.
        </Alert>
      )}
      {status === 'VERIFIED' && me.inspector && !me.inspector.available && (
        <Alert tone="blue" className="mb-4">You are marked as unavailable, so no new jobs will be assigned to you. Switch availability on in the inspector app.</Alert>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Due today" value={counts.today} tone="sky" />
        <Stat label="Awaiting check-in" value={counts.waiting} tone="amber" />
        <Stat label="In the field" value={counts.inField} tone="sky" />
        <Stat label="Passed" value={counts.passed} tone="emerald" />
        <Stat label="Failed grade" value={counts.failed} tone={counts.failed ? 'red' : 'slate'} />
      </div>

      {open && <JobPanel key={open.id} job={open} onClose={() => setOpenId(null)} onChanged={() => void jobs.reload()} />}

      <Section title="Jobs" actions={<Tabs label="Filter jobs" value={view} onChange={setView} items={[{ key: 'active', label: 'Active', count: counts.waiting + counts.inField }, { key: 'done', label: 'Completed' }, { key: 'all', label: 'All' }]} />}>
        <Q q={jobs} rows={4} isEmpty={() => shown.length === 0} emptyTitle={view === 'active' ? 'No active jobs' : 'Nothing here yet'} emptyBody="New inspections appear here when an order you are assigned to is funded.">
          {() => (
            <Table head={['Order', 'Produce', 'Quantity', 'Pickup PIN', 'Scheduled', 'Status', '']}>
              {shown.map((j) => (
                <tr key={j.id} className={cn(j.id === openId && 'bg-emerald-50/60')}>
                  <Td className="font-medium">{j.orderCode}</Td>
                  <Td>{j.commodity} <span className="text-slate-500">· {j.grade}</span></Td>
                  <Td className="tabular-nums">{kg(j.quantityKg)}</Td>
                  <Td className="tabular-nums">{j.pickupPin}</Td>
                  <Td><Ist at={j.scheduledFor} /></Td>
                  <Td><Badge tone={STATUS_TONE[j.status] ?? 'slate'}>{humanise(j.status)}</Badge></Td>
                  <Td className="text-right"><Button size="sm" variant={ACTIVE.includes(j.status) ? 'primary' : 'secondary'} onClick={() => setOpenId(j.id)}>{ACTIVE.includes(j.status) ? 'Work on it' : 'View'}</Button></Td>
                </tr>
              ))}
            </Table>
          )}
        </Q>
      </Section>
    </>
  );
}

function JobPanel({ job, onClose, onChanged }: { job: InspectorJob; onClose: () => void; onChanged: () => void }) {
  const params = job.parameters as unknown as GradeParameter[];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(params.map((p) => [p.key, job.readings?.[p.key] !== undefined ? String(job.readings[p.key]) : ''])));
  const [weight, setWeight] = useState(job.scaleWeightKg ? String(job.scaleWeightKg) : '');
  const [photos, setPhotos] = useState<UploadedFile[]>(() => job.photoFileIds.map((id, i) => ({ id, name: `Saved photo ${i + 1}` })));

  const readings = useMemo(() => Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)])), [values]);
  const check = useMemo(() => checkReadings(params, readings), [params, readings]);
  const editable = job.status === 'CHECKED_IN';
  const graded = !!job.readings && !!job.scaleWeightKg && job.photoFileIds.length > 0;

  async function act(name: string, fn: () => Promise<string | void>) {
    setBusy(name); setError(null); setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      onChanged();
    } catch (e) { handleAuthError(e); setError(errorMessage(e)); } finally { setBusy(null); }
  }

  const checkIn = () => act('checkin', async () => {
    const pos = await currentPosition();
    await api.post(`/inspections/${job.id}/check-in`, pos);
    return 'Checked in at the pickup point. Fill in the grading form next.';
  });

  const saveGrading = () => act('grading', async () => {
    const w = Number(weight);
    if (!Number.isInteger(w) || w < 1) throw new Error('Enter the scale weight in whole kilograms.');
    if (!photos.length) throw new Error('Add at least one photo of the sample and the stock.');
    if (check.missing.length) throw new Error(`Fill in: ${check.missing.map((k) => params.find((p) => p.key === k)?.label ?? k).join(', ')}.`);
    await api.post(`/inspections/${job.id}/grading`, { readings, scaleWeightKg: w, photoFileIds: photos.map((p) => p.id) });
    return check.ok ? 'Grading saved. Everything is within spec.' : 'Grading saved. Some readings are out of spec, so closing will fail the grade.';
  });

  const markInspected = () => act('mark', async () => {
    const r = await api.post<{ result: string; outOfSpec?: string[] }>(`/inspections/${job.id}/mark-inspected`);
    return r.result === 'INSPECTED' ? 'Inspection closed. The stock passed and can be dispatched.' : `Inspection closed as failed grade (${(r.outOfSpec ?? []).join(', ')}). The buyer and ops have been told.`;
  });

  const steps = [
    { label: 'Check in at pickup', done: !!job.checkInAt },
    { label: 'Record grade, weight and photos', done: graded },
    { label: 'Close inspection', done: job.status === 'INSPECTED' || job.status === 'FAILED_GRADE' },
  ];

  return (
    <Card className="mb-6 border-emerald-200">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Order {job.orderCode}</p>
          <h2 className="text-lg font-semibold text-slate-900">{job.commodity} · {job.grade}</h2>
          <p className="text-sm text-slate-600">{kg(job.quantityKg)} at PIN {job.pickupPin} · scheduled <Ist at={job.scheduledFor} /></p>
        </div>
        <div className="flex gap-2">
          <a className="inline-flex h-8 items-center rounded-md border border-slate-300 px-3 text-sm text-slate-800 hover:bg-slate-50" href={`https://www.google.com/maps/dir/?api=1&destination=${job.pickupLat},${job.pickupLng}`} target="_blank" rel="noreferrer">Directions</a>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>

      <ol className="mb-5 grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.label} className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm', s.done ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 text-slate-700')}>
            <span aria-hidden className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold', s.done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700')}>{s.done ? '✓' : i + 1}</span>
            {s.label}<span className="sr-only">{s.done ? ' (done)' : ''}</span>
          </li>
        ))}
      </ol>

      {notice && <Alert tone="green" role="status" className="mb-4">{notice}</Alert>}
      {error && <Alert tone="red" role="alert" className="mb-4">{error}</Alert>}

      {job.status === 'ASSIGNED' && (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-4">
          <p className="mb-3 text-sm text-slate-700">Check in when you are at the pickup point. Your browser will share your location once, and the API checks you are close enough.</p>
          <Button onClick={() => void checkIn()} disabled={!!busy}>{busy === 'checkin' ? 'Getting your location…' : 'Check in here'}</Button>
        </div>
      )}

      {(editable || job.readings) && (
        <form onSubmit={(e) => { e.preventDefault(); void saveGrading(); }} className="space-y-4">
          <fieldset disabled={!editable || !!busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold text-slate-900">Grade readings</legend>
            {params.map((p) => {
              const range = p.min !== undefined && p.max !== undefined ? `${p.min} to ${p.max}` : p.min !== undefined ? `at least ${p.min}` : p.max !== undefined ? `at most ${p.max}` : 'any value';
              const out = check.outOfSpec.includes(p.key);
              return (
                <Field key={p.key} label={`${p.label} (${p.unit})${p.required ? '' : ' · optional'}`} hint={`Spec: ${range}`} error={out ? 'Out of spec' : undefined}>
                  <Input type="number" step="any" inputMode="decimal" required={p.required} value={values[p.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))} className={cn(out && 'border-red-400')} />
                </Field>
              );
            })}
            <Field label="Scale weight (kg)" hint={`Ordered: ${kg(job.quantityKg)}`}>
              <Input type="number" min={1} step={1} inputMode="numeric" required value={weight} onChange={(e) => setWeight(e.target.value)} />
            </Field>
          </fieldset>
          {editable && <FilePick label="Sample and stock photos" hint="At least one. Include the scale display and the sample." purpose="INSPECTION_PHOTO" orderId={job.orderId} files={photos} onChange={setPhotos} disabled={!!busy} />}
          {Object.keys(readings).length > 0 && (
            <p className={cn('text-sm', check.ok ? 'text-emerald-800' : 'text-red-700')}>{check.ok ? 'All readings are within the grade spec.' : `Out of spec: ${check.outOfSpec.map((k) => params.find((p) => p.key === k)?.label ?? k).join(', ') || 'none'}${check.missing.length ? `. Missing: ${check.missing.length}` : ''}.`}</p>
          )}
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="secondary" disabled={!!busy}>{busy === 'grading' ? 'Saving…' : 'Save grading'}</Button>
              <Button type="button" onClick={() => void markInspected()} disabled={!!busy || !graded}>{busy === 'mark' ? 'Closing…' : 'Close inspection'}</Button>
              {!graded && <span className="self-center text-xs text-slate-500">Save the grading before closing.</span>}
            </div>
          )}
        </form>
      )}

      {ACTIVE.includes(job.status) && (
        <div className="mt-5 border-t border-slate-200 pt-4">
          <Button variant="ghost" size="sm" className="text-red-700" disabled={!!busy} onClick={() => setCancelOpen(true)}>I cannot do this inspection</Button>
        </div>
      )}
      {cancelOpen && (
        <ConfirmDialog title={`Give up order ${job.orderCode}?`} confirmLabel="Give up the job" danger onClose={() => setCancelOpen(false)}
          onConfirm={async () => { const r = await api.post<{ reassigned: boolean }>(`/inspections/${job.id}/cancel`); onChanged(); onClose(); void r; }}>
          <p>The job goes to another verifier nearby. If nobody is free, the farmer is asked to self-certify instead. Anything you recorded is discarded.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}
