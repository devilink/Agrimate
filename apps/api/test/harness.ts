/** Boots the real Nest app against the real test database. Only the provider adapters are mocks. */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { MockPaymentGateway, PAYMENT_GATEWAY } from '../src/adapters/payments';
import { MockStorage, SMS, MockSms, STORAGE } from '../src/adapters/others';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth';
import { configureApp } from '../src/bootstrap';
import { Clock, CryptoService, PrismaService } from '../src/core/core';
import { LedgerService, NotificationsService, TimerService } from '../src/engine/engine';
import { SettlementService } from '../src/payments/settlement.service';
import { MarketDataService } from '../src/market/market.service';
import { seedMasters } from '../prisma/masters';

export const NAGAON = { pin: '782001', lat: 26.348, lng: 92.684 };
export const GUWAHATI_PIN = '781001';
const FAR_AWAY = { lat: 26.75, lng: 94.2 };
export { FAR_AWAY };

export interface Actor { id: string; token: string; role: Role; phone: string }
let phoneSeq = 0;

export class Harness {
  app!: INestApplication; prisma!: PrismaService; clock!: Clock; ledger!: LedgerService; timers!: TimerService; auth!: AuthService; crypto!: CryptoService;
  storage!: MockStorage; sms!: MockSms; gateway!: MockPaymentGateway; settlement!: SettlementService; notifications!: NotificationsService; market!: MarketDataService;
  commodityId!: string; gradeId!: string;

  static async create() {
    const h = new Harness();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    h.app = mod.createNestApplication({ rawBody: true });
    configureApp(h.app);
    await h.app.init();
    h.prisma = mod.get(PrismaService); h.clock = mod.get(Clock); h.ledger = mod.get(LedgerService); h.timers = mod.get(TimerService); h.auth = mod.get(AuthService); h.crypto = mod.get(CryptoService);
    h.storage = mod.get(STORAGE); h.sms = mod.get(SMS); h.gateway = mod.get(PAYMENT_GATEWAY); h.settlement = mod.get(SettlementService); h.notifications = mod.get(NotificationsService); h.market = mod.get(MarketDataService);
    return h;
  }
  async close() { await this.app.close(); }

  /** Wipes everything. TRUNCATE skips the row-level append-only triggers, which is what lets tests start clean. */
  async reset() {
    this.clock.reset();
    const tables = await this.prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await this.prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await seedMasters(this.prisma);
    const c = await this.prisma.commodity.findUniqueOrThrow({ where: { code: 'PADDY' }, include: { grades: true } });
    this.commodityId = c.id; this.gradeId = c.grades.find((g) => g.code === 'A')!.id;
  }

  api(a: Actor | null) {
    const http = request(this.app.getHttpServer());
    const prefix = '/api/v1';
    const wrap = (r: request.Test) => (a ? r.set('Authorization', `Bearer ${a.token}`) : r);
    return { get: (p: string) => wrap(http.get(prefix + p)), post: (p: string, b: object = {}) => wrap(http.post(prefix + p)).send(b), put: (p: string, b: object = {}) => wrap(http.put(prefix + p)).send(b) };
  }

  /** Posts exact bytes, the way a gateway does: signatures are computed over them. */
  webhook(raw: Buffer, signature: string) {
    return request(this.app.getHttpServer()).post('/api/v1/webhooks/razorpay').set('x-razorpay-signature', signature).set('content-type', 'application/json').send(raw.toString());
  }

  async actor(role: Role, name: string): Promise<Actor> {
    const phone = `+9190${String(++phoneSeq).padStart(8, '0')}`;
    const u = await this.auth.createUser({ phone, role, name });
    const t = await this.auth.issueTokens(u);
    return { id: u.id, token: t.accessToken, role, phone };
  }
  async buyer() {
    const a = await this.actor('BUYER', 'Brahmaputra Foods');
    await this.prisma.buyerProfile.update({ where: { userId: a.id }, data: { kybStatus: 'VERIFIED' } });
    return a;
  }
  async farmer(name = 'Hemanta Bora', o: { payoutsEnabled?: boolean } = {}) {
    const a = await this.actor('FARMER', name);
    const enabled = o.payoutsEnabled ?? true;
    await this.prisma.farmerProfile.update({ where: { userId: a.id }, data: { kycStatus: enabled ? 'VERIFIED' : 'MANUAL_REVIEW', payoutsEnabled: enabled, fundAccountId: `fa_${a.id}`, pin: NAGAON.pin, lat: NAGAON.lat, lng: NAGAON.lng, district: 'Nagaon', state: 'Assam' } });
    return a;
  }
  async inspector(o: { available?: boolean } = {}) {
    const a = await this.actor('INSPECTOR', 'Dr. Inspector');
    await this.prisma.inspectorProfile.update({ where: { userId: a.id }, data: { status: 'VERIFIED', available: o.available ?? true, degreeType: 'BSC_AGRICULTURE', lat: NAGAON.lat + 0.02, lng: NAGAON.lng, serviceRadiusKm: 50, fundAccountId: `fa_${a.id}` } });
    return a;
  }
  async partner() {
    const a = await this.actor('LOGISTICS', 'Assam Haulage');
    await this.prisma.logisticsProfile.update({ where: { userId: a.id }, data: { status: 'VERIFIED', fundAccountId: `fa_${a.id}`, noCoLoadingAcceptedAt: new Date() } });
    const tier = await this.prisma.vehicleTier.findUniqueOrThrow({ where: { code: 'TWELVE_WHEELER' } });
    const v = await this.prisma.vehicle.create({ data: { partnerId: a.id, tierId: tier.id, regNo: `AS01AB${String(1000 + phoneSeq)}`, capacityKg: 25000 } });
    return { ...a, vehicleId: v.id };
  }
  async admin() { return this.actor('ADMIN', 'Ops'); }

  async upload(a: Actor, purpose: string, extra: { captureToken?: string; orderId?: string } = {}) {
    const bytes = randomBytes(64);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const r = await this.api(a).post('/files/upload-url', { purpose, sha256, contentType: 'image/jpeg', ...extra });
    if (r.status !== 201) throw new Error(`upload-url ${r.status}: ${JSON.stringify(r.body)}`);
    this.storage.put(r.body.key, bytes);
    const c = await this.api(a).post(`/files/${r.body.fileId}/complete`);
    if (c.status !== 201) throw new Error(`complete ${c.status}: ${JSON.stringify(c.body)}`);
    return r.body.fileId as string;
  }

  /** NEFT/RTGS into the order's VAN, through a signed webhook and the real handler. */
  async credit(buyer: Actor, orderId: string, amountPaise?: bigint | string, paymentId?: string) {
    const r = await this.api(buyer).post(`/dev/mock-bank/orders/${orderId}/credit`, { ...(amountPaise !== undefined ? { amountPaise: String(amountPaise) } : {}), ...(paymentId ? { paymentId } : {}) });
    if (r.status !== 200) throw new Error(`credit ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body;
  }
  state(orderId: string) { return this.prisma.order.findUniqueOrThrow({ where: { id: orderId } }).then((o) => o.state); }
  async advanceHours(h: number) { this.clock.advance(h * 3_600_000); return this.timers.fireDue(); }

  // ---- Flow builders -------------------------------------------------------------------------------------------
  /** RFQ → bid → accept. 10 t at ₹50/kg unless told otherwise, so that it matches the PRD's worked example. */
  async rfqOrder(buyer: Actor, farmer: Actor, o: { quantityKg?: number; pricePaise?: string } = {}) {
    const quantityKg = o.quantityKg ?? 10_000; const price = o.pricePaise ?? '5000';
    const rfq = await this.api(buyer).post('/rfqs', { commodityId: this.commodityId, gradeId: this.gradeId, quantityKg, deliveryPin: GUWAHATI_PIN, neededBy: new Date(this.clock.now().getTime() + 10 * 86_400_000).toISOString(), targetPricePaisePerKg: price });
    if (rfq.status !== 201) throw new Error(`rfq ${rfq.status}: ${JSON.stringify(rfq.body)}`);
    const bid = await this.api(farmer).post(`/rfqs/${rfq.body.id}/bids`, { quantityKg, pricePaisePerKg: price });
    if (bid.status !== 201) throw new Error(`bid ${bid.status}: ${JSON.stringify(bid.body)}`);
    const acc = await this.api(buyer).post(`/bids/${bid.body.id}/accept`, { acceptContract: true });
    if (acc.status !== 200) throw new Error(`accept ${acc.status}: ${JSON.stringify(acc.body)}`);
    return acc.body as { id: string; state: string; [k: string]: unknown };
  }
  async catalogOrder(buyer: Actor, farmer: Actor, o: { quantityKg?: number } = {}) {
    const l = await this.api(farmer).post('/listings', { commodityId: this.commodityId, gradeId: this.gradeId, quantityKg: o.quantityKg ?? 10_000, pricePaisePerKg: '5000' });
    if (l.status !== 201) throw new Error(`listing ${l.status}: ${JSON.stringify(l.body)}`);
    const acc = await this.api(buyer).post(`/listings/${l.body.id}/accept`, { acceptContract: true, deliveryPin: GUWAHATI_PIN });
    if (acc.status !== 200) throw new Error(`accept ${acc.status}: ${JSON.stringify(acc.body)}`);
    return acc.body as { id: string; state: string; [k: string]: unknown };
  }
  /** Advance + external transport + balance: reaches INSPECTION_SCHEDULED by the shortest path. */
  async fundExternal(buyer: Actor, orderId: string) {
    await this.credit(buyer, orderId);
    const r = await this.api(buyer).post(`/orders/${orderId}/logistics/external`, { vehicleNo: 'AS01AB1234', driverPhone: '9876543210' });
    if (r.status !== 200) throw new Error(`external ${r.status}: ${JSON.stringify(r.body)}`);
    await this.credit(buyer, orderId);
  }
  async inspect(inspector: Actor, orderId: string, weightKg = 10_000, readings: Record<string, number> = { moisture: 13, foreignMatter: 0.5, damaged: 1 }) {
    const insp = await this.prisma.inspection.findUniqueOrThrow({ where: { orderId } });
    const ci = await this.api(inspector).post(`/inspections/${insp.id}/check-in`, { lat: NAGAON.lat, lng: NAGAON.lng });
    if (ci.status !== 200) throw new Error(`check-in ${ci.status}: ${JSON.stringify(ci.body)}`);
    const photo = await this.upload(inspector, 'INSPECTION_PHOTO');
    const g = await this.api(inspector).post(`/inspections/${insp.id}/grading`, { readings, scaleWeightKg: weightKg, photoFileIds: [photo] });
    if (g.status !== 200) throw new Error(`grading ${g.status}: ${JSON.stringify(g.body)}`);
    return this.api(inspector).post(`/inspections/${insp.id}/mark-inspected`);
  }
  /** External-transport order all the way to the dispute window, with the given received weight. */
  async toDisputeWindow(buyer: Actor, farmer: Actor, inspector: Actor, receivedKg: number, dispatchedKg = 10_000) {
    const o = await this.rfqOrder(buyer, farmer);
    await this.fundExternal(buyer, o.id);
    const m = await this.inspect(inspector, o.id, dispatchedKg);
    if (m.status !== 200) throw new Error(`inspect ${m.status}: ${JSON.stringify(m.body)}`);
    const d = await this.api(buyer).post(`/orders/${o.id}/depart`);
    if (d.status !== 200) throw new Error(`depart ${d.status}: ${JSON.stringify(d.body)}`);
    const c = await this.api(buyer).post(`/orders/${o.id}/confirm-delivery`, { receivedWeightKg: receivedKg });
    if (c.status !== 200) throw new Error(`confirm ${c.status}: ${JSON.stringify(c.body)}`);
    return o;
  }
  /** Every order's books must close: escrow empty, nothing left in nodal for that order, and the whole ledger sums to zero. */
  async assertBooksClosed(orderId: string) {
    return { escrow: await this.ledger.escrowBalance(orderId), nodal: await this.ledger.nodalForOrder(orderId), trial: await this.ledger.trialBalance() };
  }
}
