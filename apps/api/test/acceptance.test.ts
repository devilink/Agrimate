/** Section 10 of the master prompt: the acceptance tests that must pass before this can be called done. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { computeFreight, rupees, selfCertFallbackAt, istDateString } from '@agrimate/shared';
import { Actor, FAR_AWAY, GUWAHATI_PIN, Harness, NAGAON } from './harness';
import { ORDER_TIMELINE_NO_SELF_CERT } from './expected';

let h: Harness;
beforeAll(async () => { h = await Harness.create(); });
afterAll(async () => { await h.close(); });
beforeEach(async () => { await h.reset(); });

const states = async (id: string) => (await h.prisma.orderEvent.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } })).map((e) => e.to);

/** Platform-logistics path from a matched order through PoD. Returns the partner, so tests can inspect payouts. */
async function platformToDelivered(buyer: Actor, inspector: Actor, orderId: string) {
  const partner = await h.partner();
  await h.credit(buyer, orderId); // 30%
  const booked = await h.api(buyer).post(`/orders/${orderId}/logistics/platform`);
  expect(booked.status).toBe(200);
  const freight = BigInt(booked.body.freightDuePaise);
  // Dispatch guard: the route is invisible to partners until the freight is fully in escrow.
  expect((await h.api(partner).get('/trips/available')).body).toHaveLength(0);
  await h.credit(buyer, orderId, freight);
  const avail = await h.api(partner).get('/trips/available');
  expect(avail.body).toHaveLength(1);
  const tripId = avail.body[0].id;
  await h.credit(buyer, orderId); // 70%
  expect(await h.state(orderId)).toBe('INSPECTION_SCHEDULED');
  expect((await h.inspect(inspector, orderId)).status).toBe(200);
  expect((await h.api(partner).post(`/trips/${tripId}/accept`, { vehicleId: partner.vehicleId, noCoLoadingAttested: true })).status).toBe(200);
  const eway = await h.upload(partner, 'EWAY_BILL');
  expect((await h.api(partner).post(`/trips/${tripId}/eway-bill`, { ewayBillNumber: 'EWB123456789', fileId: eway })).status).toBe(200);
  expect((await h.api(partner).post(`/trips/${tripId}/pickup`)).status).toBe(200);
  expect(await h.state(orderId)).toBe('IN_TRANSIT');
  await h.notifications.flush();
  const sms = h.sms.sent.filter((m) => m.body.includes('delivery code')).at(-1)!;
  const otp = /code (\d{6})/.exec(sms.body)![1]!;
  const pod = await h.upload(partner, 'POD_PHOTO');
  const del = await h.api(partner).post(`/trips/${tripId}/deliver`, { podPhotoFileId: pod, lat: 26.18, lng: 91.75, receivedWeightKg: 9_900, receiverOtp: otp });
  expect(del.status).toBe(200);
  return { partner, freight, tripId };
}

describe('1. Case 1: buyer-led RFQ happy path', () => {
  it('runs end to end with phones unlocking at match, and the ledger closes to zero', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];

    // Numbers are masked before MATCHED, in the API as well as the UI.
    const rfq = await h.api(buyer).post('/rfqs', { commodityId: h.commodityId, gradeId: h.gradeId, quantityKg: 10_000, deliveryPin: GUWAHATI_PIN, neededBy: new Date(Date.now() + 864e6).toISOString(), targetPricePaisePerKg: '5000' });
    expect(rfq.status).toBe(201);
    const feed = await h.api(farmer).get('/rfqs');
    expect(JSON.stringify(feed.body)).not.toContain(buyer.phone);
    expect(feed.body[0].buyerPhoneMasked).toContain('******');
    const bid = await h.api(farmer).post(`/rfqs/${rfq.body.id}/bids`, { quantityKg: 10_000, pricePaisePerKg: '5000' });
    const inbox = await h.api(buyer).get(`/rfqs/${rfq.body.id}/bids`);
    expect(JSON.stringify(inbox.body)).not.toContain(farmer.phone);
    expect(inbox.body[0].farmer.phoneMasked).toContain('******');

    // Match: both numbers unlock.
    const accepted = await h.api(buyer).post(`/bids/${bid.body.id}/accept`, { acceptContract: true });
    expect(accepted.status).toBe(200);
    const orderId = accepted.body.id;
    expect(accepted.body.state).toBe('AWAITING_ADVANCE');
    expect(accepted.body.farmer.phone).toBe(farmer.phone);
    expect(accepted.body.farmer.phoneUnlocked).toBe(true);
    expect((await h.api(farmer).get(`/orders/${orderId}`)).body.buyer.phone).toBe(buyer.phone);

    // VAN per order, and the contract version on record.
    expect(accepted.body.virtualAccount.ifsc).toMatch(/^[A-Z]{4}0/);
    expect(accepted.body.virtualAccount.accountNumber).toBeTruthy();
    expect(accepted.body.contract.version).toBe('1.0');

    // 30% credit: T0, SLA, inspector assigned for Day 3.
    const t0Before = h.clock.now();
    await h.credit(buyer, orderId, rupees(150_000));
    const o = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { inspection: true } });
    expect(o.state).toBe('LOGISTICS_PENDING');
    expect(o.t0At!.getTime()).toBeGreaterThanOrEqual(t0Before.getTime());
    expect(o.inspection!.inspectorId).toBe(inspector.id);
    expect(o.inspection!.status).toBe('ASSIGNED');
    expect(istDateString(o.inspection!.scheduledFor)).toBe(istDateString(new Date(o.t0At!.getTime() + 3 * 86_400_000)));
    expect(o.slaDays).toBe(3);

    // Platform logistics, freight in full, 70%, inspection, transit, PoD.
    const partner = await h.partner();
    const booked = await h.api(buyer).post(`/orders/${orderId}/logistics/platform`);
    const freight = BigInt(booked.body.freightDuePaise);
    expect(await h.state(orderId)).toBe('LOGISTICS_PENDING');
    await h.credit(buyer, orderId, freight);
    expect(await h.state(orderId)).toBe('AWAITING_BALANCE');
    const trip = (await h.api(partner).get('/trips/available')).body[0];
    await h.credit(buyer, orderId, rupees(350_000));
    expect(await h.state(orderId)).toBe('INSPECTION_SCHEDULED');
    expect((await h.inspect(inspector, orderId)).body).toEqual({ result: 'INSPECTED' });
    await h.api(partner).post(`/trips/${trip.id}/accept`, { vehicleId: partner.vehicleId, noCoLoadingAttested: true });
    const eway = await h.upload(partner, 'EWAY_BILL');
    await h.api(partner).post(`/trips/${trip.id}/eway-bill`, { ewayBillNumber: 'EWB123456789', fileId: eway });
    await h.api(partner).post(`/trips/${trip.id}/pickup`);
    await h.notifications.flush();
    const otp = /code (\d{6})/.exec(h.sms.sent.filter((m) => m.body.includes('delivery code')).at(-1)!.body)![1];
    const pod = await h.upload(partner, 'POD_PHOTO');
    expect((await h.api(partner).post(`/trips/${trip.id}/deliver`, { podPhotoFileId: pod, lat: 26.18, lng: 91.75, receivedWeightKg: 9_900, receiverOtp: otp })).status).toBe(200);

    // Freight pays on PoD, before the window closes. The partner gets it net of the 8% markup.
    expect(await h.state(orderId)).toBe('DISPUTE_WINDOW');
    const t = await h.prisma.trip.findUniqueOrThrow({ where: { orderId } });
    const logisticsPayout = await h.prisma.payout.findFirstOrThrow({ where: { orderId, payeeType: 'LOGISTICS' } });
    expect(logisticsPayout.status).toBe('PROCESSED');
    expect(logisticsPayout.amountPaise).toBe(t.baseCostPaise);
    expect(await h.prisma.payout.count({ where: { orderId, payeeType: 'FARMER' } })).toBe(0);

    // The window is 24 h and then auto-settles.
    await h.advanceHours(23);
    expect(await h.state(orderId)).toBe('DISPUTE_WINDOW');
    await h.advanceHours(2);
    expect(await h.state(orderId)).toBe('SETTLED');

    const farmerPayout = await h.prisma.payout.findFirstOrThrow({ where: { orderId, payeeType: 'FARMER' } });
    expect(farmerPayout.amountPaise).toBe(rupees(482_000));
    expect(farmerPayout.status).toBe('PROCESSED');
    expect(await h.assertBooksClosed(orderId)).toEqual({ escrow: 0n, nodal: 0n, trial: 0n });
    expect(await states(orderId)).toEqual(ORDER_TIMELINE_NO_SELF_CERT);

    // Invoices exist, and each party can only see its own.
    const buyerInv = (await h.api(buyer).get(`/orders/${orderId}/invoices`)).body;
    expect(buyerInv.map((i: { type: string }) => i.type)).toEqual(['BUYER_INVOICE']);
    const pdf = await h.api(buyer).get(`/invoices/${buyerInv[0].id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((await h.api(farmer).get(`/invoices/${buyerInv[0].id}/pdf`)).status).toBe(404);
  });
});

describe('2. Case 2: farmer-led catalog happy path', () => {
  it('uses a 2-day SLA with Day-2 inspection, and closes the books', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.catalogOrder(buyer, farmer);
    await h.credit(buyer, o.id);
    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { inspection: true } });
    expect(row.flow).toBe('CATALOG');
    expect(row.slaDays).toBe(2);
    expect(istDateString(row.inspection!.scheduledFor)).toBe(istDateString(new Date(row.t0At!.getTime() + 2 * 86_400_000)));
    const { freight } = await platformContinue(buyer, inspector, o.id);
    expect(freight).toBeGreaterThan(0n);
    await h.advanceHours(25);
    expect(await h.state(o.id)).toBe('SETTLED');
    expect((await h.prisma.payout.findFirstOrThrow({ where: { orderId: o.id, payeeType: 'FARMER' } })).amountPaise).toBe(rupees(482_000));
    expect(await h.assertBooksClosed(o.id)).toEqual({ escrow: 0n, nodal: 0n, trial: 0n });
  });
  it('a listing can only be sold once', async () => {
    const [b1, b2, farmer] = [await h.buyer(), await h.buyer(), await h.farmer()];
    const l = await h.api(farmer).post('/listings', { commodityId: h.commodityId, gradeId: h.gradeId, quantityKg: 5_000, pricePaisePerKg: '5000' });
    expect((await h.api(b1).post(`/listings/${l.body.id}/accept`, { acceptContract: true, deliveryPin: GUWAHATI_PIN })).status).toBe(200);
    expect((await h.api(b2).post(`/listings/${l.body.id}/accept`, { acceptContract: true, deliveryPin: GUWAHATI_PIN })).status).toBe(409);
  });
});

/** Same as platformToDelivered, for an order whose advance is already paid. */
async function platformContinue(buyer: Actor, inspector: Actor, orderId: string) {
  const partner = await h.partner();
  const booked = await h.api(buyer).post(`/orders/${orderId}/logistics/platform`);
  const freight = BigInt(booked.body.freightDuePaise);
  await h.credit(buyer, orderId, freight);
  await h.credit(buyer, orderId);
  expect((await h.inspect(inspector, orderId)).status).toBe(200);
  const tripId = (await h.api(partner).get('/trips/available')).body[0].id;
  await h.api(partner).post(`/trips/${tripId}/accept`, { vehicleId: partner.vehicleId, noCoLoadingAttested: true });
  await h.api(partner).post(`/trips/${tripId}/eway-bill`, { ewayBillNumber: 'EWB999999999', fileId: await h.upload(partner, 'EWAY_BILL') });
  await h.api(partner).post(`/trips/${tripId}/pickup`);
  const sig = await h.upload(partner, 'POD_SIGNATURE');
  const del = await h.api(partner).post(`/trips/${tripId}/deliver`, { podPhotoFileId: await h.upload(partner, 'POD_PHOTO'), lat: 26.18, lng: 91.75, receivedWeightKg: 9_950, signatureFileId: sig });
  expect(del.status).toBe(200);
  return { freight };
}

describe('3. Freight calculator', () => {
  it('matches the worked example at the formula level', () => {
    const q = computeFreight({ distanceMetres: 200_000, vehicleRatePaisePerKm: rupees(45), loadingFeePaise: rupees(1000), quantityKg: 10_000 });
    expect(q.finalFreightPaise).toBe(rupees(10_800));
    expect(q.displayPtkmPaise).toBe(540n);
  });
  it('reaches the buyer through the API with the full breakdown and PTKM', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer()];
    await h.prisma.vehicleTier.update({ where: { code: 'TEN_WHEELER' }, data: { ratePaisePerKm: 4500n } });
    await h.prisma.distanceCache.create({ data: { originPin: NAGAON.pin, destPin: GUWAHATI_PIN, metres: 200_000, provider: 'test' } });
    const o = await h.rfqOrder(buyer, farmer);
    const q = await h.api(buyer).get(`/orders/${o.id}/freight-quote`);
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({ distanceKm: 200, tonnes: 10, baseCostPaise: '1000000', markupPaise: '80000', finalFreightPaise: '1080000', displayPtkmPaise: '540', tierCode: 'TEN_WHEELER' });
    // Farmers do not get freight quotes.
    expect((await h.api(farmer).get(`/orders/${o.id}/freight-quote`)).status).toBe(403);
  });
  it('caches the distance by PIN pair', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.api(buyer).get(`/orders/${o.id}/freight-quote`);
    await h.api(buyer).get(`/orders/${o.id}/freight-quote`);
    expect(await h.prisma.distanceCache.count()).toBe(1);
  });
});

describe('4. Settlement', () => {
  it('pays the farmer ₹4,82,000 on the worked example, split correctly across accounts', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.toDisputeWindow(buyer, farmer, inspector, 9_900);
    await h.advanceHours(25);
    expect(await h.state(o.id)).toBe('SETTLED');
    expect((await h.prisma.payout.findFirstOrThrow({ where: { orderId: o.id, payeeType: 'FARMER' } })).amountPaise).toBe(rupees(482_000));
    expect(await h.ledger.balance('platform_commission')).toBe(-rupees(15_000));
    expect(await h.ledger.balance('inspection_fee')).toBe(-rupees(3_000));
    // Inspector gets the configured share of the fee.
    const insp = await h.prisma.payout.findFirstOrThrow({ where: { orderId: o.id, payeeType: 'INSPECTOR' } });
    expect(insp.amountPaise).toBe(rupees(2_100));
    expect(await h.assertBooksClosed(o.id)).toEqual({ escrow: 0n, nodal: 0n, trial: 0n });
  });
  it('snapshots commercial terms: a later config change does not touch a live order', async () => {
    const [buyer, farmer, inspector, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    const o = await h.toDisputeWindow(buyer, farmer, inspector, 9_900);
    expect((await h.api(admin).put('/masters/config/commissionBps', { value: 900 })).status).toBe(200);
    await h.advanceHours(25);
    expect((await h.prisma.payout.findFirstOrThrow({ where: { orderId: o.id, payeeType: 'FARMER' } })).amountPaise).toBe(rupees(482_000));
  });
});

describe('5. Inspection fee tiers on real orders', () => {
  it.each([[1_900, 800], [2_000, 800], [2_500, 1500], [3_000, 1500], [7_000, 1500], [7_100, 3000]])('%i kg → ₹%i', async (kg, fee) => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer()];
    const o = await h.rfqOrder(buyer, farmer, { quantityKg: kg });
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.id } })).inspectionFeePaise).toBe(rupees(fee));
  });
  it('admin-edited tiers apply to new orders', async () => {
    const [buyer, farmer, admin] = [await h.buyer(), await h.farmer(), await h.admin()];
    const r = await h.api(admin).put('/masters/inspection-tiers', { tiers: [{ maxKgInclusive: 5000, feePaise: '100000' }, { feePaise: '200000' }] });
    expect(r.status).toBe(200);
    const o = await h.rfqOrder(buyer, farmer, { quantityKg: 4_000 });
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.id } })).inspectionFeePaise).toBe(rupees(1000));
  });
});

describe('6. Farmer default', () => {
  it('refunds the buyer 100% (advance + balance + freight), posts the actual gateway fee as a negative balance, and offsets it on the next payout', async () => {
    const [buyer, farmer, inspector, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id);
    const booked = await h.api(buyer).post(`/orders/${o.id}/logistics/platform`);
    const freight = BigInt(booked.body.freightDuePaise);
    await h.credit(buyer, o.id, freight);
    await h.credit(buyer, o.id);
    const total = rupees(500_000) + freight;
    expect(await h.ledger.escrowBalance(o.id)).toBe(total);
    const fees = (await h.prisma.gatewayPayment.aggregate({ _sum: { feePaise: true } }))._sum.feePaise!;
    expect(fees).toBeGreaterThan(0n);

    const r = await h.api(admin).post(`/admin/orders/${o.id}/farmer-default`, { reason: 'Produce never harvested' });
    expect(r.status).toBe(200);
    expect(await h.state(o.id)).toBe('REFUNDED');

    // 100% back, and the refund rows add up to exactly what was paid.
    const refunded = (await h.prisma.refund.aggregate({ where: { orderId: o.id }, _sum: { amountPaise: true } }))._sum.amountPaise;
    expect(refunded).toBe(total);
    expect(await h.assertBooksClosed(o.id)).toEqual({ escrow: 0n, nodal: 0n, trial: 0n });

    // The actual gateway fee sits on the farmer, visible to them.
    expect(await h.ledger.farmerOwes(farmer.id)).toBe(fees);
    const ledger = await h.api(farmer).get('/ledger/me');
    expect(ledger.body.negativeBalancePaise).toBe(fees.toString());

    // Next order: the same farmer's payout is reduced by exactly that amount, and the balance clears.
    const next = await h.toDisputeWindow(buyer, farmer, inspector, 9_900);
    await h.advanceHours(25);
    expect(await h.state(next.id)).toBe('SETTLED');
    const payout = await h.prisma.payout.findFirstOrThrow({ where: { orderId: next.id, payeeType: 'FARMER' } });
    expect(payout.amountPaise).toBe(rupees(482_000) - fees);
    expect(await h.ledger.farmerOwes(farmer.id)).toBe(0n);
    expect(await h.ledger.trialBalance()).toBe(0n);
    expect(await h.ledger.nodalForOrder(next.id)).toBe(0n);
  });
  it('after a farmer default the inspector still gets paid for work done', async () => {
    const [buyer, farmer, inspector, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.fundExternal(buyer, o.id);
    expect((await h.inspect(inspector, o.id)).status).toBe(200);
    await h.api(admin).post(`/admin/orders/${o.id}/farmer-default`, { reason: 'Sold elsewhere' });
    expect((await h.prisma.payout.findFirstOrThrow({ where: { orderId: o.id, payeeType: 'INSPECTOR' } })).status).toBe('PROCESSED');
    expect(await h.assertBooksClosed(o.id)).toEqual({ escrow: 0n, nodal: 0n, trial: 0n });
  });
  it('a farmer cannot default once produce is in transit', async () => {
    const [buyer, farmer, inspector, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.fundExternal(buyer, o.id);
    await h.inspect(inspector, o.id);
    await h.api(buyer).post(`/orders/${o.id}/depart`);
    expect((await h.api(admin).post(`/admin/orders/${o.id}/farmer-default`, { reason: 'Too late now' })).status).toBe(409);
  });
});

describe('7. Shrinkage guard', () => {
  it('API rejects a weight dispute at exactly 2.5%, and the UI eligibility endpoint agrees', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.toDisputeWindow(buyer, farmer, inspector, 9_750);
    const el = await h.api(buyer).get(`/orders/${o.id}/dispute-eligibility`);
    expect(el.body).toMatchObject({ weightDisputeAllowed: false, discrepancyPercent: 2.5, windowOpen: true });
    const ev = await h.upload(buyer, 'DISPUTE_EVIDENCE');
    const r = await h.api(buyer).post(`/orders/${o.id}/disputes`, { type: 'WEIGHT', reason: 'Short weight', evidenceFileIds: [ev] });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('WITHIN_SHRINKAGE_TOLERANCE');
    expect(await h.state(o.id)).toBe('DISPUTE_WINDOW');
  });
  it('API allows it at 2.6%, with evidence required', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.toDisputeWindow(buyer, farmer, inspector, 9_740);
    expect((await h.api(buyer).get(`/orders/${o.id}/dispute-eligibility`)).body.weightDisputeAllowed).toBe(true);
    const noEv = await h.api(buyer).post(`/orders/${o.id}/disputes`, { type: 'WEIGHT', reason: 'Short weight', evidenceFileIds: [] });
    expect(noEv.status).toBe(422);
    expect(noEv.body.code).toBe('EVIDENCE_REQUIRED');
    const ev = await h.upload(buyer, 'DISPUTE_EVIDENCE');
    const r = await h.api(buyer).post(`/orders/${o.id}/disputes`, { type: 'WEIGHT', reason: 'Short weight', evidenceFileIds: [ev] });
    expect(r.status).toBe(201);
    expect(await h.state(o.id)).toBe('DISPUTED');
  });
  it('the buyer cannot supply a weight in the dispute request to get past the guard', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.toDisputeWindow(buyer, farmer, inspector, 9_750);
    const ev = await h.upload(buyer, 'DISPUTE_EVIDENCE');
    const r = await h.api(buyer).post(`/orders/${o.id}/disputes`, { type: 'WEIGHT', reason: 'Short weight', evidenceFileIds: [ev], receivedWeightKg: 5000 });
    expect(r.status).toBe(400); // Unknown field, refused outright by the validation pipe.
  });
  it('no dispute after the window closes', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.toDisputeWindow(buyer, farmer, inspector, 9_000);
    await h.advanceHours(25);
    const ev = await h.upload(buyer, 'DISPUTE_EVIDENCE');
    expect((await h.api(buyer).post(`/orders/${o.id}/disputes`, { type: 'WEIGHT', reason: 'Too late', evidenceFileIds: [ev] })).status).toBe(409);
  });
});

describe('8. Transit guard', () => {
  it('cannot depart without the 70% balance', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id);
    await h.api(buyer).post(`/orders/${o.id}/logistics/external`, { vehicleNo: 'AS01AB1234', driverPhone: '9876543210' });
    expect(await h.state(o.id)).toBe('AWAITING_BALANCE');
    expect((await h.api(buyer).post(`/orders/${o.id}/depart`)).status).toBe(409);
    // Inspection cannot close early either, so the balance guard cannot be side-stepped.
    const r = await h.inspect(inspector, o.id);
    expect(r.status).toBe(409);
    expect(await h.state(o.id)).toBe('AWAITING_BALANCE');
  });
  it('cannot depart without inspection or self-certification', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.fundExternal(buyer, o.id);
    expect(await h.state(o.id)).toBe('INSPECTION_SCHEDULED');
    const r = await h.api(buyer).post(`/orders/${o.id}/depart`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ILLEGAL_TRANSITION');
  });
  it('platform pickup is refused until the balance is in and inspection is done', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const partner = await h.partner();
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id);
    const booked = await h.api(buyer).post(`/orders/${o.id}/logistics/platform`);
    await h.credit(buyer, o.id, BigInt(booked.body.freightDuePaise));
    const tripId = (await h.api(partner).get('/trips/available')).body[0].id;
    await h.api(partner).post(`/trips/${tripId}/accept`, { vehicleId: partner.vehicleId, noCoLoadingAttested: true });
    await h.api(partner).post(`/trips/${tripId}/eway-bill`, { ewayBillNumber: 'EWB123456789', fileId: await h.upload(partner, 'EWAY_BILL') });
    expect((await h.api(partner).post(`/trips/${tripId}/pickup`)).status).toBe(409);
    expect(await h.state(o.id)).toBe('AWAITING_BALANCE');
  });
  it('illegal transitions return 409 and leave an unchanged event log', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer()];
    const o = await h.rfqOrder(buyer, farmer);
    const before = (await states(o.id)).length;
    expect((await h.api(buyer).post(`/orders/${o.id}/depart`)).status).toBe(409);
    expect((await states(o.id)).length).toBe(before);
  });
  it('order events are immutable at the database level', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer()];
    const o = await h.rfqOrder(buyer, farmer);
    await expect(h.prisma.orderEvent.updateMany({ where: { orderId: o.id }, data: { actorRole: 'HACKED' } })).rejects.toThrow();
    await expect(h.prisma.orderEvent.deleteMany({ where: { orderId: o.id } })).rejects.toThrow();
  });
});

describe('9. Onboarding rules', () => {
  it.each(['BSC_ANIMAL_HUSBANDRY', 'MSC_ANIMAL_HUSBANDRY', 'VETERINARY'])('rejects %s', async (degreeType) => {
    const insp = await h.actor('INSPECTOR', 'Vet');
    const file = await h.upload(insp, 'DEGREE_CERT');
    const r = await h.api(insp).post('/onboarding/inspector/degree', { degreeType, degreeFileId: file, pin: NAGAON.pin });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('DEGREE_NOT_ELIGIBLE');
    expect((await h.prisma.inspectorProfile.findUniqueOrThrow({ where: { userId: insp.id } })).status).toBe('NOT_SUBMITTED');
  });
  it('an agriculture degree still needs admin approval before any jobs', async () => {
    const [insp, admin] = [await h.actor('INSPECTOR', 'Agri'), await h.admin()];
    const file = await h.upload(insp, 'DEGREE_CERT');
    expect((await h.api(insp).post('/onboarding/inspector/degree', { degreeType: 'BSC_AGRICULTURE', degreeFileId: file, pin: NAGAON.pin })).status).toBe(201);
    expect((await h.api(insp).post('/onboarding/inspector/availability', { available: true })).status).toBe(403);
    expect((await h.api(admin).post(`/admin/queues/inspector/${insp.id}/review`, { decision: 'APPROVE' })).status).toBe(200);
    expect((await h.api(insp).post('/onboarding/inspector/availability', { available: true })).status).toBe(201);
  });
  const kyc = (bankAccount: string) => ({ pan: 'ABCDE1234F', panName: 'Hemanta Bora', bankAccount, ifsc: 'SBIN0001234', bankHolderName: 'Hemanta Bora', pin: NAGAON.pin });
  it('matching bank-holder and PAN names enable payouts', async () => {
    const f = await h.actor('FARMER', 'Hemanta');
    const r = await h.api(f).post('/onboarding/farmer/kyc', kyc('123456781234'));
    expect(r.body).toMatchObject({ kycStatus: 'VERIFIED', payoutsEnabled: true });
  });
  it('a mismatch goes to manual review and blocks payouts, until an admin clears it and the held money goes out', async () => {
    const [buyer, inspector, admin] = [await h.buyer(), await h.inspector(), await h.admin()];
    const f = await h.actor('FARMER', 'Hemanta');
    const r = await h.api(f).post('/onboarding/farmer/kyc', kyc('123456780000')); // The mock bank reports someone else on accounts ending 0000.
    expect(r.body).toMatchObject({ kycStatus: 'MANUAL_REVIEW', payoutsEnabled: false });

    const o = await h.toDisputeWindow(buyer, f, inspector, 9_900);
    await h.advanceHours(25);
    expect(await h.state(o.id)).toBe('SETTLED');
    let payout = await h.prisma.payout.findFirstOrThrow({ where: { orderId: o.id, payeeType: 'FARMER' } });
    expect(payout.status).toBe('BLOCKED');
    // Still owed, and the money is still at the gateway rather than swept to the platform.
    expect(await h.ledger.nodalForOrder(o.id)).toBe(rupees(482_000));

    expect((await h.api(admin).post(`/admin/queues/kyc/${f.id}/review`, { decision: 'APPROVE', note: 'Married name; verified by affidavit' })).status).toBe(200);
    payout = await h.prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(payout.status).toBe('PROCESSED');
    expect(await h.assertBooksClosed(o.id)).toEqual({ escrow: 0n, nodal: 0n, trial: 0n });
  });
  it('logistics partners must accept no co-loading at onboarding and on every trip', async () => {
    const p = await h.actor('LOGISTICS', 'Driver');
    const [rc, dl, fit] = [await h.upload(p, 'RC'), await h.upload(p, 'DRIVING_LICENCE'), await h.upload(p, 'FITNESS_CERT')];
    const body = { partnerType: 'INDIVIDUAL', rcFileId: rc, dlFileId: dl, fitnessFileId: fit };
    expect((await h.api(p).post('/onboarding/logistics/profile', { ...body, noCoLoadingAccepted: false })).body.code).toBe('NO_CO_LOADING_REQUIRED');
    expect((await h.api(p).post('/onboarding/logistics/profile', { ...body, partnerType: 'AGENCY', noCoLoadingAccepted: true })).body.code).toBe('GSTIN_REQUIRED');
    expect((await h.api(p).post('/onboarding/logistics/profile', { ...body, noCoLoadingAccepted: true })).status).toBe(201);

    const [buyer, farmer] = [await h.buyer(), await h.farmer()];
    const partner = await h.partner();
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id);
    const booked = await h.api(buyer).post(`/orders/${o.id}/logistics/platform`);
    await h.credit(buyer, o.id, BigInt(booked.body.freightDuePaise));
    const tripId = (await h.api(partner).get('/trips/available')).body[0].id;
    const r = await h.api(partner).post(`/trips/${tripId}/accept`, { vehicleId: partner.vehicleId, noCoLoadingAttested: false });
    expect(r.body.code).toBe('NO_CO_LOADING_REQUIRED');
  });
});

describe('10. No inspector: self-certification', () => {
  async function selfCertOrder() {
    const [buyer, farmer] = [await h.buyer(), await h.farmer()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.fundExternal(buyer, o.id);
    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    h.clock.setNow(new Date(selfCertFallbackAt(row.t0At!, row.slaDays).getTime() + 1000));
    await h.timers.fireDue();
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.id } })).selfCertRequired).toBe(true);
    return { buyer, farmer, orderId: o.id };
  }
  const clip = (file: string, token: string, o: Partial<{ lat: number; lng: number; capturedAt: string }> = {}) => ({ captureToken: token, fileId: file, lat: NAGAON.lat, lng: NAGAON.lng, capturedAt: h.clock.now().toISOString(), durationSec: 20, source: 'IN_APP_CAMERA', ...o });
  async function record(farmer: Actor, orderId: string, kind: string) {
    const s = await h.api(farmer).post(`/self-cert/${orderId}/session`, { kind });
    const file = await h.upload(farmer, 'SELF_CERT_VIDEO', { captureToken: s.body.captureToken });
    return { token: s.body.captureToken as string, file };
  }

  it('routes the farmer to self-certification, certifies, shows the badge and departs', async () => {
    const { buyer, farmer, orderId } = await selfCertOrder();
    for (const kind of ['SCALE', 'VEHICLE']) {
      const { token, file } = await record(farmer, orderId, kind);
      expect((await h.api(farmer).post(`/self-cert/${orderId}/clips`, clip(file, token))).status).toBe(201);
    }
    const s = await h.api(farmer).post(`/self-cert/${orderId}/submit`, { certifiedWeightKg: 10_000 });
    expect(s.status).toBe(200);
    expect(await h.state(orderId)).toBe('SELF_CERTIFIED');
    const view = await h.api(buyer).get(`/orders/${orderId}`);
    expect(view.body.selfCertifiedBadge).toBe(true);
    expect(view.body.selfCert.scaleVideoFileId).toBeTruthy();
    // The buyer can actually fetch the videos.
    expect((await h.api(buyer).get(`/files/${view.body.selfCert.scaleVideoFileId}/download-url`)).status).toBe(200);
    expect((await h.api(buyer).post(`/orders/${orderId}/depart`)).status).toBe(200);
    expect(await h.api(buyer).post(`/orders/${orderId}/confirm-delivery`, { receivedWeightKg: 9_900 })).toHaveProperty('status', 200);
    await h.advanceHours(25);
    expect(await h.state(orderId)).toBe('SETTLED');
    // No inspection took place, so the fee is waived: 5,00,000 - 15,000 commission.
    expect((await h.prisma.payout.findFirstOrThrow({ where: { orderId, payeeType: 'FARMER' } })).amountPaise).toBe(rupees(485_000));
    expect(await h.assertBooksClosed(orderId)).toEqual({ escrow: 0n, nodal: 0n, trial: 0n });
  });
  it('gallery uploads are impossible: no capture token, no file', async () => {
    const { farmer, orderId } = await selfCertOrder();
    const sha = 'a'.repeat(64);
    const r = await h.api(farmer).post('/files/upload-url', { purpose: 'SELF_CERT_VIDEO', sha256: sha, contentType: 'video/mp4', orderId });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CAPTURE_TOKEN_REQUIRED');
    // Nor can a file from another purpose, or another session, be attached.
    const s = await h.api(farmer).post(`/self-cert/${orderId}/session`, { kind: 'SCALE' });
    const photo = await h.upload(farmer, 'DISPATCH_PHOTO');
    expect((await h.api(farmer).post(`/self-cert/${orderId}/clips`, clip(photo, s.body.captureToken))).body.code).toBe('FILE_WRONG_PURPOSE');
    const other = await record(farmer, orderId, 'VEHICLE');
    const wrongSession = await h.api(farmer).post(`/self-cert/${orderId}/clips`, clip(other.file, s.body.captureToken));
    expect(wrongSession.status).toBe(403);
    expect(wrongSession.body.code).toBe('NOT_IN_APP_CAPTURE');
    // And the source field only accepts the in-app camera.
    const { token, file } = await record(farmer, orderId, 'SCALE');
    expect((await h.api(farmer).post(`/self-cert/${orderId}/clips`, { ...clip(file, token), source: 'GALLERY' })).status).toBe(400);
  });
  it('rejects out-of-radius GPS', async () => {
    const { farmer, orderId } = await selfCertOrder();
    const { token, file } = await record(farmer, orderId, 'SCALE');
    const r = await h.api(farmer).post(`/self-cert/${orderId}/clips`, clip(file, token, FAR_AWAY));
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('OUTSIDE_RADIUS');
  });
  it('rejects a timestamp outside the session window', async () => {
    const { farmer, orderId } = await selfCertOrder();
    const { token, file } = await record(farmer, orderId, 'SCALE');
    const r = await h.api(farmer).post(`/self-cert/${orderId}/clips`, clip(file, token, { capturedAt: new Date(h.clock.now().getTime() - 86_400_000).toISOString() }));
    expect(r.body.code).toBe('TIMESTAMP_OUT_OF_WINDOW');
  });
  it('capture tokens are single-use', async () => {
    const { farmer, orderId } = await selfCertOrder();
    const { token, file } = await record(farmer, orderId, 'SCALE');
    expect((await h.api(farmer).post(`/self-cert/${orderId}/clips`, clip(file, token))).status).toBe(201);
    expect((await h.api(farmer).post(`/self-cert/${orderId}/clips`, clip(file, token))).status).toBe(403);
  });
  it('needs both videos', async () => {
    const { farmer, orderId } = await selfCertOrder();
    const { token, file } = await record(farmer, orderId, 'SCALE');
    await h.api(farmer).post(`/self-cert/${orderId}/clips`, clip(file, token));
    expect((await h.api(farmer).post(`/self-cert/${orderId}/submit`, { certifiedWeightKg: 10_000 })).body.code).toBe('VIDEOS_REQUIRED');
  });
  it('is not open when an inspector is assigned', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.fundExternal(buyer, o.id);
    expect((await h.api(farmer).post(`/self-cert/${o.id}/session`, { kind: 'SCALE' })).body.code).toBe('SELF_CERT_NOT_ACTIVE');
  });
  it('an inspector cancelling with nobody else available routes straight to self-certification', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.fundExternal(buyer, o.id);
    const i = await h.prisma.inspection.findUniqueOrThrow({ where: { orderId: o.id } });
    const r = await h.api(inspector).post(`/inspections/${i.id}/cancel`);
    expect(r.body).toEqual({ reassigned: false, selfCertRequired: true });
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.id } })).selfCertRequired).toBe(true);
  });
  it('an inspector cancelling with a colleague available reassigns', async () => {
    const [buyer, farmer, first] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.fundExternal(buyer, o.id);
    const second = await h.inspector();
    const i = await h.prisma.inspection.findUniqueOrThrow({ where: { orderId: o.id } });
    expect(i.inspectorId).toBe(first.id);
    expect((await h.api(first).post(`/inspections/${i.id}/cancel`)).body.reassigned).toBe(true);
    expect((await h.prisma.inspection.findUniqueOrThrow({ where: { id: i.id } })).inspectorId).toBe(second.id);
  });
});

describe('11. Organic tag', () => {
  async function cert(farmer: Actor, admin: Actor, expiresInDays = 200, approve = true) {
    const fileId = await h.upload(farmer, 'ORGANIC_CERT');
    const c = await h.api(farmer).post('/onboarding/organic-certs', { fileId, certifier: 'APEDA NPOP', certNumber: 'ORG-1234', expiresAt: new Date(h.clock.now().getTime() + expiresInDays * 86_400_000).toISOString() });
    expect(c.status).toBe(201);
    if (approve) expect((await h.api(admin).post(`/admin/queues/organic/${c.body.id}/review`, { decision: 'APPROVE' })).status).toBe(200);
    return c.body.id as string;
  }
  const listing = (organicCertId?: string) => ({ commodityId: h.commodityId, gradeId: h.gradeId, quantityKg: 5_000, pricePaisePerKg: '6000', ...(organicCertId ? { organicCertId } : {}) });

  it('is impossible without a verified certificate', async () => {
    const [farmer, admin] = [await h.farmer(), await h.admin()];
    const unverified = await cert(farmer, admin, 200, false);
    const r = await h.api(farmer).post('/listings', listing(unverified));
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('ORGANIC_CERT_INVALID');
  });
  it('is impossible with someone else\'s certificate', async () => {
    const [f1, f2, admin] = [await h.farmer(), await h.farmer('Other Farmer'), await h.admin()];
    const c = await cert(f1, admin);
    expect((await h.api(f2).post('/listings', listing(c))).status).toBe(422);
  });
  it('rejects a certificate that has already expired', async () => {
    const farmer = await h.farmer();
    const fileId = await h.upload(farmer, 'ORGANIC_CERT');
    const r = await h.api(farmer).post('/onboarding/organic-certs', { fileId, certifier: 'X Certifier', certNumber: 'ORG-1', expiresAt: new Date(h.clock.now().getTime() - 1000).toISOString() });
    expect(r.body.code).toBe('CERT_EXPIRED');
  });
  it('shows organic with a valid certificate, and loses the tag as soon as it expires', async () => {
    const [buyer, farmer, admin] = [await h.buyer(), await h.farmer(), await h.admin()];
    const c = await cert(farmer, admin, 10);
    const l = await h.api(farmer).post('/listings', listing(c));
    expect(l.status).toBe(201);
    let found = (await h.api(buyer).get('/listings')).body.find((x: { id: string }) => x.id === l.body.id);
    expect(found.isOrganic).toBe(true);
    expect((await h.api(buyer).get('/listings?organic=true')).body).toHaveLength(1);
    await h.advanceHours(24 * 11);
    found = (await h.api(buyer).get('/listings')).body.find((x: { id: string }) => x.id === l.body.id);
    expect(found.isOrganic).toBe(false);
    expect((await h.api(buyer).get('/listings?organic=true')).body).toHaveLength(0);
    // A buyer accepting after expiry does not get an organic order either.
    const acc = await h.api(buyer).post(`/listings/${l.body.id}/accept`, { acceptContract: true, deliveryPin: GUWAHATI_PIN });
    expect(acc.body.isOrganic).toBe(false);
  });
  it('spot test: requested on delivery, holds settlement, and a failed result opens a quality dispute', async () => {
    const [buyer, farmer, inspector, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    const c = await cert(farmer, admin);
    const l = await h.api(farmer).post('/listings', listing(c));
    const o = (await h.api(buyer).post(`/listings/${l.body.id}/accept`, { acceptContract: true, deliveryPin: GUWAHATI_PIN })).body;
    expect(o.isOrganic).toBe(true);
    await h.fundExternal(buyer, o.id);
    await h.inspect(inspector, o.id, 5_000);
    await h.api(buyer).post(`/orders/${o.id}/depart`);
    await h.api(buyer).post(`/orders/${o.id}/confirm-delivery`, { receivedWeightKg: 4_950 });
    const t = await h.api(buyer).post(`/orders/${o.id}/spot-tests`);
    expect(t.status).toBe(201);
    await h.advanceHours(25); // Past the original 24 h window, but the test extended it.
    expect(await h.state(o.id)).toBe('DISPUTE_WINDOW');
    const report = await h.upload(buyer, 'SPOT_TEST_REPORT');
    expect((await h.api(buyer).post(`/spot-tests/${t.body.id}/result`, { passed: false, reportFileId: report, note: 'Chlorpyrifos above limit' })).status).toBe(200);
    expect(await h.state(o.id)).toBe('DISPUTED');
    const d = await h.prisma.dispute.findFirstOrThrow({ where: { orderId: o.id } });
    expect(d.type).toBe('QUALITY');
    // Admin resolves for the buyer with a partial refund; settlement follows.
    const r = await h.api(admin).post(`/admin/disputes/${d.id}/resolve`, { outcome: 'PARTIAL_REFUND', refundPaise: String(rupees(50_000)), note: 'Lab report accepted' });
    expect(r.body.orderState).toBe('SETTLED');
    // GMV 3,00,000 less refund 50,000 = 2,50,000; 3% = 7,500; fee 1,500 → 2,41,000.
    expect((await h.prisma.payout.findFirstOrThrow({ where: { orderId: o.id, payeeType: 'FARMER' } })).amountPaise).toBe(rupees(241_000));
    expect((await h.prisma.refund.aggregate({ where: { orderId: o.id }, _sum: { amountPaise: true } }))._sum.amountPaise).toBe(rupees(50_000));
    expect(await h.assertBooksClosed(o.id)).toEqual({ escrow: 0n, nodal: 0n, trial: 0n });
  });
  it('spot tests only apply to organic orders', async () => {
    const [buyer, farmer, inspector] = [await h.buyer(), await h.farmer(), await h.inspector()];
    const o = await h.toDisputeWindow(buyer, farmer, inspector, 9_900);
    expect((await h.api(buyer).post(`/orders/${o.id}/spot-tests`)).body.code).toBe('NOT_ORGANIC');
  });
});

describe('12. Webhook replay', () => {
  it('does not double-credit', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer()];
    const o = await h.rfqOrder(buyer, farmer);
    const first = await h.credit(buyer, o.id, rupees(150_000), 'pay_replay_1');
    expect(first.status).toBe('applied');
    const before = await h.ledger.escrowBalance(o.id);
    const events = (await states(o.id)).length;
    for (let i = 0; i < 3; i++) expect((await h.credit(buyer, o.id, rupees(150_000), 'pay_replay_1')).status).toBe('duplicate');
    expect(await h.ledger.escrowBalance(o.id)).toBe(before);
    expect(await h.prisma.gatewayPayment.count()).toBe(1);
    expect((await states(o.id)).length).toBe(events);
    expect(await h.prisma.slaTimer.count({ where: { orderId: o.id, kind: 'SLA_BREACH' } })).toBe(1);
  });
  it('concurrent replays still credit only once', async () => {
    const [buyer, farmer] = [await h.buyer(), await h.farmer()];
    const o = await h.rfqOrder(buyer, farmer);
    const rs = await Promise.allSettled(Array.from({ length: 5 }, () => h.credit(buyer, o.id, rupees(150_000), 'pay_race')));
    expect(rs.filter((r) => r.status === 'fulfilled' && r.value.status === 'applied')).toHaveLength(1);
    expect(await h.ledger.escrowBalance(o.id)).toBe(rupees(150_000));
  });
  it('rejects a bad signature', async () => {
    const hook = await h.gateway.buildCreditWebhook({ gatewayVaId: 'va_x', amountPaise: 100n });
    const r = await h.webhook(hook.raw, 'deadbeef');
    expect(r.status).toBe(401);
    expect(await h.prisma.gatewayPayment.count()).toBe(0);
  });
});
