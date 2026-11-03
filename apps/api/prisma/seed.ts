/**
 * Demo data: realistic Indian locations, verified actors for every role, 6 months of price history, open listings and RFQs.
 * Safe to re-run: existing users, listings and RFQs are left alone. PANs, GSTINs and bank numbers are fabricated test values.
 */
import { PrismaClient, Role } from '@prisma/client';
import { gstinCheckChar, istDateString, normalisePhone, rupees } from '@agrimate/shared';
import { CryptoService } from '../src/core/core';
import { mockQuote, MOCK_MARKETS } from '../src/adapters/others';
import { PINS, seedMasters } from './masters';

const prisma = new PrismaClient();
const crypto = new CryptoService();
const pinGeo = (pin: string) => { const p = PINS.find((x) => x[0] === pin)!; return { pin, district: p[1], state: p[2], lat: p[3], lng: p[4] }; };
const gstin = (stateCode: string, pan: string) => { const f = `${stateCode}${pan}1Z`; return f + gstinCheckChar(f); };

async function user(phone: string, role: Role, name: string, o: { email?: string; password?: string; language?: string } = {}) {
  const p = normalisePhone(phone);
  const phoneHash = crypto.blindIndex(p);
  const existing = await prisma.user.findUnique({ where: { phoneHash } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      role, name, phoneEnc: crypto.encrypt(p), phoneHash, phoneLast4: p.slice(-4), language: o.language ?? 'en', email: o.email,
      passwordHash: o.password ? await crypto.hashPassword(o.password) : undefined,
      ...(role === 'BUYER' ? { buyer: { create: { companyName: name } } } : {}), ...(role === 'FARMER' ? { farmer: { create: {} } } : {}),
      ...(role === 'INSPECTOR' ? { inspector: { create: {} } } : {}), ...(role === 'LOGISTICS' ? { logistics: { create: {} } } : {}),
    },
  });
}

async function buyer(phone: string, name: string, email: string, pan: string, stateCode: string, pin: string) {
  const u = await user(phone, 'BUYER', name, { email, password: 'Buyer@12345' });
  await prisma.buyerProfile.update({ where: { userId: u.id }, data: { companyName: name, gstin: gstin(stateCode, pan), panEnc: crypto.encrypt(pan), panLast4: pan.slice(-4), kybStatus: 'VERIFIED', defaultPin: pin, kybResponse: { seed: true } } });
  return u;
}
async function farmer(phone: string, name: string, pan: string, pin: string, o: { language?: string; fpo?: string; mismatch?: boolean } = {}) {
  const u = await user(phone, 'FARMER', name, { language: o.language });
  const account = `${phone.slice(-6)}123456`;
  await prisma.farmerProfile.update({
    where: { userId: u.id },
    data: {
      ...pinGeo(pin), type: o.fpo ? 'FPO' : 'INDIVIDUAL', fpoName: o.fpo, panEnc: crypto.encrypt(pan), panLast4: pan.slice(-4), panName: name.toUpperCase(), bankAccountEnc: crypto.encrypt(account), bankLast4: account.slice(-4), bankIfsc: 'SBIN0001234',
      bankHolderName: o.mismatch ? 'SOMEONE ELSE ENTIRELY' : name.toUpperCase(), kycStatus: o.mismatch ? 'MANUAL_REVIEW' : 'VERIFIED', kycNote: o.mismatch ? 'Bank holder name does not match PAN name' : null, payoutsEnabled: !o.mismatch, fundAccountId: `fa_seed_${account.slice(-6)}`, kycResponse: { seed: true },
    },
  });
  return u;
}

async function main() {
  await seedMasters(prisma);

  await user('+919000000001', 'ADMIN', 'Agrimate Ops', { email: 'admin@agrimate.local', password: 'Admin@12345' });

  const b1 = await buyer('+919000000101', 'Brahmaputra Foods Pvt Ltd', 'buyer@agrimate.local', 'AABCB1234C', '18', '781001');
  await buyer('+919000000102', 'Deccan Agro Traders', 'buyer2@agrimate.local', 'AABCD5678E', '27', '411001');

  const f1 = await farmer('+919000000201', 'Hemanta Bora', 'ABCPB1234A', '782001', { language: 'as' });
  const f2 = await farmer('+919000000202', 'Subhas Mondal', 'ABCPM2345B', '713101', { language: 'bn', fpo: 'Bardhaman Krishak FPO' });
  const f3 = await farmer('+919000000203', 'Sanjay Pawar', 'ABCPP3456C', '422306', { language: 'hi' });
  const f4 = await farmer('+919000000204', 'Gurpreet Singh', 'ABCPS4567D', '141001', { language: 'hi' });
  await farmer('+919000000205', 'Rina Kalita', 'ABCPK5678E', '785001', { language: 'as', mismatch: true });

  for (const [phone, name, pin, degree] of [['+919000000301', 'Dr. Pranjal Saikia', '782001', 'MSC_AGRICULTURE'], ['+919000000302', 'Meera Kulkarni', '422001', 'BSC_AGRICULTURE'], ['+919000000303', 'Arijit Sen', '713101', 'BSC_AGRICULTURE'], ['+919000000304', 'Harjit Kaur', '141001', 'BSC_AGRICULTURE']] as const) {
    const u = await user(phone, 'INSPECTOR', name);
    const g = pinGeo(pin);
    await prisma.inspectorProfile.update({ where: { userId: u.id }, data: { degreeType: degree, status: 'VERIFIED', available: true, serviceRadiusKm: 100, pin, lat: g.lat, lng: g.lng, fundAccountId: `fa_seed_ins_${phone.slice(-3)}` } });
  }
  // A candidate waiting in the admin queue.
  const pendingInspector = await user('+919000000305', 'INSPECTOR', 'Nilam Gogoi');
  const g = pinGeo('785001');
  await prisma.inspectorProfile.update({ where: { userId: pendingInspector.id }, data: { degreeType: 'BSC_AGRICULTURE', status: 'PENDING', pin: '785001', lat: g.lat, lng: g.lng, serviceRadiusKm: 60 } });

  const lp = await user('+919000000401', 'LOGISTICS', 'Kamrup Roadways');
  await prisma.logisticsProfile.update({ where: { userId: lp.id }, data: { partnerType: 'AGENCY', companyName: 'Kamrup Roadways', gstin: gstin('18', 'AABCK9876F'), status: 'VERIFIED', noCoLoadingAcceptedAt: new Date(), fundAccountId: 'fa_seed_log_401' } });
  const tiers = await prisma.vehicleTier.findMany();
  for (const [regNo, code, capacityKg] of [['AS01AB1234', 'LCV', 7000], ['AS01CD5678', 'TEN_WHEELER', 16000], ['AS25EF9012', 'TWELVE_WHEELER', 25000]] as const) {
    await prisma.vehicle.upsert({ where: { regNo }, create: { partnerId: lp.id, tierId: tiers.find((t) => t.code === code)!.id, regNo, capacityKg }, update: {} });
  }
  const lp2 = await user('+919000000402', 'LOGISTICS', 'Ramesh Das (owner-driver)');
  await prisma.logisticsProfile.update({ where: { userId: lp2.id }, data: { partnerType: 'INDIVIDUAL', status: 'PENDING', noCoLoadingAcceptedAt: new Date() } });

  // Six months of daily mandi prices, so charts and the RFQ suggestion work from the first login.
  const commodities = await prisma.commodity.findMany({ include: { grades: true } });
  const rows = [];
  for (let d = 0; d < 183; d++) {
    const date = istDateString(new Date(Date.now() - d * 86_400_000));
    for (const c of commodities) MOCK_MARKETS.forEach((m, i) => rows.push({ commodityId: c.id, market: m.market, district: m.district, state: m.state, date: new Date(date), source: 'seed', ...mockQuote(c.code, i, date) }));
  }
  await prisma.marketPrice.createMany({ data: rows, skipDuplicates: true });

  const grade = (code: string, g: string) => { const c = commodities.find((x) => x.code === code)!; return { commodityId: c.id, gradeId: c.grades.find((y) => y.code === g)!.id }; };
  if (!(await prisma.listing.count())) {
    const cert = await prisma.organicCertificate.create({ data: { farmerId: f1.id, fileId: 'seed', certifier: 'APEDA NPOP (demo)', certNumber: 'NPOP/DEMO/1234', expiresAt: new Date(Date.now() + 300 * 86_400_000), status: 'VERIFIED' } });
    const listings = [
      { farmerId: f1.id, ...grade('GINGER', 'A'), quantityKg: 5000, pricePaisePerKg: rupees(72), pickupPin: '782001', organicCertId: cert.id },
      { farmerId: f1.id, ...grade('TEA_LEAF', 'FINE'), quantityKg: 2000, pricePaisePerKg: rupees(30), pickupPin: '782001' },
      { farmerId: f2.id, ...grade('POTATO', 'LARGE'), quantityKg: 15000, pricePaisePerKg: rupees(17), pickupPin: '713101' },
      { farmerId: f2.id, ...grade('PADDY', 'A'), quantityKg: 10000, pricePaisePerKg: rupees(25), pickupPin: '713101' },
      { farmerId: f3.id, ...grade('ONION', 'A'), quantityKg: 12000, pricePaisePerKg: rupees(23), pickupPin: '422306' },
      { farmerId: f3.id, ...grade('TURMERIC', 'A'), quantityKg: 3000, pricePaisePerKg: rupees(98), pickupPin: '422306' },
      { farmerId: f4.id, ...grade('MAIZE', 'A'), quantityKg: 20000, pricePaisePerKg: rupees(22), pickupPin: '141001' },
      { farmerId: f4.id, ...grade('MUSTARD', 'A'), quantityKg: 8000, pricePaisePerKg: rupees(60), pickupPin: '141001' },
    ];
    for (const [i, l] of listings.entries()) await prisma.listing.create({ data: { ...l, code: `LST-SEED${String(i + 1).padStart(3, '0')}` } });
  }
  if (!(await prisma.rfq.count())) {
    const neededBy = new Date(Date.now() + 14 * 86_400_000);
    await prisma.rfq.create({ data: { code: 'RFQ-SEED001', buyerId: b1.id, ...grade('PADDY', 'A'), quantityKg: 10000, deliveryPin: '781001', neededBy, targetPricePaisePerKg: rupees(26), suggestedPricePaisePerKg: rupees(24) } });
    await prisma.rfq.create({ data: { code: 'RFQ-SEED002', buyerId: b1.id, ...grade('POTATO', 'MEDIUM'), quantityKg: 5000, deliveryPin: '781001', neededBy, targetPricePaisePerKg: rupees(18), suggestedPricePaisePerKg: rupees(16) } });
  }
  console.log('Seed complete.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
