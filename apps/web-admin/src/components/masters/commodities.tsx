'use client';
import { useMemo, useState, type FormEvent } from 'react';
import type { Commodity, GradeRef } from '@agrimate/api-client';
import { Alert, Badge, Button, EmptyState, Field, Input, Table, Td, cn } from '@agrimate/ui';
import { api, errorMessage, handleAuthError } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { InlineSuccess, Q, Section } from '@/components/console';

interface ParamRow { key: string; label: string; unit: string; min: string; max: string; required: boolean }
const blankParam = (): ParamRow => ({ key: '', label: '', unit: '', min: '', max: '', required: true });

const toRows = (g: GradeRef): ParamRow[] => g.parameters.map((p) => ({ key: p.key, label: p.label, unit: p.unit, min: p.min?.toString() ?? '', max: p.max?.toString() ?? '', required: p.required }));

/** Returns the error for a row, or null. The API rejects unknown fields, so the payload is built field by field. */
function paramError(p: ParamRow, all: ParamRow[]): string | null {
  if (!/^[a-z][a-zA-Z0-9_]*$/.test(p.key)) return 'Key must start with a lowercase letter and use only letters, digits and underscores';
  if (all.filter((x) => x.key === p.key).length > 1) return 'Keys must be unique within a grade';
  if (!p.label.trim()) return 'Label is required';
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const min = num(p.min); const max = num(p.max);
  if (min !== undefined && !Number.isFinite(min)) return 'Min must be a number';
  if (max !== undefined && !Number.isFinite(max)) return 'Max must be a number';
  if (min !== undefined && max !== undefined && min > max) return 'Min cannot be above max';
  return null;
}
function toPayload(p: ParamRow) {
  return { key: p.key, label: p.label.trim(), unit: p.unit.trim(), required: p.required, ...(p.min.trim() !== '' ? { min: Number(p.min) } : {}), ...(p.max.trim() !== '' ? { max: Number(p.max) } : {}) };
}

export function Commodities() {
  const q = useLoad(() => api.get<Commodity[]>('/masters/commodities'), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <>
      {flash && <InlineSuccess onDismiss={() => setFlash(null)}>{flash}</InlineSuccess>}
      <Q q={q} isEmpty={(d) => d.length === 0} emptyTitle="No commodities" emptyBody={<AddCommodity onDone={async (m) => { setFlash(m); await q.reload(); }} />}>
        {(rows) => {
          const current = rows.find((c) => c.id === selected) ?? rows[0]!;
          return (
            <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
              <div>
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <ul aria-label="Commodities">
                    {rows.map((c) => (
                      <li key={c.id} className="border-b border-slate-100 last:border-0">
                        <button type="button" aria-current={c.id === current.id ? 'true' : undefined} onClick={() => setSelected(c.id)} className={cn('flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-700', c.id === current.id ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50')}>
                          <span>{c.name}</span><span className="text-xs text-slate-500">{c.grades.length} grade{c.grades.length === 1 ? '' : 's'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-4"><AddCommodity onDone={async (m) => { setFlash(m); await q.reload(); }} /></div>
              </div>
              <div className="min-w-0"><Grades key={current.id} commodity={current} onChanged={async (m) => { setFlash(m); await q.reload(); }} /></div>
            </div>
          );
        }}
      </Q>
    </>
  );
}

function AddCommodity({ onDone }: { onDone: (message: string) => Promise<void> }) {
  const [code, setCode] = useState(''); const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const codeOk = /^[A-Z_]+$/.test(code);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/masters/commodities', { code, name: name.trim() });
      setCode(''); setName('');
      await onDone(`${name.trim()} added. Add a grade before it can be traded.`);
    } catch (err) { handleAuthError(err); setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-left">
      <h3 className="text-sm font-semibold text-slate-900">Add a commodity</h3>
      <Field label="Code" error={code && !codeOk ? 'Use capital letters and underscores only' : undefined}><Input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
      <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {error && <Alert tone="red" role="alert">{error}</Alert>}
      <Button type="submit" size="sm" variant="secondary" disabled={busy || !codeOk || !name.trim()}>{busy ? 'Adding…' : 'Add commodity'}</Button>
    </form>
  );
}

function Grades({ commodity, onChanged }: { commodity: Commodity; onChanged: (message: string) => Promise<void> }) {
  const [editing, setEditing] = useState<GradeRef | 'new' | null>(null);
  return (
    <Section title={`Grades of ${commodity.name}`} actions={!editing && <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>Add grade</Button>}>
      {commodity.grades.length === 0 ? <EmptyState title="No grades yet">Buyers and farmers cannot trade this commodity until it has a grade.</EmptyState> : (
        <Table head={['Code', 'Name', 'Parameters', '']}>
          {commodity.grades.map((g) => (
            <tr key={g.id}>
              <Td className="font-mono text-xs">{g.code}</Td>
              <Td>{g.name}</Td>
              <Td>
                <ul className="space-y-0.5 text-xs">
                  {g.parameters.map((p) => (
                    <li key={p.key}>{p.label}: {p.min ?? '—'} to {p.max ?? '—'} {p.unit} {p.required ? '' : <Badge>Optional</Badge>}</li>
                  ))}
                </ul>
              </Td>
              <Td><Button size="sm" variant="secondary" onClick={() => setEditing(g)}>Edit</Button></Td>
            </tr>
          ))}
        </Table>
      )}
      {editing && (
        <GradeForm
          key={editing === 'new' ? 'new' : editing.id}
          commodityId={commodity.id} grade={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={async (m) => { setEditing(null); await onChanged(m); }}
        />
      )}
    </Section>
  );
}

function GradeForm({ commodityId, grade, onCancel, onSaved }: { commodityId: string; grade: GradeRef | null; onCancel: () => void; onSaved: (message: string) => Promise<void> }) {
  const [code, setCode] = useState(grade?.code ?? '');
  const [name, setName] = useState(grade?.name ?? '');
  const [rows, setRows] = useState<ParamRow[]>(() => (grade ? toRows(grade) : [blankParam()]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = useMemo(() => rows.map((r) => paramError(r, rows)), [rows]);
  const codeOk = /^[A-Z0-9_]+$/.test(code);
  const valid = codeOk && !!name.trim() && rows.length > 0 && errors.every((e) => !e);
  const set = (i: number, patch: Partial<ParamRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true); setError(null);
    const body = { code, name: name.trim(), parameters: rows.map(toPayload) };
    try {
      if (grade) await api.put(`/masters/grades/${grade.id}`, body);
      else await api.post(`/masters/commodities/${commodityId}/grades`, body);
      await onSaved(`Grade ${body.name} saved.`);
    } catch (err) { handleAuthError(err); setError(errorMessage(err)); setBusy(false); }
  };

  const cell = 'h-8 px-2 text-sm';
  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-lg border border-slate-300 bg-white p-4" aria-label={grade ? `Edit grade ${grade.name}` : 'Add grade'}>
      <h3 className="text-sm font-semibold text-slate-900">{grade ? `Edit ${grade.name}` : 'Add a grade'}</h3>
      {grade && <Alert>Grade specs are read live. Orders on this grade that have not been inspected yet will be checked against the edited parameters.</Alert>}
      <div className="grid max-w-lg grid-cols-2 gap-3">
        <Field label="Code" error={code && !codeOk ? 'Capital letters, digits and underscores only' : undefined}><Input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
        <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Grade parameters</caption>
          <thead className="text-xs text-slate-600"><tr>{['Key', 'Label', 'Unit', 'Min', 'Max', 'Required', ''].map((h, i) => <th key={i} scope="col" className="px-1 py-1 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="align-top">
                <td className="p-1"><Input aria-label={`Parameter ${i + 1} key`} className={cell} value={r.key} onChange={(e) => set(i, { key: e.target.value })} />{errors[i] && <p role="alert" className="mt-0.5 max-w-xs text-xs text-red-700">{errors[i]}</p>}</td>
                <td className="p-1"><Input aria-label={`Parameter ${i + 1} label`} className={cell} value={r.label} onChange={(e) => set(i, { label: e.target.value })} /></td>
                <td className="w-20 p-1"><Input aria-label={`Parameter ${i + 1} unit`} className={cell} value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} /></td>
                <td className="w-24 p-1"><Input aria-label={`Parameter ${i + 1} minimum`} inputMode="decimal" className={cell} value={r.min} onChange={(e) => set(i, { min: e.target.value })} /></td>
                <td className="w-24 p-1"><Input aria-label={`Parameter ${i + 1} maximum`} inputMode="decimal" className={cell} value={r.max} onChange={(e) => set(i, { max: e.target.value })} /></td>
                <td className="w-20 p-1 text-center"><input type="checkbox" aria-label={`Parameter ${i + 1} required`} className="mt-2 h-4 w-4 accent-emerald-700" checked={r.required} onChange={(e) => set(i, { required: e.target.checked })} /></td>
                <td className="w-20 p-1"><Button type="button" variant="ghost" size="sm" disabled={rows.length === 1} aria-label={`Remove parameter ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, blankParam()])}>Add parameter</Button>
      {error && <Alert tone="red" role="alert">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !valid}>{busy ? 'Saving…' : 'Save grade'}</Button>
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onCancel}>Discard</Button>
      </div>
    </form>
  );
}
