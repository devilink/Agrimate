'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Badge, Button, Money, StateBadge, Table, Td, humanise } from '@agrimate/ui';
import { formatINR, namesMatch } from '@agrimate/shared';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { ConfirmDialog, DocLink, InlineSuccess, Ist, JsonDetails, Mono, PageHeader, Q, Tabs } from '@/components/console';
import type { AdminPayout, InspectorItem, KybItem, KycItem, LogisticsItem, OrganicItem, QueueKind, Queues } from '@/lib/types';

type Decision = 'APPROVE' | 'REJECT';
interface Pending { kind: QueueKind; id: string; name: string; decision: Decision; effects: ReactNode; noteRequired: boolean }
type Held = Map<string, { count: number; total: bigint }>;

const TABS: { key: QueueKind; label: string }[] = [
  { key: 'kyb', label: 'Buyer KYB' }, { key: 'kyc', label: 'Farmer KYC' }, { key: 'inspector', label: 'Inspector degrees' }, { key: 'logistics', label: 'Logistics documents' }, { key: 'organic', label: 'Organic certificates' },
];

const heldSentence = (h: { count: number; total: bigint } | undefined) => h && h.count > 0
  ? `${h.count} held payout${h.count === 1 ? '' : 's'} totalling ${formatINR(h.total)} will be released and sent to the bank straight away.`
  : 'No payouts are held for this payee right now, so no money moves today. Future payouts will go through.';

function ReviewButtons({ onPick }: { onPick: (d: Decision) => void }) {
  return (
    <div className="flex gap-1.5">
      <Button size="sm" onClick={() => onPick('APPROVE')}>Approve</Button>
      <Button size="sm" variant="secondary" onClick={() => onPick('REJECT')}>Reject</Button>
    </div>
  );
}

export default function QueuesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'kyc') as QueueKind;
  const queues = useLoad(() => api.get<Queues>('/admin/queues'), []);
  const blocked = useLoad(() => api.get<AdminPayout[]>('/admin/payouts?status=BLOCKED'), []);
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const held: Held = useMemo(() => {
    const m: Held = new Map();
    for (const p of blocked.data ?? []) {
      const e = m.get(p.payeeId) ?? { count: 0, total: 0n };
      m.set(p.payeeId, { count: e.count + 1, total: e.total + BigInt(p.amountPaise) });
    }
    return m;
  }, [blocked.data]);
  // The money sentence in a confirmation must not claim "none held" just because this lookup failed.
  const heldFor = (id: string): ReactNode => blocked.loaded ? heldSentence(held.get(id)) : `Any payouts held for this payee will be released and sent to the bank straight away. The held amount could not be read: ${blocked.error ? errorMessage(blocked.error) : 'still loading'}.`;

  const review = (kind: QueueKind, id: string, name: string, decision: Decision, effects: ReactNode, noteRequired = decision === 'REJECT') => { setDone(null); setPending({ kind, id, name, decision, effects, noteRequired }); };

  return (
    <>
      <PageHeader title="Verification queues" description="Approve or reject what automatic checks could not settle. Every decision is audited and the person is notified." />
      {done && <InlineSuccess onDismiss={() => setDone(null)}>{done}</InlineSuccess>}

      <Q q={queues}>
        {(q) => (
          <>
            <Tabs label="Queues" value={tab} onChange={(k) => router.replace(`/queues?tab=${k}`)} items={TABS.map((t) => ({ ...t, count: q[t.key].length }))} />
            {tab === 'kyb' && <Kyb rows={q.kyb} review={review} />}
            {tab === 'kyc' && <Kyc rows={q.kyc} held={held} heldFor={heldFor} review={review} />}
            {tab === 'inspector' && <Inspectors rows={q.inspector} review={review} />}
            {tab === 'logistics' && <Logistics rows={q.logistics} heldFor={heldFor} review={review} />}
            {tab === 'organic' && <Organic rows={q.organic} review={review} />}
          </>
        )}
      </Q>

      {pending && (
        <ConfirmDialog
          title={`${pending.decision === 'APPROVE' ? 'Approve' : 'Reject'} ${pending.name}`}
          confirmLabel={pending.decision === 'APPROVE' ? 'Approve' : 'Reject'}
          danger={pending.decision === 'REJECT'}
          reason={pending.noteRequired ? { label: 'Note', hint: 'Required. Stored with the decision and sent to the person.' } : undefined}
          onClose={() => setPending(null)}
          onConfirm={async (note) => {
            const body: { decision: Decision; note?: string } = { decision: pending.decision };
            if (note) body.note = note;
            await api.post(`/admin/queues/${pending.kind}/${pending.id}/review`, body);
            setDone(`${pending.name}: ${pending.decision === 'APPROVE' ? 'approved' : 'rejected'}.`);
            await Promise.all([queues.reload(), blocked.reload()]);
          }}
        >
          {pending.effects}
        </ConfirmDialog>
      )}
    </>
  );
}

type Review = (kind: QueueKind, id: string, name: string, d: Decision, effects: ReactNode, noteRequired?: boolean) => void;
const Empty = ({ what }: { what: string }) => <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm font-medium text-slate-800">Nothing waiting in {what}</div>;

function Kyc({ rows, held, heldFor, review }: { rows: KycItem[]; held: Held; heldFor: (id: string) => ReactNode; review: Review }) {
  return (
    <>
      <Alert tone="blue" className="mb-3">This is where name mismatches are resolved. Payouts stay off until the name the bank reports matches the PAN name, or an admin approves the difference here.</Alert>
      {rows.length === 0 ? <Empty what="farmer KYC" /> : (
        <Table head={['Farmer', 'PAN name', 'Bank-holder name', 'Names', 'PAN / account / IFSC', 'Status and note', 'Held payouts', 'Provider response', 'Decision']}>
          {rows.map((f) => {
            const match = !!f.panName && !!f.bankHolderName && namesMatch(f.panName, f.bankHolderName);
            const h = held.get(f.id);
            return (
              <tr key={f.id}>
                <Td className="font-medium">{f.name}</Td>
                <Td className="font-medium">{f.panName ?? '—'}</Td>
                <Td className="font-medium">{f.bankHolderName ?? '—'}</Td>
                <Td><Badge tone={match ? 'green' : 'red'}>{match ? 'Match' : 'Mismatch'}</Badge></Td>
                <Td className="whitespace-nowrap text-xs tabular-nums">PAN …{f.panLast4 ?? '—'}<br />A/c …{f.bankLast4 ?? '—'}<br />{f.bankIfsc ?? '—'}</Td>
                <Td><StateBadge state={f.status} />{f.note && <p className="mt-1 max-w-56 text-xs text-slate-600">{f.note}</p>}</Td>
                <Td className="tabular-nums">{h ? <>{h.count} / <Money paise={h.total} /></> : '0'}</Td>
                <Td><JsonDetails label="View" value={f.response} /></Td>
                <Td>
                  <ReviewButtons onPick={(d) => review('kyc', f.id, f.name, d, d === 'APPROVE' ? (
                    <>
                      {!match && <p><strong>This overrides a name mismatch:</strong> PAN says “{f.panName ?? 'not given'}”, the bank says “{f.bankHolderName ?? 'not given'}”. Check the account really belongs to this farmer.</p>}
                      <p>Payouts will be turned on for this farmer.</p>
                      <p><strong>{heldFor(f.id)}</strong></p>
                      <p>The API refuses this if the bank account failed validation.</p>
                    </>
                  ) : (
                    <>
                      <p>KYC will be marked rejected and payouts turned off for this farmer.</p>
                      <p>Held payouts stay held, and the farmer is told the note you write here.</p>
                    </>
                  ), true)} />
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}

function Kyb({ rows, review }: { rows: KybItem[]; review: Review }) {
  if (rows.length === 0) return <Empty what="buyer KYB" />;
  return (
    <Table head={['Contact', 'Company', 'GSTIN', 'PAN', 'Status and note', 'Provider response', 'Decision']}>
      {rows.map((b) => (
        <tr key={b.id}>
          <Td className="font-medium">{b.name}</Td><Td>{b.companyName ?? '—'}</Td><Td><Mono>{b.gstin ?? '—'}</Mono></Td><Td className="tabular-nums">…{b.panLast4 ?? '—'}</Td>
          <Td><StateBadge state={b.status} />{b.note && <p className="mt-1 max-w-56 text-xs text-slate-600">{b.note}</p>}</Td>
          <Td><JsonDetails label="View" value={b.response} /></Td>
          <Td><ReviewButtons onPick={(d) => review('kyb', b.id, b.companyName ?? b.name, d, d === 'APPROVE' ? <p>This buyer&apos;s KYB will be marked verified.</p> : <p>This buyer&apos;s KYB will be marked rejected, and the buyer is told the note you write here.</p>)} /></Td>
        </tr>
      ))}
    </Table>
  );
}

function Inspectors({ rows, review }: { rows: InspectorItem[]; review: Review }) {
  if (rows.length === 0) return <Empty what="inspector degrees" />;
  return (
    <Table head={['Inspector', 'Degree', 'Document', 'PIN', 'Status', 'Decision']}>
      {rows.map((i) => (
        <tr key={i.id}>
          <Td className="font-medium">{i.name}</Td><Td>{i.degreeType ? humanise(i.degreeType) : '—'}</Td><Td><DocLink fileId={i.degreeFileId} label="Degree" /></Td><Td className="tabular-nums">{i.pin ?? '—'}</Td><Td><StateBadge state={i.status} /></Td>
          <Td><ReviewButtons onPick={(d) => review('inspector', i.id, i.name, d, d === 'APPROVE' ? (
            <>
              {!i.degreeFileId && <p><strong>There is no degree document on file for this inspector.</strong></p>}
              <p>The inspector will be marked verified, can then turn on availability, and can be assigned inspection jobs.</p>
            </>
          ) : <p>The inspector will be marked rejected and made unavailable for jobs. Jobs already assigned are not removed.</p>)} /></Td>
        </tr>
      ))}
    </Table>
  );
}

function Logistics({ rows, heldFor, review }: { rows: LogisticsItem[]; heldFor: (id: string) => ReactNode; review: Review }) {
  if (rows.length === 0) return <Empty what="logistics documents" />;
  return (
    <Table head={['Partner', 'Type', 'GSTIN', 'Documents', 'Vehicles', 'No co-loading accepted', 'Status', 'Decision']}>
      {rows.map((l) => {
        const missing = [!l.rcFileId && 'RC', !l.dlFileId && 'driving licence', !l.fitnessFileId && 'fitness certificate'].filter(Boolean);
        return (
          <tr key={l.id}>
            <Td className="font-medium">{l.name}{l.companyName && <span className="block text-xs font-normal text-slate-600">{l.companyName}</span>}</Td>
            <Td>{humanise(l.partnerType)}</Td><Td><Mono>{l.gstin ?? '—'}</Mono></Td>
            <Td><div className="flex flex-col items-start gap-0.5"><DocLink fileId={l.rcFileId} label="RC" /><DocLink fileId={l.dlFileId} label="Driving licence" /><DocLink fileId={l.fitnessFileId} label="Fitness certificate" /></div></Td>
            <Td className="text-xs">{l.vehicles.length ? l.vehicles.map((v) => <span key={v.id} className="block">{v.regNo} ({v.tier?.code ?? `${v.capacityKg} kg`})</span>) : 'None'}</Td>
            <Td><Ist at={l.noCoLoadingAcceptedAt} /></Td><Td><StateBadge state={l.status} /></Td>
            <Td><ReviewButtons onPick={(d) => review('logistics', l.id, l.companyName ?? l.name, d, d === 'APPROVE' ? (
              <>
                {missing.length > 0 && <p><strong>Missing from this file: {missing.join(', ')}.</strong></p>}
                <p>The partner will be marked verified.</p>
                <p><strong>{heldFor(l.id)}</strong></p>
              </>
            ) : <p>The partner will be marked rejected. Held payouts stay held, and the partner is told the note you write here.</p>)} /></Td>
          </tr>
        );
      })}
    </Table>
  );
}

function Organic({ rows, review }: { rows: OrganicItem[]; review: Review }) {
  if (rows.length === 0) return <Empty what="organic certificates" />;
  return (
    <Table head={['Farmer', 'Certifier', 'Certificate no.', 'Expires', 'Document', 'Status', 'Decision']}>
      {rows.map((c) => (
        <tr key={c.id}>
          <Td className="font-medium">{c.farmer}</Td><Td>{c.certifier}</Td><Td><Mono>{c.certNumber}</Mono></Td><Td><Ist at={c.expiresAt} /></Td><Td><DocLink fileId={c.fileId} label="Certificate" /></Td><Td><StateBadge state={c.status} /></Td>
          <Td><ReviewButtons onPick={(d) => review('organic', c.id, `${c.farmer} (${c.certNumber})`, d, d === 'APPROVE' ? <p>The certificate will be marked verified, so this farmer can list produce as organic until it expires.</p> : <p>The certificate will be marked rejected and cannot back an organic listing. The farmer is told the note you write here.</p>)} /></Td>
        </tr>
      ))}
    </Table>
  );
}
