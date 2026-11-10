/** Beyond Section 10: security, SLA behaviour, payment edge cases, ledger guarantees, and contract parity. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { $Enums, PrismaClient } from '@prisma/client';
import * as shared from '@agrimate/shared';
import { rupees } from '@agrimate/shared';
import { allocateCredit } from '../src/payments/payments.service';
import { renderTemplate, TEMPLATE_NAMES } from '../src/notifications/templates';
import { CryptoService, PrismaService, redact } from '../src/core/core';
import { RotationReport, rotatePiiKey } from '../src/core/pii-rotation';
import { Harness, NAGAON, GUWAHATI_PIN } from './harness';

let h: Harness;
beforeAll(async () => { h = await Harness.create(); });
afterAll(async () => { await h.close(); });
beforeEach(async () => { await h.reset(); });

describe('allocateCredit', () => {
  const t = (id: string, kind: string, expected: bigint, received = 0n) => ({ id, kind: kind as 'ADVANCE', expectedPaise: expected, receivedPaise: received });
  it('exact match wins over priority', () => expect(allocateCredit(70n, [t('a', 'ADVANCE', 30n), t('b', 'BALANCE', 70n)]).allocations).toEqual([{ trancheId: 'b', kind: 'BALANCE', amount: 70n }]));
  it('one transfer can pay everything open', () => {
    const r = allocateCredit(100n, [t('b', 'BALANCE', 70n), t('a', 'ADVANCE', 30n)]);
    expect(r.allocations.map((a) => a.kind)).toEqual(['ADVANCE', 'BALANCE']);
    expect(r.excess).toBe(0n);
  });
  it('underpayment leaves a shortfall', () => expect(allocateCredit(10n, [t('a', 'ADVANCE', 30n)])).toMatchObject({ shortfall: true, excess: 0n }));
  it('overpayment leaves an excess', () => expect(allocateCredit(50n, [t('a', 'ADVANCE', 30n)])).toMatchObject({ shortfall: false, excess: 20n }));
  it('a part-paid tranche takes its remainder as an exact match', () => expect(allocateCredit(20n, [t('a', 'ADVANCE', 30n, 10n), t('b', 'BALANCE', 70n)]).allocations[0]).toMatchObject({ trancheId: 'a', amount: 20n }));
  it('nothing open means everything is excess', () => expect(allocateCredit(5n, [t('a', 'ADVANCE', 30n, 30n)])).toMatchObject({ allocations: [], excess: 5n }));
});

describe('payment edge cases', () => {
  it('underpayment does not lock the advance, flags admin, and a top-up completes it', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id, rupees(100_000));
    expect(await h.state(o.id)).toBe('AWAITING_ADVANCE');
    expect(await h.prisma.adminAlert.count({ where: { kind: 'UNDERPAYMENT' } })).toBe(1);
    await h.credit(buyer, o.id, rupees(50_000));
    expect(await h.state(o.id)).toBe('LOGISTICS_PENDING');
  });
  it('overpayment locks the advance, flags admin, and the excess can be refunded', async () => {
    const [buyer, farmer, admin] = [await h.buyer(), await h.farmer(), await h.admin()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id, rupees(600_000)); // Advance and balance are both open, and this is more than the total.
    expect(await h.prisma.adminAlert.count({ where: { kind: 'OVERPAYMENT' } })).toBe(1);
    const r = await h.api(admin).post(`/admin/orders/${o.id}/refund-excess`);
    expect(r.status).toBe(200);
    expect(r.body.refundedPaise).toBe(String(rupees(100_000)));
    expect(await h.ledger.escrowBalance(o.id)).toBe(rupees(500_000));
  });
  it('a credit on a VAN nobody owns is held and flagged, not lost', async () => {
    const hook = await h.gateway.buildCreditWebhook({ gatewayVaId: 'va_unknown', amountPaise: 12345n });
    const res = await h.webhook(hook.raw, hook.signature);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('unmatched');
    expect(await h.prisma.adminAlert.count({ where: { kind: 'UNMATCHED_PAYMENT' } })).toBe(1);
  });
  it('a credit arriving on a refunded order is never applied to a tranche', async () => {
    const [buyer, farmer, admin] = [await h.buyer(), await h.farmer(), await h.admin()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id);
    await h.api(admin).post(`/admin/orders/${o.id}/farmer-default`, { reason: 'Could not deliver' });
    const r = await h.credit(buyer, o.id, rupees(350_000));
    expect(r.allocations).toEqual([]);
    expect(r.excessPaise).toBe(String(rupees(350_000)));
    expect((await h.prisma.tranche.findFirstOrThrow({ where: { orderId: o.id, kind: 'BALANCE' } })).status).toBe('PENDING');
  });
  it('a failed payout leaves the payable standing, alerts ops, and can be retried', async () => {
    const [buyer, farmer, inspector, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    await h.prisma.farmerProfile.update({ where: { userId: farmer.id }, data: { fundAccountId: 'fa_fail_x' } });
    const o = await h.toDisputeWindow(buyer, farmer, inspector, 9_900);
    await h.advanceHours(25);
    const p = await h.prisma.payout.findFirstOrThrow({ where: { orderId: o.id, payeeType: 'FARMER' } });
    expect(p.status).toBe('FAILED');
    expect(await h.ledger.balance(`farmer_payable:${farmer.id}`)).toBe(-rupees(482_000));
    expect(await h.prisma.adminAlert.count({ where: { kind: 'PAYOUT_FAILED' } })).toBe(1);
    await h.prisma.farmerProfile.update({ where: { userId: farmer.id }, data: { fundAccountId: 'fa_ok' } });
    expect((await h.api(admin).post(`/admin/payouts/${p.id}/retry`)).body.status).toBe('PROCESSED');
    expect(await h.assertBooksClosed(o.id)).toEqual({ escrow: 0n, nodal: 0n, trial: 0n });
  });
  it('reconciliation matches after a full order, and flags a difference', async () => {
    const [buyer, farmer, inspector, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    await h.toDisputeWindow(buyer, farmer, inspector, 9_900);
    await h.advanceHours(25);
    const date = shared.istDateString(new Date());
    expect((await h.api(admin).post(`/admin/reconciliation/run?date=${date}`)).body.matched).toBe(true);
    await h.prisma.mockGatewayTxn.create({ data: { kind: 'CREDIT', ref: 'rogue', amountPaise: 999n } });
    expect((await h.api(admin).post(`/admin/reconciliation/run?date=${date}`)).body.matched).toBe(false);
    expect(await h.prisma.adminAlert.count({ where: { kind: 'RECONCILIATION_MISMATCH' } })).toBe(1);
  });
});

describe('ledger guarantees', () => {
  it('the database refuses unbalanced journals', async () => {
    const acc = await h.prisma.ledgerAccount.create({ data: { code: 'test_acc', type: 'ASSET' } });
    await expect(h.prisma.$transaction(async (tx) => {
      const j = await tx.journalEntry.create({ data: { idempotencyKey: 'bad', type: 'TEST' } });
      await tx.ledgerPosting.create({ data: { journalId: j.id, accountId: acc.id, amountPaise: 100n } });
    })).rejects.toThrow();
  });
  it('the code refuses unbalanced journals', async () => {
    await expect(h.prisma.tx((tx) => h.ledger.post(tx, { key: 'x', type: 'T', lines: [{ account: 'a', debit: 5n }, { account: 'b', credit: 4n }] }))).rejects.toThrow(/Unbalanced/);
  });
  it('postings are append-only', async () => {
    await h.prisma.tx((tx) => h.ledger.post(tx, { key: 'ok', type: 'T', lines: [{ account: 'a', debit: 5n }, { account: 'b', credit: 5n }] }));
    await expect(h.prisma.ledgerPosting.updateMany({ data: { amountPaise: 1n } })).rejects.toThrow();
    await expect(h.prisma.ledgerPosting.deleteMany()).rejects.toThrow();
    await expect(h.prisma.journalEntry.deleteMany()).rejects.toThrow();
  });
  it('the same idempotency key posts once', async () => {
    const j = { key: 'same', type: 'T', lines: [{ account: 'a', debit: 5n }, { account: 'b', credit: 5n }] };
    await h.prisma.tx((tx) => h.ledger.post(tx, j));
    await h.prisma.tx((tx) => h.ledger.post(tx, j));
    expect(await h.ledger.balance('a')).toBe(5n);
  });
});

describe('SLA engine', () => {
  it('unpaid balance at the deadline is a buyer default; admin decides; forfeiture is off by default', async () => {
    const [buyer, farmer, admin] = [await h.buyer(), await h.farmer(), await h.admin()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id);
    await h.advanceHours(24 * 5);
    expect(await h.state(o.id)).toBe('BUYER_DEFAULTED');
    expect(await h.prisma.adminAlert.count({ where: { kind: 'BUYER_DEFAULT' } })).toBe(1);
    expect(await h.ledger.escrowBalance(o.id)).toBe(rupees(150_000)); // Held until an admin decides.
    expect((await h.api(admin).post(`/admin/orders/${o.id}/buyer-default/refund`, { reason: 'Policy: full refund' })).status).toBe(200);
    expect(await h.state(o.id)).toBe('REFUNDED');
    expect(await h.assertBooksClosed(o.id)).toEqual({ escrow: 0n, nodal: 0n, trial: 0n });
    expect(await h.ledger.farmerOwes(farmer.id)).toBe(0n); // The buyer defaulted, so the farmer owes nothing.
  });
  it('with the forfeiture flag on, the advance goes to the farmer instead', async () => {
    const [buyer, farmer, admin] = [await h.buyer(), await h.farmer(), await h.admin()];
    await h.api(admin).put('/masters/config/advanceForfeitureOnBuyerDefault', { value: true });
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id);
    await h.advanceHours(24 * 5);
    await h.api(admin).post(`/admin/orders/${o.id}/buyer-default/refund`, { reason: 'Forfeit per policy' });
    expect((await h.prisma.payout.findFirstOrThrow({ where: { orderId: o.id, payeeType: 'FARMER' } })).amountPaise).toBe(rupees(150_000));
    expect(await h.prisma.refund.count({ where: { orderId: o.id } })).toBe(0);
    expect(await h.assertBooksClosed(o.id)).toEqual({ escrow: 0n, nodal: 0n, trial: 0n });
  });
  it('a fully funded order that misses the deadline goes to the ops board, without an automatic default', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.fundExternal(buyer, o.id);
    await h.advanceHours(24 * 5);
    expect(await h.state(o.id)).toBe('INSPECTION_SCHEDULED');
    expect(await h.prisma.adminAlert.count({ where: { kind: 'SLA_BREACH', orderId: o.id } })).toBe(1);
  });
  it('sends reminders at T-24, T-6, T-1, and only once each', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id);
    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    h.clock.setNow(new Date(row.slaDeadlineAt!.getTime() - 30 * 60_000));
    await h.timers.fireDue();
    await h.timers.fireDue();
    expect(await h.prisma.notificationOutbox.count({ where: { template: 'sla_reminder' } })).toBe(6); // 3 reminders × 2 parties.
  });
  it('a timer fires at most once, even if two workers race', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id);
    const t = await h.prisma.slaTimer.findFirstOrThrow({ where: { orderId: o.id, kind: 'SLA_BREACH' } });
    h.clock.setNow(new Date(t.fireAt.getTime() + 1000));
    const rs = await Promise.all([h.timers.fire(t.id), h.timers.fire(t.id), h.timers.fire(t.id)]);
    expect(rs.filter(Boolean)).toHaveLength(1);
  });
  it('picks the nearest available inspector, respects the radius, and respects the daily cap', async () => {
    const [buyer, farmer, far, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    await h.prisma.inspectorProfile.update({ where: { userId: far.id }, data: { lat: NAGAON.lat + 0.3, lng: NAGAON.lng } }); // ~33 km away.
    const near = await h.inspector();
    await h.api(admin).put('/masters/config/inspectorMaxJobsPerDay', { value: 1 });
    const o1 = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o1.id);
    expect((await h.prisma.inspection.findUniqueOrThrow({ where: { orderId: o1.id } })).inspectorId).toBe(near.id);
    const o2 = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o2.id);
    expect((await h.prisma.inspection.findUniqueOrThrow({ where: { orderId: o2.id } })).inspectorId).toBe(far.id); // The nearer one is at cap.
    const o3 = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o3.id);
    expect((await h.prisma.inspection.findUniqueOrThrow({ where: { orderId: o3.id } })).status).toBe('UNASSIGNED');
  });
  it('escalation ladder: retries, then an admin alert, and manual assignment still works', async () => {
    const [buyer, farmer, admin] = [await h.buyer(), await h.farmer(), await h.admin()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id);
    expect(await h.prisma.slaTimer.count({ where: { orderId: o.id, kind: 'INSPECTOR_RETRY', status: 'PENDING' } })).toBe(1);
    await h.advanceHours(3); await h.advanceHours(3);
    expect((await h.prisma.inspection.findUniqueOrThrow({ where: { orderId: o.id } })).assignAttempts).toBe(3);
    expect(await h.prisma.adminAlert.count({ where: { kind: 'INSPECTOR_ESCALATION' } })).toBe(1);
    const insp = await h.inspector({ available: false });
    expect((await h.api(admin).post(`/admin/orders/${o.id}/assign-inspector`, { inspectorId: insp.id })).status).toBe(200);
    expect((await h.prisma.inspection.findUniqueOrThrow({ where: { orderId: o.id } })).inspectorId).toBe(insp.id);
    expect(await h.prisma.auditLog.count({ where: { action: 'INSPECTOR_MANUALLY_ASSIGNED' } })).toBe(1);
  });
  it('GPS check-in must be within 500 m, and mark-inspected is blocked without check-in', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.fundExternal(buyer, o.id);
    const i = await h.prisma.inspection.findUniqueOrThrow({ where: { orderId: o.id } });
    expect((await h.api(inspector).post(`/inspections/${i.id}/mark-inspected`)).body.code).toBe('CHECK_IN_REQUIRED');
    expect((await h.api(inspector).post(`/inspections/${i.id}/check-in`, { lat: NAGAON.lat + 0.02, lng: NAGAON.lng })).body.code).toBe('OUTSIDE_RADIUS');
    expect((await h.api(inspector).post(`/inspections/${i.id}/grading`, { readings: {}, scaleWeightKg: 1, photoFileIds: ['x'] })).body.code).toBe('CHECK_IN_REQUIRED');
    expect((await h.api(inspector).post(`/inspections/${i.id}/check-in`, { lat: NAGAON.lat + 0.002, lng: NAGAON.lng })).status).toBe(200);
    expect((await h.api(inspector).post(`/inspections/${i.id}/mark-inspected`)).body.code).toBe('GRADING_INCOMPLETE');
  });
  it('the grading form is driven by the spec: missing and unknown fields are refused', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.fundExternal(buyer, o.id);
    const i = await h.prisma.inspection.findUniqueOrThrow({ where: { orderId: o.id } });
    await h.api(inspector).post(`/inspections/${i.id}/check-in`, { lat: NAGAON.lat, lng: NAGAON.lng });
    const photo = await h.upload(inspector, 'INSPECTION_PHOTO');
    const r = await h.api(inspector).post(`/inspections/${i.id}/grading`, { readings: { moisture: 13, notes: 5 }, scaleWeightKg: 10_000, photoFileIds: [photo] });
    expect(r.body.code).toBe('GRADING_INCOMPLETE');
    expect(r.body.missing).toEqual(['foreignMatter', 'damaged']);
    expect(r.body.invalid).toEqual(['notes']);
  });
  it('out-of-spec produce does not pass; the buyer may knowingly accept the deviation', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.fundExternal(buyer, o.id);
    const r = await h.inspect(inspector, o.id, 10_000, { moisture: 20, foreignMatter: 0.5, damaged: 1 });
    expect(r.body).toEqual({ result: 'FAILED_GRADE', outOfSpec: ['moisture'] });
    expect(await h.state(o.id)).toBe('INSPECTION_SCHEDULED');
    expect(await h.prisma.adminAlert.count({ where: { kind: 'INSPECTION_FAILED' } })).toBe(1);
    expect((await h.api(buyer).post(`/orders/${o.id}/depart`)).status).toBe(409);
    expect((await h.api(buyer).post(`/orders/${o.id}/deviation/accept`)).status).toBe(200);
    expect(await h.state(o.id)).toBe('INSPECTED');
  });
});

describe('abandoned matches', () => {
  it('an unpaid catalog order expires and the listing goes back on sale', async () => {
    const [b1, b2, farmer] = [await h.buyer(), await h.buyer(), await h.farmer()];
    const o = await h.catalogOrder(b1, farmer);
    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    const listingId = row.listingId!;
    await h.advanceHours(47);
    expect(await h.state(o.id)).toBe('AWAITING_ADVANCE');
    await h.advanceHours(2);
    expect(await h.state(o.id)).toBe('CANCELLED');
    expect((await h.prisma.listing.findUniqueOrThrow({ where: { id: listingId } })).state).toBe('LISTED');
    expect((await h.api(b2).post(`/listings/${listingId}/accept`, { acceptContract: true, deliveryPin: GUWAHATI_PIN })).status).toBe(200);
    // Cancelled means the numbers lock again.
    expect((await h.api(b1).get(`/orders/${o.id}`)).body.farmer.phoneUnlocked).toBe(false);
  });
  it('an RFQ reopens with its bids when the buyer cancels before paying', async () => {
    const [buyer, f1, f2] = [await h.buyer(), await h.farmer(), await h.farmer('Second')];
    const rfq = await h.api(buyer).post('/rfqs', { commodityId: h.commodityId, gradeId: h.gradeId, quantityKg: 5_000, deliveryPin: GUWAHATI_PIN, neededBy: new Date().toISOString(), targetPricePaisePerKg: '5000' });
    const b1 = await h.api(f1).post(`/rfqs/${rfq.body.id}/bids`, { quantityKg: 5_000, pricePaisePerKg: '4800' });
    const b2 = await h.api(f2).post(`/rfqs/${rfq.body.id}/bids`, { quantityKg: 5_000, pricePaisePerKg: '4900' });
    const o = await h.api(buyer).post(`/bids/${b1.body.id}/accept`, { acceptContract: true });
    expect((await h.api(buyer).post(`/orders/${o.body.id}/cancel`, { reason: 'Changed plans' })).status).toBe(200);
    expect((await h.prisma.rfq.findUniqueOrThrow({ where: { id: rfq.body.id } })).state).toBe('BIDDING');
    expect((await h.api(buyer).post(`/bids/${b2.body.id}/accept`, { acceptContract: true })).status).toBe(200);
  });
  it('a part-paid order neither expires nor can be cancelled away from its money', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer()];
    const o = await h.catalogOrder(buyer, farmer);
    await h.credit(buyer, o.id, rupees(1_000));
    expect((await h.api(buyer).post(`/orders/${o.id}/cancel`, { reason: 'Changed plans' })).body.code).toBe('ESCROW_NOT_EMPTY');
    await h.advanceHours(49);
    expect(await h.state(o.id)).toBe('AWAITING_ADVANCE');
    expect(await h.prisma.adminAlert.count({ where: { kind: 'UNDERPAYMENT', orderId: o.id } })).toBe(2);
  });
});

describe('error mapping', () => {
  it('a duplicate vehicle registration is a 409, not a 500', async () => {
    const p = await h.partner();
    const v = await h.prisma.vehicle.findFirstOrThrow({ where: { partnerId: p.id } });
    expect((await h.api(p).post('/onboarding/logistics/vehicles', { regNo: v.regNo, capacityKg: 5000 })).status).toBe(409);
  });
  it('only image, video and PDF uploads are accepted', async () => {
    const f = await h.farmer();
    const r = await h.api(f).post('/files/upload-url', { purpose: 'DISPATCH_PHOTO', sha256: 'c'.repeat(64), contentType: 'application/x-msdownload' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });
});

describe('disputes', () => {
  it('holds settlement, then a release pays out as normal', async () => {
    const [buyer, farmer, inspector, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    const o = await h.toDisputeWindow(buyer, farmer, inspector, 9_000);
    const ev = await h.upload(buyer, 'DISPUTE_EVIDENCE');
    const d = await h.api(buyer).post(`/orders/${o.id}/disputes`, { type: 'WEIGHT', reason: 'Lost a tonne', evidenceFileIds: [ev] });
    await h.advanceHours(48);
    expect(await h.state(o.id)).toBe('DISPUTED');
    expect(await h.prisma.payout.count({ where: { orderId: o.id, payeeType: 'FARMER' } })).toBe(0);
    const r = await h.api(admin).post(`/admin/disputes/${d.body.id}/resolve`, { outcome: 'RELEASE_TO_FARMER', note: 'Driver error, not farmer' });
    expect(r.body.orderState).toBe('SETTLED');
    expect((await h.prisma.payout.findFirstOrThrow({ where: { orderId: o.id, payeeType: 'FARMER' } })).amountPaise).toBe(rupees(482_000));
    expect(await h.prisma.auditLog.count({ where: { action: 'DISPUTE_RESOLVED' } })).toBe(1);
  });
  it('a full refund for farmer fault refunds and charges the fee to the farmer', async () => {
    const [buyer, farmer, inspector, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    const o = await h.toDisputeWindow(buyer, farmer, inspector, 9_900);
    const d = await h.api(buyer).post(`/orders/${o.id}/disputes`, { type: 'QUALITY', reason: 'Rotten on arrival', evidenceFileIds: [] });
    const r = await h.api(admin).post(`/admin/disputes/${d.body.id}/resolve`, { outcome: 'FULL_REFUND_FARMER_FAULT', note: 'Lab confirmed' });
    expect(r.body.orderState).toBe('REFUNDED');
    expect((await h.prisma.refund.aggregate({ where: { orderId: o.id }, _sum: { amountPaise: true } }))._sum.amountPaise).toBe(rupees(500_000));
    expect(await h.ledger.farmerOwes(farmer.id)).toBeGreaterThan(0n);
    expect(await h.assertBooksClosed(o.id)).toEqual({ escrow: 0n, nodal: 0n, trial: 0n });
  });
  it('a partial refund cannot exceed GMV', async () => {
    const [buyer, farmer, inspector, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    const o = await h.toDisputeWindow(buyer, farmer, inspector, 9_900);
    const d = await h.api(buyer).post(`/orders/${o.id}/disputes`, { type: 'QUALITY', reason: 'Rotten on arrival', evidenceFileIds: [] });
    expect((await h.api(admin).post(`/admin/disputes/${d.body.id}/resolve`, { outcome: 'PARTIAL_REFUND', refundPaise: String(rupees(500_001)), note: 'Too much' })).body.code).toBe('REFUND_INVALID');
  });
});

describe('marketplace rules', () => {
  it('buyer needs KYB; farmer needs KYC', async () => {
    const b = await h.actor('BUYER', 'Unverified Co');
    const body = { commodityId: 'x', gradeId: 'y', quantityKg: 1000, deliveryPin: GUWAHATI_PIN, neededBy: new Date().toISOString(), targetPricePaisePerKg: '100' };
    expect((await h.api(b).post('/rfqs', body)).body.code).toBe('KYB_REQUIRED');
    const f = await h.actor('FARMER', 'Unverified Farmer');
    expect((await h.api(f).post('/listings', { commodityId: 'x', gradeId: 'y', quantityKg: 1000, pricePaisePerKg: '100' })).body.code).toBe('KYC_REQUIRED');
  });
  it('a bid must fill the RFQ and respect the target price', async () => {
    const [buyer, farmer, admin] = [await h.buyer(), await h.farmer(), await h.admin()];
    const rfq = await h.api(buyer).post('/rfqs', { commodityId: h.commodityId, gradeId: h.gradeId, quantityKg: 10_000, deliveryPin: GUWAHATI_PIN, neededBy: new Date().toISOString(), targetPricePaisePerKg: '5000' });
    expect((await h.api(farmer).post(`/rfqs/${rfq.body.id}/bids`, { quantityKg: 9_000, pricePaisePerKg: '5000' })).body.code).toBe('BID_QUANTITY');
    expect((await h.api(farmer).post(`/rfqs/${rfq.body.id}/bids`, { quantityKg: 10_000, pricePaisePerKg: '5001' })).body.code).toBe('BID_PRICE');
    expect((await h.api(farmer).post(`/rfqs/${rfq.body.id}/bids`, { quantityKg: 10_000, pricePaisePerKg: '4900' })).status).toBe(201);
    await h.api(admin).put('/masters/config/bidPriceRule', { value: 'EQ_TARGET' });
    expect((await h.api(farmer).post(`/rfqs/${rfq.body.id}/bids`, { quantityKg: 10_000, pricePaisePerKg: '4900' })).body.code).toBe('BID_PRICE');
  });
  it('accepting one bid rejects the others, and a grade must belong to its commodity', async () => {
    const [buyer, f1, f2] = [await h.buyer(), await h.farmer(), await h.farmer('Second Farmer')];
    const rfq = await h.api(buyer).post('/rfqs', { commodityId: h.commodityId, gradeId: h.gradeId, quantityKg: 5_000, deliveryPin: GUWAHATI_PIN, neededBy: new Date().toISOString(), targetPricePaisePerKg: '5000' });
    const b1 = await h.api(f1).post(`/rfqs/${rfq.body.id}/bids`, { quantityKg: 5_000, pricePaisePerKg: '4800' });
    const b2 = await h.api(f2).post(`/rfqs/${rfq.body.id}/bids`, { quantityKg: 5_000, pricePaisePerKg: '4900' });
    expect((await h.api(buyer).post(`/bids/${b1.body.id}/accept`, { acceptContract: false })).body.code).toBe('CONTRACT_NOT_ACCEPTED');
    expect((await h.api(buyer).post(`/bids/${b1.body.id}/accept`, { acceptContract: true })).status).toBe(200);
    expect((await h.prisma.bid.findUniqueOrThrow({ where: { id: b2.body.id } })).state).toBe('REJECTED');
    expect((await h.api(buyer).post(`/bids/${b2.body.id}/accept`, { acceptContract: true })).status).toBe(409);
    const other = await h.prisma.commodity.findUniqueOrThrow({ where: { code: 'ONION' } });
    expect((await h.api(buyer).post('/rfqs', { commodityId: other.id, gradeId: h.gradeId, quantityKg: 5_000, deliveryPin: GUWAHATI_PIN, neededBy: new Date().toISOString(), targetPricePaisePerKg: '5000' })).body.code).toBe('GRADE_INVALID');
  });
  it('price dashboard: daily ingest, series and suggestion', async () => {
    const buyer = await h.buyer();
    const today = shared.istDateString(h.clock.now());
    expect(await h.market.ingest(today)).toBeGreaterThan(0);
    await h.market.ingest(today); // Idempotent.
    const s = await h.api(buyer).get(`/market/suggestion?commodityId=${h.commodityId}`);
    expect(BigInt(s.body.averagePaisePerKg)).toBeGreaterThan(0n);
    expect(s.body.sampleSize).toBe(4);
    const series = await h.api(buyer).get(`/market/prices?commodityId=${h.commodityId}&market=Guwahati`);
    expect(series.body).toHaveLength(1);
    const rfq = await h.api(buyer).post('/rfqs', { commodityId: h.commodityId, gradeId: h.gradeId, quantityKg: 5_000, deliveryPin: GUWAHATI_PIN, neededBy: new Date().toISOString(), targetPricePaisePerKg: '5000' });
    expect(rfq.body.suggestedPricePaisePerKg).toBe(s.body.averagePaisePerKg);
  });
});

describe('auth & security', () => {
  it('OTP login, signup and wrong codes', async () => {
    const phone = '9812345678';
    const r = await h.api(null).post('/auth/otp/request', { phone });
    expect(r.status).toBe(200);
    expect(r.body.devOtp).toMatch(/^\d{6}$/);
    const wrong = r.body.devOtp === '000000' ? '000001' : '000000';
    expect((await h.api(null).post('/auth/otp/verify', { phone, code: wrong })).status).toBe(401);
    // A new number must say who it is, and the same code still works once it does.
    expect((await h.api(null).post('/auth/otp/verify', { phone, code: r.body.devOtp })).body.code).toBe('SIGNUP_DETAILS_REQUIRED');
    const v = await h.api(null).post('/auth/otp/verify', { phone, code: r.body.devOtp, role: 'FARMER', name: 'New Farmer' });
    expect(v.status).toBe(200);
    expect(v.body.user.role).toBe('FARMER');
    expect((await h.api({ token: v.body.accessToken } as never).get('/auth/me')).body.phone).toBe(`+91${phone}`);
    expect((await h.api(null).post('/auth/otp/verify', { phone, code: r.body.devOtp })).status).toBe(401); // Single use.
  });
  it('nobody can self-register as admin', async () => {
    const phone = '9812345679';
    const r = await h.api(null).post('/auth/otp/request', { phone });
    expect((await h.api(null).post('/auth/otp/verify', { phone, code: r.body.devOtp, role: 'ADMIN', name: 'Sneaky' })).status).toBe(400);
  });
  it('OTP requests are rate limited per phone', async () => {
    const phone = '9812345680';
    for (let i = 0; i < 5; i++) expect((await h.api(null).post('/auth/otp/request', { phone })).status).toBe(200);
    const r = await h.api(null).post('/auth/otp/request', { phone });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('OTP_RATE_LIMITED');
  });
  it('repeated wrong guesses burn the code', async () => {
    const phone = '9812345681';
    const r = await h.api(null).post('/auth/otp/request', { phone });
    const wrong = r.body.devOtp === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) await h.api(null).post('/auth/otp/verify', { phone, code: wrong });
    expect((await h.api(null).post('/auth/otp/verify', { phone, code: r.body.devOtp, role: 'FARMER', name: 'Too Late' })).status).toBe(401);
  });
  it('refresh tokens rotate, and reuse revokes the family', async () => {
    const u = await h.auth.createUser({ phone: '+919812345682', role: 'BUYER', name: 'Rotator' });
    const t = await h.auth.issueTokens(u);
    const r1 = await h.api(null).post('/auth/refresh', { refreshToken: t.refreshToken });
    expect(r1.status).toBe(200);
    expect((await h.api(null).post('/auth/refresh', { refreshToken: t.refreshToken })).status).toBe(401);
    expect((await h.api(null).post('/auth/refresh', { refreshToken: r1.body.refreshToken })).status).toBe(401);
  });
  it('PII is encrypted at rest', async () => {
    const f = await h.actor('FARMER', 'Encrypted');
    await h.api(f).post('/onboarding/farmer/kyc', { pan: 'ABCDE1234F', panName: 'Encrypted', bankAccount: '123456781234', ifsc: 'SBIN0001234', bankHolderName: 'Encrypted', pin: NAGAON.pin });
    const raw = await h.prisma.$queryRaw<Record<string, string>[]>`SELECT u."phoneEnc", p."panEnc", p."bankAccountEnc" FROM "User" u JOIN "FarmerProfile" p ON p."userId" = u.id WHERE u.id = ${f.id}`;
    expect(raw[0]!.phoneEnc).not.toContain(f.phone.slice(3));
    expect(raw[0]!.panEnc).not.toContain('ABCDE1234F');
    expect(raw[0]!.bankAccountEnc).not.toContain('123456781234');
    expect(h.crypto.decrypt(raw[0]!.panEnc!)).toBe('ABCDE1234F');
  });
  it('row-level ownership: outsiders get 404; roles get 403', async () => {
    const [buyer, farmer, other, otherFarmer, inspector] = [await h.buyer(), await h.farmer(), await h.buyer(), await h.farmer('Stranger'), await h.inspector()];
    const o = await h.rfqOrder(buyer, farmer);
    expect((await h.api(other).get(`/orders/${o.id}`)).status).toBe(404);
    expect((await h.api(otherFarmer).get(`/orders/${o.id}`)).status).toBe(404);
    expect((await h.api(inspector).get(`/orders/${o.id}`)).status).toBe(404);
    expect((await h.api(other).post(`/orders/${o.id}/logistics/external`, { vehicleNo: 'AS01AB1234', driverPhone: '9876543210' })).status).toBe(404);
    expect((await h.api(other).post(`/dev/mock-bank/orders/${o.id}/credit`)).status).toBe(404);
    expect((await h.api(buyer).get('/admin/orders')).status).toBe(403);
    expect((await h.api(null).get('/orders')).status).toBe(401);
  });
  it('inspectors see no commercial terms', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id);
    const v = await h.api(inspector).get(`/orders/${o.id}`);
    expect(v.status).toBe(200);
    expect(v.body.gmvPaise).toBeUndefined();
    expect(v.body.pricePaisePerKg).toBeUndefined();
    expect(v.body.virtualAccount).toBeUndefined();
    expect(v.body.buyer).toBeUndefined();
  });
  it('files need a matching hash, and strangers cannot read them', async () => {
    const [a, b] = [await h.farmer(), await h.farmer('Other')];
    const file = await h.upload(a, 'DISPATCH_PHOTO');
    expect((await h.api(a).get(`/files/${file}/download-url`)).status).toBe(200);
    expect((await h.api(b).get(`/files/${file}/download-url`)).status).toBe(403);
    const r = await h.api(a).post('/files/upload-url', { purpose: 'DISPATCH_PHOTO', sha256: 'b'.repeat(64), contentType: 'image/jpeg' });
    expect((await h.api(a).post(`/files/${r.body.fileId}/complete`)).body.code).toBe('FILE_NOT_UPLOADED');
    h.storage.put(r.body.key, Buffer.from('not what was declared'));
    expect((await h.api(a).post(`/files/${r.body.fileId}/complete`)).body.code).toBe('HASH_MISMATCH');
  });
  it('evidence is readable by the parties to the order and nobody else', async () => {
    const [buyer, farmer, inspector, other] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.buyer()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.fundExternal(buyer, o.id);
    await h.inspect(inspector, o.id);
    const { photoFileIds } = await h.prisma.inspection.findUniqueOrThrow({ where: { orderId: o.id } });
    expect((await h.api(buyer).get(`/files/${photoFileIds[0]}/download-url`)).status).toBe(200);
    expect((await h.api(farmer).get(`/files/${photoFileIds[0]}/download-url`)).status).toBe(200);
    expect((await h.api(other).get(`/files/${photoFileIds[0]}/download-url`)).status).toBe(403);
    const dispatch = await h.upload(farmer, 'DISPATCH_PHOTO');
    expect((await h.api(farmer).post(`/orders/${o.id}/dispatch-photos`, { fileId: dispatch })).status).toBe(201);
    expect((await h.api(buyer).get(`/files/${dispatch}/download-url`)).status).toBe(200);
    expect((await h.api(other).get(`/files/${dispatch}/download-url`)).status).toBe(403);
  });
  it('admin config changes are audited', async () => {
    const admin = await h.admin();
    await h.api(admin).put('/masters/config/disputeWindowHours', { value: 48 });
    expect(await h.prisma.auditLog.count({ where: { action: 'CONFIG_UPDATED', entityId: 'disputeWindowHours' } })).toBe(1);
    expect((await h.api(admin).put('/masters/config/disputeWindowHours', { value: 'long' })).status).toBe(400);
    expect((await h.api(admin).put('/masters/config/nonsense', { value: 1 })).status).toBe(404);
  });
  it('log redaction hides PII', () => {
    expect(redact({ phone: '+91', nested: { pan: 'X', amount: 5 }, list: [{ account_number: '1' }] })).toEqual({ phone: '[redacted]', nested: { pan: '[redacted]', amount: 5 }, list: [{ account_number: '[redacted]' }] });
  });
  it('health and metrics respond', async () => {
    const http = (await import('supertest')).default(h.app.getHttpServer());
    expect((await http.get('/health')).body.status).toBe('ok');
    expect((await http.get('/metrics')).text).toContain('agrimate_ledger_trial_balance_paise 0');
  });
  it('metrics need the token once one is set', async () => {
    const http = (await import('supertest')).default(h.app.getHttpServer());
    process.env.METRICS_TOKEN = 'metrics-test-token';
    try {
      expect((await http.get('/metrics')).status).toBe(401);
      expect((await http.get('/metrics').set('Authorization', 'Bearer wrong')).status).toBe(401);
      const ok = await http.get('/metrics').set('Authorization', 'Bearer metrics-test-token');
      expect(ok.status).toBe(200);
      expect(ok.text).toContain('agrimate_ledger_trial_balance_paise 0');
    } finally { delete process.env.METRICS_TOKEN; }
  });
  it('sends security headers, and does not trust forwarded IPs by default', async () => {
    const res = await (await import('supertest')).default(h.app.getHttpServer()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect((h.app.getHttpAdapter().getInstance() as { get(k: string): unknown }).get('trust proxy')).toBeFalsy();
  });
  it('rotates the PII key: preview writes nothing, both keys read during it, and it can be re-run', async () => {
    const crypto = h.app.get(CryptoService);
    const prisma = h.app.get(PrismaService) as unknown as PrismaClient;
    const buyer = await h.buyer();
    const before = (await h.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).phoneEnc;
    const phone = crypto.decrypt(before);
    const usersRow = (r: RotationReport[]) => r.find((x) => x.table === 'User')!;
    const original = process.env.PII_ENCRYPTION_KEY;
    process.env.PII_ENCRYPTION_KEY = 'rotation-test-new-key';
    try {
      // The old key is gone and not declared: nothing can be read, and nothing is damaged.
      const blocked = await rotatePiiKey(prisma, crypto, { dryRun: false });
      expect(usersRow(blocked).unreadable).toBeGreaterThan(0);
      expect((await h.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).phoneEnc).toBe(before);

      process.env.PII_ENCRYPTION_KEY_PREVIOUS = original ?? 'dev-only-pii-key-change-me';
      expect(crypto.decrypt(before)).toBe(phone);
      expect(usersRow(await rotatePiiKey(prisma, crypto, { dryRun: true })).rotated).toBeGreaterThan(0);
      expect((await h.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).phoneEnc).toBe(before);

      const applied = usersRow(await rotatePiiKey(prisma, crypto, { dryRun: false }));
      expect(applied.rotated).toBeGreaterThan(0);
      expect(applied.unreadable).toBe(0);
      const after = (await h.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).phoneEnc;
      expect(after).not.toBe(before);

      delete process.env.PII_ENCRYPTION_KEY_PREVIOUS;
      expect(crypto.decrypt(after)).toBe(phone);
      expect(() => crypto.decrypt(before)).toThrow();
      expect(usersRow(await rotatePiiKey(prisma, crypto, { dryRun: false }))).toMatchObject({ rotated: 0, unreadable: 0 });
    } finally {
      delete process.env.PII_ENCRYPTION_KEY_PREVIOUS;
      if (original === undefined) delete process.env.PII_ENCRYPTION_KEY; else process.env.PII_ENCRYPTION_KEY = original;
    }
  });
});

describe('notifications', () => {
  it('the outbox sends once and in the user\'s language', async () => {
    const f = await h.actor('FARMER', 'Assamese Farmer');
    await h.prisma.user.update({ where: { id: f.id }, data: { language: 'as' } });
    await h.notifications.enqueue(h.prisma, f.id, 'order_state', { code: 'AGR-1', state: 'MATCHED' });
    expect(await h.notifications.flush()).toBe(1);
    expect(await h.notifications.flush()).toBe(0);
    expect(h.sms.sent.at(-1)!.body).toContain('এগ্ৰিমেট');
  });
  it('a rollback sends nothing', async () => {
    const f = await h.actor('FARMER', 'Rollback');
    await expect(h.prisma.tx(async (tx) => { await h.notifications.enqueue(tx, f.id, 'order_state', { code: 'X', state: 'Y' }); throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await h.notifications.flush()).toBe(0);
  });
  it('every template exists in all launch languages', () => {
    for (const t of TEMPLATE_NAMES) for (const l of shared.LANGUAGES) expect(renderTemplate(t, l, {}).length).toBeGreaterThan(0);
  });
});

describe('contract parity', () => {
  const pairs: [string, Record<string, string>, Record<string, string>][] = [
    ['Role', $Enums.Role, shared.Role], ['OrderState', $Enums.OrderState, shared.OrderState], ['RfqState', $Enums.RfqState, shared.RfqState], ['ListingState', $Enums.ListingState, shared.ListingState], ['TrancheKind', $Enums.TrancheKind, shared.TrancheKind], ['InspectionStatus', $Enums.InspectionStatus, shared.InspectionStatus], ['TripStatus', $Enums.TripStatus, shared.TripStatus], ['DegreeType', $Enums.DegreeType, shared.DegreeType], ['FilePurpose', $Enums.FilePurpose, shared.FilePurpose], ['AlertKind', $Enums.AlertKind, shared.AlertKind], ['SlaTimerKind', $Enums.SlaTimerKind, shared.SlaTimerKind],
  ];
  it.each(pairs)('%s matches between Prisma and shared', (_n, a, b) => expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort()));
});
