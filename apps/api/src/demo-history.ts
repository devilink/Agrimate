/**
 * Fills a demo database with about three months of order history so that the dashboards have something to show.
 * Every order goes through the real API, engine and ledger, with time driven by the Clock. Only timestamps the database
 * sets for itself are backdated afterwards. Mock providers only, refused in production. Run `pnpm db:demo-history` after `pnpm db:seed`.
 */
import 'reflect-metadata';
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const SETTLED_ORDERS = 64;
const IN_FLIGHT_ORDERS = 12;

/** Deterministic, so that two people running this see the same picture. */
let seed = 20261110;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run in production');
  for (const k of ['PAYMENT_PROVIDER', 'SMS_PROVIDER', 'KYC_PROVIDER', 'MAPS_PROVIDER']) if ((process.env[k] ?? 'mock') !== 'mock') throw new Error(`${k} must be mock`);
  // Set before the app modules load: an in-memory file store, no rate limits and no background jobs for the length of this run.
  Object.assign(process.env, { NODE_ENV: 'test', STORAGE_PROVIDER: 'mock', JOBS_ENABLED: 'false', LOG_LEVEL: 'error' });

  const [{ NestFactory }, { AppModule }, { configureApp }, core, auth, engine, others] = await Promise.all([
    import('@nestjs/core'), import('./app.module'), import('./bootstrap'), import('./core/core'), import('./auth/auth'), import('./engine/engine'), import('./adapters/others'),
  ]);
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: ['error'] });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const api = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;

  const prisma = app.get(core.PrismaService); const clock = app.get(core.Clock); const authService = app.get(auth.AuthService); const crypto = app.get(core.CryptoService);
  const timers = app.get(engine.TimerService); const notifications = app.get(engine.NotificationsService);
  const storage = app.get(others.STORAGE) as InstanceType<typeof others.MockStorage>; const sms = app.get(others.SMS) as InstanceType<typeof others.MockSms>;

  const call = async (token: string, method: string, path: string, body?: object) => {
    const res = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : undefined;
  };
  const tokens = new Map<string, string>();
  const tokenFor = async (userId: string) => {
    if (!tokens.has(userId)) tokens.set(userId, (await authService.issueTokens(await prisma.user.findUniqueOrThrow({ where: { id: userId } }))).accessToken);
    return tokens.get(userId)!;
  };
  const userAt = async (phone: string) => prisma.user.findUniqueOrThrow({ where: { phoneHash: crypto.blindIndex(phone) } });
  const upload = async (token: string, purpose: string, extra: object = {}) => {
    const bytes = randomBytes(64);
    const r = await call(token, 'POST', '/files/upload-url', { purpose, sha256: createHash('sha256').update(bytes).digest('hex'), contentType: 'image/jpeg', ...extra });
    storage.put(r.key, bytes);
    await call(token, 'POST', `/files/${r.fileId}/complete`);
    return r.fileId as string;
  };

  try {
    if (await prisma.order.count() > 10 && !process.argv.includes('--force')) throw new Error('This database already has orders. Pass --force to add more.');
    const buyers = await Promise.all([{ phone: '+919000000101', pin: '781001' }, { phone: '+919000000102', pin: '411001' }].map(async (b) => ({ ...b, id: (await userAt(b.phone)).id })));
    const farmers = await Promise.all(['+919000000201', '+919000000202', '+919000000203', '+919000000204'].map(async (p) => (await userAt(p)).id));
    const partner = (await userAt('+919000000401')).id;
    const admin = (await userAt('+919000000001')).id;
    const vehicles = await prisma.vehicle.findMany({ where: { partnerId: partner }, include: { tier: true } });
    const commodities = await prisma.commodity.findMany({ include: { grades: true } });
    const PRICE_BY_CODE: Record<string, number> = { PADDY: 2400, RICE: 4800, POTATO: 1900, ONION: 2300, GREEN_TEA: 3000, GINGER: 8200, TURMERIC: 9800, MAIZE: 2200, MUSTARD: 6000 };
    const geo = await prisma.pinCode.findMany();

    const runOrder = async (at: Date, stopAfter: number, fate: 'clean' | 'late' | 'dispute' | 'off-spec') => {
      clock.setNow(at);
      const buyer = pick(buyers); const farmerId = pick(farmers); const c = pick(commodities); const g = pick(c.grades);
      const quantityKg = pick([3000, 5000, 7000, 9000, 12000, 15000, 18000, 22000]);
      const [bt, ft] = [await tokenFor(buyer.id), await tokenFor(farmerId)];
      const base = PRICE_BY_CODE[c.code] ?? 3000;
      const listing = await call(ft, 'POST', '/listings', { commodityId: c.id, gradeId: g.id, quantityKg, pricePaisePerKg: String(Math.round(base * (0.9 + rnd() * 0.2))) });
      const order = await call(bt, 'POST', `/listings/${listing.id}/accept`, { acceptContract: true, deliveryPin: buyer.pin });
      await prisma.order.update({ where: { id: order.id }, data: { createdAt: at } });
      if (stopAfter <= 0) return;
      await call(bt, 'POST', `/dev/mock-bank/orders/${order.id}/credit`, {});
      if (stopAfter <= 1) return;
      clock.setNow(new Date(at.getTime() + 3 * HOUR));
      await call(bt, 'POST', `/orders/${order.id}/logistics/platform`, {});
      await call(bt, 'POST', `/dev/mock-bank/orders/${order.id}/credit`, {});
      if (stopAfter <= 2) return;
      await call(bt, 'POST', `/dev/mock-bank/orders/${order.id}/credit`, {});
      clock.setNow(new Date(at.getTime() + 20 * HOUR));
      if (stopAfter <= 3) return;

      const inspection = await prisma.inspection.findUniqueOrThrow({ where: { orderId: order.id } });
      if (!inspection.inspectorId) return;
      const it = await tokenFor(inspection.inspectorId);
      const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      await call(it, 'POST', `/inspections/${inspection.id}/check-in`, { lat: row.pickupLat, lng: row.pickupLng });
      const value = (p: { min?: number; max?: number }) => (p.max !== undefined && fate === 'off-spec' ? p.max * 1.3 : p.min !== undefined && p.max !== undefined ? (p.min + p.max) / 2 : p.max !== undefined ? p.max * (0.5 + rnd() * 0.4) : (p.min ?? 1) * (1.1 + rnd() * 0.4));
      const readings = Object.fromEntries((g.parameters as { key: string; min?: number; max?: number }[]).map((p) => [p.key, +value(p).toFixed(1)]));
      await call(it, 'POST', `/inspections/${inspection.id}/grading`, { readings, scaleWeightKg: quantityKg, photoFileIds: [await upload(it, 'INSPECTION_PHOTO')] });
      await call(it, 'POST', `/inspections/${inspection.id}/mark-inspected`);
      if (fate === 'off-spec') await call(bt, 'POST', `/orders/${order.id}/deviation/accept`);
      if (stopAfter <= 4) return;

      const trip = await prisma.trip.findUniqueOrThrow({ where: { orderId: order.id } });
      const vehicle = vehicles.find((v) => v.tier.code === trip.tierCode) ?? vehicles.find((v) => v.capacityKg >= quantityKg)!;
      const pt = await tokenFor(partner);
      clock.setNow(new Date(at.getTime() + (fate === 'late' ? 90 : 26) * HOUR));
      await call(pt, 'POST', `/trips/${trip.id}/accept`, { vehicleId: vehicle.id, noCoLoadingAttested: true });
      await call(pt, 'POST', `/trips/${trip.id}/eway-bill`, { ewayBillNumber: `EWB${String(Math.floor(rnd() * 1e9)).padStart(9, '0')}`, fileId: await upload(pt, 'EWAY_BILL') });
      await call(pt, 'POST', `/trips/${trip.id}/pickup`);
      if (stopAfter <= 5) return;

      await notifications.flush();
      const code = [...sms.sent].reverse().map((m) => /code (\d{6})/.exec(m.body)?.[1]).find(Boolean);
      const drop = geo.find((p) => p.pin === buyer.pin)!;
      clock.setNow(new Date(at.getTime() + (fate === 'late' ? 130 : 72) * HOUR));
      const received = fate === 'dispute' ? Math.round(quantityKg * 0.94) : quantityKg - Math.round(quantityKg * rnd() * 0.012);
      await call(pt, 'POST', `/trips/${trip.id}/deliver`, { podPhotoFileId: await upload(pt, 'POD_PHOTO'), lat: drop.lat, lng: drop.lng, receivedWeightKg: received, receiverOtp: code });
      if (stopAfter <= 6) return;

      if (fate === 'dispute') {
        const dispute = await call(bt, 'POST', `/orders/${order.id}/disputes`, { type: 'WEIGHT', reason: 'Delivered weight is short of the dispatched weight.', evidenceFileIds: [await upload(bt, 'DISPUTE_EVIDENCE', { orderId: order.id })] });
        await call(await tokenFor(admin), 'POST', `/admin/disputes/${dispute.id}/resolve`, { outcome: 'PARTIAL_REFUND', refundPaise: String(row.gmvPaise / 20n), note: 'Part refund for the verified shortfall.' });
      }
      clock.advance(26 * HOUR);
      await timers.fireDue();
      await notifications.flush();
      await prisma.payout.updateMany({ where: { orderId: order.id }, data: { createdAt: clock.now() } });
    };

    const now = Date.now();
    for (let i = 0; i < SETTLED_ORDERS; i++) {
      // Earlier weeks are quieter, so the trend shows a platform that is growing.
      const position = Math.sqrt(i / SETTLED_ORDERS);
      const ago = (1 - position) * 88 * DAY + 7 * DAY;
      const r = rnd();
      await runOrder(new Date(now - ago), 7, r < 0.08 ? 'dispute' : r < 0.2 ? 'late' : r < 0.26 ? 'off-spec' : 'clean');
      if ((i + 1) % 8 === 0) console.log(`${i + 1}/${SETTLED_ORDERS} settled orders`);
    }
    for (let i = 0; i < IN_FLIGHT_ORDERS; i++) await runOrder(new Date(now - (2 + rnd() * 30) * HOUR), i % 7, 'clean');
    clock.reset();
    console.log(`Done: ${await prisma.order.count()} orders in total.`);
  } finally {
    await app.close();
  }
}

main().catch((e) => { console.error((e as Error).message); process.exit(1); });
