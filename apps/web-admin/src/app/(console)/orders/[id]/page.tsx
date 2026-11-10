'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { BuyerOrder } from '@agrimate/api-client';
import { Alert, Badge, Button, Countdown, Field, Input, Money, Select, StateBadge, Table, Td, humanise } from '@agrimate/ui';
import { formatINR, formatTonnes, findTransition, type OrderState } from '@agrimate/shared';
import { api } from '@/lib/api';
import { rupeesToPaise } from '@/lib/money';
import { useLoad } from '@/lib/use-load';
import { ConfirmDialog, Dl, DocLink, InlineSuccess, Ist, JsonDetails, Mono, PageHeader, Q, Section } from '@/components/console';
import type { InspectorOption, PlatformConfig } from '@/lib/types';

type Action = 'farmerDefault' | 'buyerRefund' | 'refundExcess' | 'assign' | 'cancel';
const pct = (bps: number) => `${bps / 100}%`;
const ASSIGNABLE_STATES = ['ADVANCE_LOCKED', 'LOGISTICS_PENDING', 'LOGISTICS_SECURED', 'AWAITING_BALANCE', 'FULLY_FUNDED', 'INSPECTION_SCHEDULED'];
const TERMINAL = ['SETTLED', 'REFUNDED', 'CANCELLED'];

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const order = useLoad(() => api.get<BuyerOrder>(`/admin/orders/${id}`), [id]);
  const inspectors = useLoad(() => api.get<InspectorOption[]>('/admin/inspectors'), []);
  const config = useLoad(() => api.get<PlatformConfig>('/masters/config'), []);
  const [action, setAction] = useState<Action | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const open = (a: Action) => { setDone(null); setAction(a); };

  return (
    <Q q={order} rows={10}>
      {(o) => {
        const state = o.state as OrderState;
        const inspectorName = (iid: string | null) => (iid ? inspectors.data?.find((i) => i.id === iid)?.name ?? iid : 'Not assigned');
        const escrow = BigInt(o.escrowPaise);
        const canFarmerDefault = !!findTransition(state, 'FARMER_DEFAULTED');
        const canBuyerRefund = state === 'BUYER_DEFAULTED';
        const canCancel = !!findTransition(state, 'CANCELLED');
        const canAssign = !!o.inspection && ASSIGNABLE_STATES.includes(state) && !['INSPECTED', 'FAILED_GRADE'].includes(o.inspection.status);
        const canRefundExcess = escrow > 0n;
        const none = !canFarmerDefault && !canBuyerRefund && !canCancel && !canAssign && !canRefundExcess;
        return (
          <>
            <p className="mb-1 text-xs text-slate-500"><Link href="/orders" className="underline">Orders</Link> / {o.code}</p>
            <PageHeader
              title={o.code}
              description={<>{o.commodity.name}, {o.grade.name}, {formatTonnes(o.quantityKg)}, {humanise(o.flow)} flow{o.isOrganic ? ', organic' : ''}</>}
              actions={<><StateBadge state={o.state} />{o.selfCertifiedBadge && <Badge tone="amber">Self-certified</Badge>}<Link href={`/ledger?tab=journals&orderId=${o.id}`} className="text-sm text-emerald-800 underline">Journals</Link><Link href={`/audit?entity=Order&entityId=${o.id}`} className="text-sm text-emerald-800 underline">Audit</Link></>}
            />
            {done && <InlineSuccess onDismiss={() => setDone(null)}>{done}</InlineSuccess>}

            <Section title="Actions" description="Only what the order's current state allows is offered. The API has the final say.">
              {none ? <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">No admin actions apply to an order in this state.</p> : (
                <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3">
                  {canAssign && <Button size="sm" variant="secondary" onClick={() => open('assign')}>Assign inspector</Button>}
                  {canRefundExcess && <Button size="sm" variant="secondary" onClick={() => open('refundExcess')}>Refund excess</Button>}
                  {canCancel && <Button size="sm" variant="secondary" onClick={() => open('cancel')}>Cancel order</Button>}
                  {canBuyerRefund && <Button size="sm" variant="danger" onClick={() => open('buyerRefund')}>Refund buyer default</Button>}
                  {canFarmerDefault && <Button size="sm" variant="danger" onClick={() => open('farmerDefault')}>Declare farmer default</Button>}
                </div>
              )}
            </Section>

            <Section title="Commercial terms" description="Snapshotted when the order was created.">
              <Dl items={[
                ['GMV', <Money key="g" paise={o.gmvPaise} />],
                ['Price per kg', <Money key="p" paise={o.pricePaisePerKg} />],
                ['In escrow now', <Money key="e" className="font-semibold" paise={o.escrowPaise} />],
                ['Advance', pct(o.advanceBps)],
                ['Commission', pct(o.commissionBps)],
                ['Inspection fee', <span key="i"><Money paise={o.inspectionFeePaise} />, paid by {humanise(o.inspectionFeePayer).toLowerCase()}</span>],
                ['Refunded to buyer through disputes', <Money key="r" paise={o.buyerRefundPaise} />],
                ['Contract version', o.contract.version],
                ['Contract accepted', <Ist key="ca" at={o.contract.acceptedAt} />],
              ]} />
            </Section>

            <Section title="Parties and dates">
              <Dl items={[
                ['Buyer', <span key="b">{o.buyer.name}<span className="block text-xs text-slate-600">{o.buyer.phone}</span></span>],
                ['Farmer', <span key="f">{o.farmer.name}<span className="block text-xs text-slate-600">{o.farmer.phone}{o.farmer.district ? `, ${o.farmer.district}` : ''}{o.farmer.state ? `, ${o.farmer.state}` : ''}</span></span>],
                ['Pickup and delivery PIN', `${o.pickupPin} to ${o.deliveryPin}`],
                ['T0 (advance locked)', <Ist key="t0" at={o.t0At} />],
                ['SLA deadline', <span key="s"><Ist at={o.slaDeadlineAt} /> {!TERMINAL.includes(state) && !o.deliveredAt && o.slaDeadlineAt && <Countdown className="ml-1 text-xs" to={o.slaDeadlineAt} />}</span>],
                ['Inspection day', <Ist key="id" at={o.inspectionDayAt} />],
                ['Dispatched weight', o.dispatchedWeightKg != null ? `${o.dispatchedWeightKg} kg` : '—'],
                ['Received weight', o.receivedWeightKg != null ? `${o.receivedWeightKg} kg` : '—'],
                ['Delivered', <Ist key="d" at={o.deliveredAt} />],
                ['Dispute window ends', <Ist key="dw" at={o.disputeDeadlineAt} />],
                ['Settled', <Ist key="st" at={o.settledAt} />],
                ['Created', <Ist key="c" at={o.createdAt} />],
              ]} />
            </Section>

            <Section title="Timeline" description="Immutable state changes, oldest first.">
              {!o.events?.length ? <Empty>No events recorded.</Empty> : (
                <Table head={['Time', 'From', 'To', 'Actor', 'Payload']}>
                  {o.events.map((e) => (
                    <tr key={e.id}>
                      <Td><Ist at={e.createdAt} /></Td>
                      <Td>{e.from ? <StateBadge state={e.from} /> : <span className="text-slate-400">Start</span>}</Td>
                      <Td><StateBadge state={e.to} /></Td>
                      <Td>{humanise(e.actorRole)}{e.actorId && <Mono className="block text-slate-500">{e.actorId}</Mono>}</Td>
                      <Td><JsonDetails label="Payload" value={e.payload} /></Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>

            <Section title="Tranches">
              {!o.tranches.length ? <Empty>No tranches yet.</Empty> : (
                <Table head={['Kind', 'Expected', 'Received', 'Status', 'Paid']}>
                  {o.tranches.map((t) => <tr key={t.kind}><Td>{humanise(t.kind)}</Td><Td><Money paise={t.expectedPaise} /></Td><Td><Money paise={t.receivedPaise} /></Td><Td><StateBadge state={t.status} /></Td><Td><Ist at={t.paidAt} /></Td></tr>)}
                </Table>
              )}
            </Section>

            <Section title="Virtual account">
              {!o.virtualAccount ? <Empty>No virtual account has been issued.</Empty> : (
                <Dl items={[['Account number', <Mono key="a">{o.virtualAccount.accountNumber}</Mono>], ['IFSC', <Mono key="i">{o.virtualAccount.ifsc}</Mono>], ['Beneficiary', o.virtualAccount.beneficiary], ['Closed', o.virtualAccount.closedAt ? <Ist key="c" at={o.virtualAccount.closedAt} /> : 'Open']]} />
              )}
            </Section>

            <Section title="Payouts">
              {!o.payouts?.length ? <Empty>No payouts yet.</Empty> : (
                <Table head={['Payee', 'Amount', 'Status', 'Reason']}>
                  {o.payouts.map((p) => <tr key={p.id}><Td>{humanise(p.payeeType)}<Mono className="block text-slate-500">{p.payeeId}</Mono></Td><Td><Money paise={p.amountPaise} /></Td><Td><StateBadge state={p.status} /></Td><Td className="max-w-md">{p.statusNote ?? '—'}</Td></tr>)}
                </Table>
              )}
            </Section>

            <Section title="Inspection">
              {!o.inspection ? <Empty>No inspection on this order yet.</Empty> : (
                <>
                  <Dl items={[
                    ['Status', <StateBadge key="s" state={o.inspection.status} />],
                    ['Inspector', inspectorName(o.inspection.inspectorId)],
                    ['Scheduled for', <Ist key="sf" at={o.inspection.scheduledFor} />],
                    ['Checked in', <Ist key="ci" at={o.inspection.checkInAt} />],
                    ['Inspected', <Ist key="ia" at={o.inspection.inspectedAt} />],
                    ['Scale weight', o.inspection.scaleWeightKg != null ? `${o.inspection.scaleWeightKg} kg` : '—'],
                    ['Deviation accepted by buyer', <Ist key="da" at={o.inspection.deviationAcceptedAt} />],
                    ['Self-certification required', o.selfCertRequired ? 'Yes' : 'No'],
                    ['Photos', o.inspection.photoFileIds.length ? <span key="ph" className="flex flex-wrap gap-2">{o.inspection.photoFileIds.map((f, i) => <DocLink key={f} fileId={f} label={`Photo ${i + 1}`} />)}</span> : '—'],
                  ]} />
                  {o.inspection.readings && (
                    <div className="mt-2">
                      <Table head={['Parameter', 'Reading', 'Allowed', 'Result']}>
                        {o.grade.parameters.map((p) => {
                          const v = o.inspection!.readings![p.key];
                          const bad = o.inspection!.gradeCheck?.outOfSpec.includes(p.key);
                          return <tr key={p.key}><Td>{p.label}</Td><Td className="tabular-nums">{v ?? '—'} {p.unit}</Td><Td className="tabular-nums">{p.min ?? '—'} to {p.max ?? '—'} {p.unit}</Td><Td><Badge tone={bad ? 'red' : 'green'}>{bad ? 'Out of spec' : 'In spec'}</Badge></Td></tr>;
                        })}
                      </Table>
                    </div>
                  )}
                </>
              )}
            </Section>

            {o.selfCert && (
              <Section title="Self-certification">
                <Dl items={[
                  ['Submitted', <Ist key="s" at={o.selfCert.submittedAt} />],
                  ['Certified weight', o.selfCert.certifiedWeightKg != null ? `${o.selfCert.certifiedWeightKg} kg` : '—'],
                  ['Scale video', <DocLink key="sv" fileId={o.selfCert.scaleVideoFileId} label="Scale video" />],
                  ['Vehicle video', <DocLink key="vv" fileId={o.selfCert.vehicleVideoFileId} label="Vehicle video" />],
                  ['Capture details', <JsonDetails key="cd" label="View" value={{ scale: o.selfCert.scaleCapture, vehicle: o.selfCert.vehicleCapture }} />],
                ]} />
              </Section>
            )}

            <Section title="Trip">
              {o.trip ? (
                <Dl items={[
                  ['Status', <StateBadge key="s" state={o.trip.status} />],
                  ['Vehicle', o.trip.vehicleRegNo ?? '—'],
                  ['Tier', o.trip.tierCode],
                  ['Distance', `${o.trip.distanceKm} km`],
                  ['Funded', <Ist key="fa" at={o.trip.fundedAt} />],
                  ['No co-loading attested', <Ist key="nc" at={o.trip.noCoLoadingAttestedAt} />],
                  ['Picked up', <Ist key="pu" at={o.trip.pickedUpAt} />],
                  ['Delivered', <Ist key="de" at={o.trip.deliveredAt} />],
                  ['E-way bill', o.trip.ewayBillNumber ? <span key="ew">{o.trip.ewayBillNumber} <DocLink fileId={o.trip.ewayBillFileId} label="Open" /></span> : '—'],
                  ['Proof of delivery', o.trip.podPhotoFileId ? <DocLink key="pod" fileId={o.trip.podPhotoFileId} label="Open photo" /> : '—'],
                  ['Final freight', o.freight ? <Money key="ff" paise={o.freight.finalFreightPaise} /> : '—'],
                  ['Base cost and markup', o.freight ? <span key="bm"><Money paise={o.freight.baseCostPaise} /> + <Money paise={o.freight.markupPaise} /></span> : '—'],
                ]} />
              ) : o.external ? (
                <Dl items={[['Mode', 'External transport, declared by the buyer'], ['Vehicle', o.external.vehicleNo], ['Driver phone', o.external.driverPhone]]} />
              ) : <Empty>No trip or external transport yet.</Empty>}
            </Section>

            {o.disputes.length > 0 && (
              <Section title="Disputes">
                <Table head={['Type', 'Status', 'Raised', 'Outcome', 'Refund']}>
                  {o.disputes.map((d) => <tr key={d.id}><Td><Link href={`/disputes/${d.id}`} className="text-emerald-800 underline">{humanise(d.type)}</Link></Td><Td><StateBadge state={d.status} /></Td><Td><Ist at={d.createdAt} /></Td><Td>{d.outcome ? humanise(d.outcome) : '—'}</Td><Td><Money paise={d.refundPaise} /></Td></tr>)}
                </Table>
              </Section>
            )}

            {o.spotTests.length > 0 && (
              <Section title="Spot tests">
                <Table head={['Status', 'Requested', 'Report', 'Note']}>
                  {o.spotTests.map((s) => <tr key={s.id}><Td><StateBadge state={s.status} /></Td><Td><Ist at={s.createdAt} /></Td><Td>{s.reportFileId ? <DocLink fileId={s.reportFileId} label="Report" /> : '—'}</Td><Td>{s.resultNote ?? '—'}</Td></tr>)}
                </Table>
              </Section>
            )}

            {action === 'farmerDefault' && (
              <ConfirmDialog
                title={`Declare farmer default on ${o.code}`} confirmLabel="Declare default and refund" danger
                reason={{ label: 'Reason', hint: 'Required. Stored on the order event and the audit log.' }}
                onClose={() => setAction(null)}
                onConfirm={async (reason) => {
                  await api.post(`/admin/orders/${o.id}/farmer-default`, { reason });
                  setDone(`Farmer default declared on ${o.code}. The buyer refund has been issued.`);
                  await order.reload();
                }}
              >
                <p><strong>This cannot be undone.</strong> The order moves to farmer defaulted and then straight to refunded.</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li><strong>The buyer is refunded 100% of what is in escrow: {formatINR(o.escrowPaise)}.</strong></li>
                  <li>The gateway processing fee on these payments is posted to {o.farmer.name} as a negative balance, recovered from their future payouts.</li>
                  <li>Any open or accepted trip is cancelled, all SLA timers stop and the virtual account closes.</li>
                  <li>An inspector who has already done the work is still paid, funded by the platform.</li>
                </ul>
              </ConfirmDialog>
            )}

            {action === 'buyerRefund' && (
              <BuyerRefundDialog o={o} forfeit={config.loaded ? !!config.data?.advanceForfeitureOnBuyerDefault : null} onClose={() => setAction(null)} onDone={async (m) => { setDone(m); await order.reload(); }} />
            )}

            {action === 'refundExcess' && (
              <RefundExcessDialog o={o} onClose={() => setAction(null)} onDone={async (m) => { setDone(m); await order.reload(); }} />
            )}

            {action === 'cancel' && (
              <ConfirmDialog
                title={`Cancel ${o.code}`} confirmLabel="Cancel order" danger
                reason={{ label: 'Reason', hint: 'Required. Stored on the order event.' }}
                onClose={() => setAction(null)}
                onConfirm={async (reason) => {
                  await api.post(`/orders/${o.id}/cancel`, { reason });
                  setDone(`${o.code} has been cancelled.`);
                  await order.reload();
                }}
              >
                <p>The order moves to cancelled and cannot trade again.</p>
                {escrow > 0n ? (
                  <p><strong>Cancelling does not refund anything. {formatINR(o.escrowPaise)} is in escrow and stays there</strong> until you refund it with Refund excess, which becomes available in full once the order is cancelled.</p>
                ) : <p>Escrow is empty, so no money moves.</p>}
              </ConfirmDialog>
            )}

            {action === 'assign' && (
              <AssignDialog o={o} inspectors={inspectors.data} inspectorsError={inspectors.error} currentName={inspectorName(o.inspection?.inspectorId ?? null)} onClose={() => setAction(null)} onDone={async (m) => { setDone(m); await order.reload(); }} />
            )}
          </>
        );
      }}
    </Q>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-600">{children}</p>;
type DialogProps = { o: BuyerOrder; onClose: () => void; onDone: (message: string) => Promise<void> };

/** Mirrors refundAll in settlement.service.ts, so the confirmation shows the real split when forfeiture is switched on. */
function BuyerRefundDialog({ o, forfeit, onClose, onDone }: DialogProps & { forfeit: boolean | null }) {
  const escrow = BigInt(o.escrowPaise);
  const advance = BigInt(o.tranches.find((t) => t.kind === 'ADVANCE')?.receivedPaise ?? '0');
  const forfeited = advance < escrow ? advance : escrow;
  return (
    <ConfirmDialog
      title={`Refund buyer default on ${o.code}`} confirmLabel="Refund" danger canConfirm={forfeit !== null}
      reason={{ label: 'Reason', hint: 'Required. Stored on the order event and the audit log.' }}
      onClose={onClose}
      onConfirm={async (reason) => {
        await api.post(`/admin/orders/${o.id}/buyer-default/refund`, { reason });
        await onDone(`${o.code} refunded.`);
      }}
    >
      <p><strong>This cannot be undone.</strong> The order moves to refunded.</p>
      {forfeit === null ? <Alert tone="red" role="alert">The forfeiture setting could not be read, so what this refund does cannot be stated. Reload and try again.</Alert> : forfeit ? (
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Advance forfeiture is switched on: {formatINR(forfeited)} of the advance is paid to {o.farmer.name}, not returned to the buyer.</strong></li>
          <li>The remaining {formatINR(escrow - forfeited)} is refunded to {o.buyer.name}.</li>
        </ul>
      ) : (
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>{o.buyer.name} is refunded everything in escrow: {formatINR(o.escrowPaise)}.</strong></li>
          <li>Advance forfeiture is off, so the farmer receives nothing from this order.</li>
        </ul>
      )}
      <ul className="list-disc space-y-1 pl-5">
        <li>The gateway fee is absorbed by the platform and is not posted to the farmer.</li>
        <li>Any open or accepted trip is cancelled and the virtual account closes. An inspector who already did the work is paid.</li>
      </ul>
    </ConfirmDialog>
  );
}

function RefundExcessDialog({ o, onClose, onDone }: DialogProps) {
  const [amount, setAmount] = useState('');
  const terminal = TERMINAL.includes(o.state);
  const parsed = amount.trim() ? rupeesToPaise(amount) : null;
  const tooMuch = parsed?.ok && BigInt(parsed.paise) > BigInt(o.escrowPaise);
  const zero = parsed?.ok && BigInt(parsed.paise) === 0n;
  const error = parsed && !parsed.ok ? parsed.error : tooMuch ? `That is more than the ${formatINR(o.escrowPaise)} in escrow` : zero ? 'Enter more than zero, or leave this blank' : undefined;
  return (
    <ConfirmDialog
      title={`Refund excess on ${o.code}`} confirmLabel="Refund to buyer" danger canConfirm={!error}
      reason={{ label: 'Reason', hint: 'Required for your own check. The API does not store a reason on this action; only the amount is audited.' }}
      extra={<Field label="Amount in rupees (optional)" error={error} hint="Leave blank to refund the most that is allowed."><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
      onClose={onClose}
      onConfirm={async () => {
        const r = await api.post<{ refundedPaise: string }>(`/admin/orders/${o.id}/refund-excess`, parsed?.ok ? { amountPaise: parsed.paise } : {});
        await onDone(`${formatINR(r.refundedPaise)} refunded to ${o.buyer.name}.`);
      }}
    >
      <p><strong>{parsed?.ok && !error ? `${formatINR(parsed.paise)} will` : 'The most allowed will'} be returned to {o.buyer.name}&apos;s original payment, and cannot be taken back.</strong></p>
      {terminal
        ? <p>This order is closed, so everything left in escrow ({formatINR(o.escrowPaise)}) can be refunded.</p>
        : <p>This order is still open, so only money recorded as overpaid can be refunded, and never money that belongs to a tranche. The API does not expose that figure in advance. It refuses an amount above the limit and tells you the limit. Escrow now holds {formatINR(o.escrowPaise)}.</p>}
    </ConfirmDialog>
  );
}

function AssignDialog({ o, inspectors, inspectorsError, currentName, onClose, onDone }: DialogProps & { inspectors: InspectorOption[] | undefined; inspectorsError: unknown; currentName: string }) {
  const [inspectorId, setInspectorId] = useState('');
  const picked = inspectors?.find((i) => i.id === inspectorId);
  const hasCurrent = !!o.inspection?.inspectorId;
  return (
    <ConfirmDialog
      title={`Assign an inspector to ${o.code}`} confirmLabel="Assign inspector" canConfirm={!!picked}
      extra={
        <Field label="Inspector" hint={inspectors && inspectors.length === 0 ? 'No verified inspectors yet.' : inspectorsError ? 'The inspector list could not be loaded.' : `Pickup PIN is ${o.pickupPin}.`}>
          <Select required value={inspectorId} onChange={(e) => setInspectorId(e.target.value)}>
            <option value="">Choose an inspector</option>
            {inspectors?.map((i) => <option key={i.id} value={i.id}>{i.name}, PIN {i.pin ?? 'unknown'}, within {i.serviceRadiusKm} km{i.available ? '' : ', marked unavailable'}</option>)}
          </Select>
        </Field>
      }
      onClose={onClose}
      onConfirm={async () => {
        await api.post(`/admin/orders/${o.id}/assign-inspector`, { inspectorId });
        await onDone(`${picked!.name} assigned to ${o.code}.`);
      }}
    >
      <p>The chosen inspector is assigned and notified of the job{o.inspection ? <> scheduled for <Ist at={o.inspection.scheduledFor} /></> : ''}. Any self-certification requirement on this order is cleared.</p>
      {hasCurrent && <p>This replaces {currentName}, who is not notified of the change.</p>}
      {picked && !picked.available && <p><strong>{picked.name} has marked themselves unavailable.</strong></p>}
    </ConfirmDialog>
  );
}
