'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Input, Select, Table, Td, humanise } from '@agrimate/ui';
import { formatINR } from '@agrimate/shared';
import { api } from '@/lib/api';
import { paiseToRupees, rupeesToPaise } from '@/lib/money';
import { useLoad } from '@/lib/use-load';
import { ConfirmDialog, InlineSuccess, Q } from '@/components/console';
import type { PlatformConfig } from '@/lib/types';

type Kind = 'bps' | 'paise' | 'int' | 'bool' | 'enum' | 'text';
/** snapshot: copied onto each order at creation. live: read when used, so a change reaches open orders too. */
interface Meta { label: string; kind: Kind; unit?: string; options?: string[]; applies: 'snapshot' | 'live'; warning?: string }

const META: Record<string, Meta> = {
  advanceBps: { label: 'Advance share', kind: 'bps', applies: 'snapshot' },
  commissionBps: { label: 'Commission', kind: 'bps', applies: 'snapshot' },
  freightMarkupBps: { label: 'Freight markup', kind: 'bps', applies: 'snapshot' },
  loadingFeePaise: { label: 'Loading fee', kind: 'paise', applies: 'live', warning: 'Read when freight is quoted. Trips already quoted keep their fee.' },
  rfqSlaDays: { label: 'RFQ SLA', kind: 'int', unit: 'days', applies: 'snapshot' },
  catalogSlaDays: { label: 'Catalog SLA', kind: 'int', unit: 'days', applies: 'snapshot' },
  slaEndOfDay: { label: 'SLA runs to end of IST day', kind: 'bool', applies: 'live' },
  disputeWindowHours: { label: 'Dispute window', kind: 'int', unit: 'hours', applies: 'snapshot' },
  spotTestExtensionHours: { label: 'Spot test extension', kind: 'int', unit: 'hours', applies: 'live' },
  inspectionFeePayer: { label: 'Inspection fee payer', kind: 'enum', options: ['FARMER', 'BUYER'], applies: 'snapshot' },
  inspectorShareBps: { label: 'Inspector share of fee', kind: 'bps', applies: 'live', warning: 'Read when the inspector is paid.' },
  waiveInspectionFeeOnSelfCert: { label: 'Waive inspection fee on self-certification', kind: 'bool', applies: 'live', warning: 'Read at settlement.' },
  checkInRadiusMetres: { label: 'Inspector check-in radius', kind: 'int', unit: 'm', applies: 'live' },
  selfCertRadiusMetres: { label: 'Self-certification radius', kind: 'int', unit: 'm', applies: 'live' },
  selfCertFallbackHours: { label: 'Self-certification fallback', kind: 'int', unit: 'hours before', applies: 'live' },
  selfCertSessionMinutes: { label: 'Self-certification session', kind: 'int', unit: 'minutes', applies: 'live' },
  inspectorMaxJobsPerDay: { label: 'Inspector jobs per day', kind: 'int', applies: 'live' },
  inspectorRetryHours: { label: 'Inspector assignment retry', kind: 'int', unit: 'hours', applies: 'live' },
  inspectorMaxAttempts: { label: 'Inspector assignment attempts', kind: 'int', applies: 'live' },
  bidPriceRule: { label: 'Bid price rule', kind: 'enum', options: ['LTE_TARGET', 'EQ_TARGET'], applies: 'live' },
  advanceForfeitureOnBuyerDefault: { label: 'Forfeit advance on buyer default', kind: 'bool', applies: 'live', warning: 'Needs legal review before it is switched on. Applies to every buyer-default refund made after the change.' },
  otpTtlMinutes: { label: 'OTP lifetime', kind: 'int', unit: 'minutes', applies: 'live' },
  otpMaxPerHour: { label: 'OTP requests per hour', kind: 'int', applies: 'live' },
  gstOnCommissionBps: { label: 'GST on commission', kind: 'bps', applies: 'live', warning: 'Read when an invoice is generated. Needs CA review.' },
  gstOnGoodsBps: { label: 'GST on goods', kind: 'bps', applies: 'live', warning: 'Needs CA review.' },
};

const metaFor = (key: string, value: unknown): Meta => META[key] ?? { label: humanise(key), kind: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'int' : 'text', applies: 'live' };

const toText = (m: Meta, v: unknown) => (m.kind === 'paise' ? paiseToRupees(String(v)) : String(v));

/** Turns the text in the editor into the JSON type the API demands for this key. */
function parse(m: Meta, text: string): { ok: true; value: string | number | boolean } | { ok: false; error: string } {
  const t = text.trim();
  if (m.kind === 'bool') return { ok: true, value: t === 'true' };
  if (m.kind === 'paise') { const r = rupeesToPaise(t); return r.ok ? { ok: true, value: r.paise } : r; }
  if (m.kind === 'int' || m.kind === 'bps') {
    if (!/^\d+$/.test(t)) return { ok: false, error: 'Enter a whole number' };
    const n = Number(t);
    if (m.kind === 'bps' && n > 10000) return { ok: false, error: 'Basis points cannot exceed 10000 (100%)' };
    return { ok: true, value: n };
  }
  return t ? { ok: true, value: t } : { ok: false, error: 'Enter a value' };
}

const display = (m: Meta, v: unknown) => {
  if (m.kind === 'paise') return formatINR(String(v));
  if (m.kind === 'bps') return `${Number(v) / 100}% (${String(v)} bps)`;
  if (m.kind === 'bool') return v ? 'On' : 'Off';
  if (m.kind === 'enum') return humanise(String(v));
  return `${String(v)}${m.unit ? ` ${m.unit}` : ''}`;
};

export function ConfigEditor() {
  const q = useLoad(() => api.get<PlatformConfig>('/masters/config'), []);
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <>
      <Alert tone="blue" className="mb-3">Orders snapshot their terms when created, so changes to snapshotted values apply to new orders only. Values marked as read live take effect immediately, including on open orders.</Alert>
      {flash && <InlineSuccess onDismiss={() => setFlash(null)}>{flash}</InlineSuccess>}
      <Q q={q} rows={12}>
        {(cfg) => (
          <Table head={['Setting', 'Current', 'Applies to', 'New value']}>
            {Object.entries(cfg).map(([k, v]) => <ConfigRow key={k} k={k} value={v} onSaved={async (m) => { setFlash(m); await q.reload(); }} />)}
          </Table>
        )}
      </Q>
    </>
  );
}

function ConfigRow({ k, value, onSaved }: { k: string; value: string | number | boolean; onSaved: (m: string) => Promise<void> }) {
  const m = metaFor(k, value);
  const [text, setText] = useState(toText(m, value));
  const [pending, setPending] = useState<string | number | boolean | null>(null);
  useEffect(() => setText(toText(m, value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = parse(m, text);
  const changed = p.ok && p.value !== value;
  const inputLabel = `New value for ${m.label}`;

  return (
    <tr>
      <Td>
        <span className="font-medium">{m.label}</span>
        <span className="block font-mono text-xs text-slate-500">{k}</span>
        {m.warning && <span className="block max-w-sm text-xs text-amber-800">{m.warning}</span>}
      </Td>
      <Td className="whitespace-nowrap tabular-nums">{display(m, value)}</Td>
      <Td>{m.applies === 'snapshot' ? <Badge>New orders only</Badge> : <Badge tone="amber">Read live</Badge>}</Td>
      <Td>
        <form className="flex items-center gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); if (p.ok && changed) setPending(p.value); }}>
          {m.kind === 'bool' ? (
            <Select aria-label={inputLabel} className="h-8 w-28 px-2" value={text} onChange={(e) => setText(e.target.value)}><option value="true">On</option><option value="false">Off</option></Select>
          ) : m.kind === 'enum' ? (
            <Select aria-label={inputLabel} className="h-8 w-40 px-2" value={text} onChange={(e) => setText(e.target.value)}>{m.options!.map((o) => <option key={o} value={o}>{humanise(o)}</option>)}</Select>
          ) : (
            <span className="inline-flex items-center gap-1">
              {m.kind === 'paise' && <span aria-hidden className="text-sm text-slate-600">₹</span>}
              <Input aria-label={m.kind === 'paise' ? `${inputLabel} in rupees` : m.kind === 'bps' ? `${inputLabel} in basis points` : inputLabel} inputMode={m.kind === 'text' ? 'text' : 'decimal'} className="h-8 w-28 px-2" value={text} onChange={(e) => setText(e.target.value)} />
              {m.kind === 'bps' && <span className="text-xs text-slate-600">bps</span>}
            </span>
          )}
          <Button type="submit" size="sm" variant="secondary" disabled={!changed}>Save</Button>
        </form>
        {!p.ok && <p role="alert" className="mt-1 text-xs text-red-700">{p.error}</p>}
        {pending !== null && (
          <ConfirmDialog
            title={`Change ${m.label}`} confirmLabel="Save change" onClose={() => setPending(null)}
            onConfirm={async () => { await api.put(`/masters/config/${k}`, { value: pending }); await onSaved(`${m.label} is now ${display(m, pending)}.`); }}
          >
            <p>{m.label} changes from <strong>{display(m, value)}</strong> to <strong>{display(m, pending)}</strong>.</p>
            {m.applies === 'snapshot'
              ? <p>Orders snapshot this value, so it applies to new orders only. Existing orders keep the terms they were created with.</p>
              : <p><strong>This value is read live, so it takes effect immediately, including on open orders.</strong></p>}
            {m.warning && <p>{m.warning}</p>}
          </ConfirmDialog>
        )}
      </Td>
    </tr>
  );
}
