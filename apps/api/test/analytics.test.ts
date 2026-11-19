/** Dashboards aggregate money and people across orders, so what matters most is correct totals and strict scoping. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Harness } from './harness';

let h: Harness;
beforeAll(async () => { h = await Harness.create(); });
afterAll(async () => { await h.close(); });
beforeEach(async () => { await h.reset(); });

describe('analytics summary', () => {
  it('totals a settled order and shows each role its own money', async () => {
    const [buyer, farmer, inspector, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    const o = await h.toDisputeWindow(buyer, farmer, inspector, 10_000);
    await h.advanceHours(25);
    expect(await h.state(o.id)).toBe('SETTLED');

    const summary = (await h.api(admin).get('/analytics/summary')).body;
    expect(summary.kpis).toMatchObject({ gmvPaise: '50000000', orders: 1, quantityKg: 10_000, escrowPaise: '0', commissionPaise: '1500000' });
    expect(summary.outcomes.find((x: { key: string }) => x.key === 'settled').count).toBe(1);
    expect(summary.dials.qualityPass).toEqual({ value: 100, ok: 1, sample: 1 });
    expect(summary.dials.completion.value).toBe(100);
    expect(summary.trend).toHaveLength(30);
    expect(summary.trend.filter((d: { orders: number }) => d.orders > 0)).toEqual([expect.objectContaining({ orders: 1, gmvPaise: '50000000' })]);
    expect(summary.commodities[0]).toMatchObject({ name: 'Paddy', orders: 1 });

    const b = (await h.api(buyer).get('/analytics/summary')).body;
    expect(b.kpis.commissionPaise).toBeUndefined();
    expect(b.dials.payoutSuccess).toBeUndefined();
    expect(b.split.map((s: { key: string }) => s.key)).toEqual(['goods', 'freight']);

    const f = (await h.api(farmer).get('/analytics/summary')).body;
    const received = BigInt(f.kpis.receivedPaise);
    expect(received).toBeGreaterThan(0n);
    expect(received).toBe(BigInt((await h.prisma.payout.findFirstOrThrow({ where: { payeeType: 'FARMER' } })).amountPaise));
  });

  it('counts money still in escrow and tranches still due', async () => {
    const [buyer, farmer, admin] = [await h.buyer(), await h.farmer(), await h.admin()];
    const o = await h.rfqOrder(buyer, farmer);
    await h.credit(buyer, o.id);
    const summary = (await h.api(admin).get('/analytics/summary')).body;
    expect(BigInt(summary.kpis.escrowPaise)).toBe(await h.ledger.escrowBalance(o.id));
    expect(summary.kpis.escrowPaise).not.toBe('0');
    const b = (await h.api(buyer).get('/analytics/summary')).body;
    expect(b.kpis.duePaise).toBe('35000000');
    expect(b.pipeline.reduce((n: number, s: { count: number }) => n + s.count, 0)).toBe(1);
  });

  it("never mixes another party's orders in", async () => {
    const [b1, b2, f1, f2] = [await h.buyer(), await h.buyer(), await h.farmer('Farmer One'), await h.farmer('Farmer Two')];
    await h.rfqOrder(b1, f1);
    const o2 = await h.rfqOrder(b2, f2);
    await h.credit(b2, o2.id);
    const other = (await h.api(b1).get('/analytics/summary')).body;
    expect(other.kpis).toMatchObject({ orders: 1, gmvPaise: '50000000', escrowPaise: '0' });
    expect((await h.api(f1).get('/analytics/summary')).body.kpis).toMatchObject({ orders: 1, escrowPaise: '0' });
  });

  it('gives no percentage when there is nothing to measure yet', async () => {
    const summary = (await h.api(await h.admin()).get('/analytics/summary')).body;
    expect(summary.dials.qualityPass).toEqual({ value: null, ok: 0, sample: 0 });
    expect(summary.trend.every((d: { orders: number }) => d.orders === 0)).toBe(true);
  });

  it('refuses other roles and unknown periods', async () => {
    const [inspector, partner, admin] = [await h.inspector(), await h.partner(), await h.admin()];
    for (const staff of [inspector, partner]) {
      expect((await h.api(staff).get('/analytics/summary')).status).toBe(403);
      expect((await h.api(staff).get('/analytics/graph')).status).toBe(403);
    }
    expect((await h.api(null).get('/analytics/summary')).status).toBe(401);
    expect((await h.api(admin).get('/analytics/summary?days=9999')).status).toBe(400);
  });
});

describe('knowledge graph', () => {
  it('links parties and goods for admin, with names and never phone numbers', async () => {
    const [buyer, farmer, inspector, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    await h.toDisputeWindow(buyer, farmer, inspector, 10_000);
    const res = await h.api(admin).get('/analytics/graph');
    expect(res.status).toBe(200);
    const types = res.body.nodes.map((n: { type: string }) => n.type).sort();
    expect(types).toEqual(expect.arrayContaining(['BUYER', 'COMMODITY', 'FARMER', 'INSPECTOR']));
    expect(res.body.links.map((l: { kind: string }) => l.kind)).toEqual(expect.arrayContaining(['BUYS', 'SUPPLIES', 'INSPECTS']));
    const json = JSON.stringify(res.body);
    for (const a of [buyer, farmer, inspector]) expect(json).not.toContain(a.phone);
  });

  it("shows a buyer only their own network, and no staff", async () => {
    const [b1, b2, f1, f2, inspector] = [await h.buyer(), await h.buyer(), await h.farmer('Visible Farmer'), await h.farmer('Hidden Farmer'), await h.inspector()];
    await h.toDisputeWindow(b1, f1, inspector, 10_000);
    await h.rfqOrder(b2, f2);
    const body = (await h.api(b1).get('/analytics/graph')).body;
    const json = JSON.stringify(body);
    expect(json).toContain('Visible Farmer');
    expect(json).not.toContain('Hidden Farmer');
    expect(json).not.toContain('Dr. Inspector');
    expect(body.nodes.every((n: { type: string }) => n.type !== 'INSPECTOR' && n.type !== 'TRANSPORTER')).toBe(true);
  });

  it('flags a party with an open dispute', async () => {
    const [buyer, farmer, inspector, admin] = [await h.buyer(), await h.farmer(), await h.inspector(), await h.admin()];
    const o = await h.toDisputeWindow(buyer, farmer, inspector, 9_000);
    const raised = await h.api(buyer).post(`/orders/${o.id}/disputes`, { type: 'WEIGHT', reason: 'Short by a tonne', evidenceFileIds: [await h.upload(buyer, 'DISPUTE_EVIDENCE', { orderId: o.id })] });
    expect(raised.status).toBe(201);
    const { nodes } = (await h.api(admin).get('/analytics/graph')).body;
    expect(nodes.find((n: { type: string }) => n.type === 'FARMER').flagged).toBe(true);
  });
});

describe('background jobs', () => {
  it('runs a daily job once per IST day, not before its time, and retries after a failure', async () => {
    const jobs = h.app.get((await import('../src/engine/engine')).JobsService);
    h.clock.setNow(new Date('2026-06-10T04:00:00.000Z')); // 09:30 IST
    let runs = 0;
    const job = async () => { runs++; };
    const at = { hour: 20, minute: 0 };
    expect(await jobs.runDailyIfDue('test-job', job, at)).toBe(false);
    h.clock.setNow(new Date('2026-06-10T15:00:00.000Z')); // 20:30 IST
    expect(await jobs.runDailyIfDue('test-job', job, at)).toBe(true);
    expect(await jobs.runDailyIfDue('test-job', job, at)).toBe(false);
    expect(runs).toBe(1);

    await expect(jobs.runDailyIfDue('failing-job', async () => { throw new Error('boom'); }, at)).rejects.toThrow('boom');
    expect(await jobs.runDailyIfDue('failing-job', job, at)).toBe(true);
  });
});
