// Makes the same API calls as the inspector screens, with the same bodies, against a running API.
// Run with: node scripts/api-smoke.mts   Uses seeded accounts and creates new orders. API_URL overrides http://localhost:4000.
// A fresh listing and order are created for each run, so seeded listings are left alone.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ApiError, createApi, type TokenStore } from '@agrimate/api-client';
import { formatINR } from '@agrimate/shared';

const BASE = process.env.API_URL ?? 'http://localhost:4000';
const results: string[] = [];
const ok = (name: string, detail?: unknown) => { results.push(name); console.log(`ok   ${name}${detail === undefined ? '' : `  ->  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); };

function client() {
  let a: string | null = null, r: string | null = null;
  const tokens: TokenStore = { getAccess: () => a, getRefresh: () => r, set: (x, y) => { a = x; r = y; }, clear: () => { a = null; r = null; } };
  return createApi({ baseUrl: BASE, tokens });
}
type Api = ReturnType<typeof client>;

async function retry429<T>(fn: () => Promise<T>): Promise<T> {
  for (;;) {
    try { return await fn(); } catch (e) {
      if (e instanceof ApiError && e.status === 429) { console.log('     (rate limited, waiting 20 s)'); await new Promise((r) => setTimeout(r, 20_000)); continue; }
      throw e;
    }
  }
}
async function login(phone: string, role: string) {
  const api = client();
  const { devOtp } = await retry429(() => api.requestOtp(phone));
  assert.ok(devOtp, 'devOtp present while SMS is mocked');
  await retry429(() => api.verifyOtp({ phone, code: devOtp, role, language: 'en' }));
  return api;
}
/** Same error surface the screens read: status, code, message, body. */
async function refused(p: Promise<unknown>) {
  try { await p; } catch (e) { if (e instanceof ApiError) return e; throw e; }
  throw new Error('Expected the API to refuse this');
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`smoke ${Date.now()} ${Math.random()}`), Buffer.alloc(2048, 7), Buffer.from([0xff, 0xd9])]);
/** lib/files.ts uploadLocalFile: the same three steps, the same body. */
async function upload(api: Api, purpose: string, orderId?: string) {
  const bytes = Buffer.concat([JPEG, Buffer.from(String(Math.random()))]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const init = await api.post<{ fileId: string; uploadUrl: string }>('/files/upload-url', { purpose, sha256, contentType: 'image/jpeg', sizeBytes: bytes.byteLength, ...(orderId ? { orderId } : {}) });
  const put = await fetch(init.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: bytes });
  assert.ok(put.ok, `PUT to storage: ${put.status}`);
  await api.post(`/files/${init.fileId}/complete`);
  return init.fileId;
}

interface Job { id: string; orderId: string; orderCode: string; orderState: string; status: string; pickupLat: number; pickupLng: number; parameters: { key: string; label: string; unit: string; min?: number; max?: number; required: boolean }[]; checkInAt: string | null; readings: unknown; scaleWeightKg: number | null; photoFileIds: string[] }

async function makeOrder(farmer: Api, buyer: Api) {
  const commodities = await farmer.get<{ id: string; code: string; grades: { id: string }[] }[]>('/masters/commodities');
  const c = commodities.find((x) => x.code === 'POTATO') ?? commodities[0]!;
  const listing = await farmer.post<{ id: string }>('/listings', { commodityId: c.id, gradeId: c.grades[0]!.id, quantityKg: 1000, pricePaisePerKg: '1700', pickupPin: '782001' });
  const order = await buyer.post<{ id: string; code?: string; orderId?: string }>(`/listings/${listing.id}/accept`, { acceptContract: true, deliveryPin: '781001' });
  const orderId = order.orderId ?? order.id;
  await buyer.post(`/dev/mock-bank/orders/${orderId}/credit`, {});
  return orderId;
}
/** Moves the order to INSPECTION_SCHEDULED: external transport needs no freight, then the balance. */
async function fundBalance(buyer: Api, orderId: string) {
  await buyer.post(`/orders/${orderId}/logistics/external`, { vehicleNo: 'AS01AB1234', driverPhone: '+919876543210' });
  await buyer.post(`/dev/mock-bank/orders/${orderId}/credit`, {});
}

async function main() {
  // ---- Sign-in ---------------------------------------------------------------------------------------------------
  const inspector = await login('+919000000301', 'INSPECTOR');
  const me = await inspector.get<{ role: string; phone: string; inspector: { status: string; serviceRadiusKm: number; available: boolean } }>('/auth/me');
  assert.equal(me.role, 'INSPECTOR');
  ok('POST /auth/otp/request + verify, GET /auth/me', { status: me.inspector.status, available: me.inspector.available });

  const probe = client();
  const newPhone = `+9190000${String(Math.floor(Math.random() * 90000) + 10000)}`;
  const o = await retry429(() => probe.requestOtp(newPhone));
  const noName = await refused(probe.post('/auth/otp/verify', { phone: newPhone, code: o.devOtp, role: 'INSPECTOR' }));
  assert.equal(noName.code, 'SIGNUP_DETAILS_REQUIRED');
  const burnt = await refused(probe.post('/auth/otp/verify', { phone: newPhone, code: o.devOtp, role: 'INSPECTOR', name: 'Test Person' }));
  assert.equal(burnt.code, 'OTP_INVALID');
  ok('New number without a name: SIGNUP_DETAILS_REQUIRED, and that code cannot be reused (the login screen requests a new one)');

  // ---- Onboarding ------------------------------------------------------------------------------------------------
  // +919000000305 is already PENDING. Sending the same degree again leaves it exactly as seeded.
  const pending = await login('+919000000305', 'INSPECTOR');
  const certificate = await upload(pending, 'DEGREE_CERT');
  ok('Degree certificate: upload-url, PUT, complete', certificate);
  for (const degreeType of ['BSC_ANIMAL_HUSBANDRY', 'MSC_ANIMAL_HUSBANDRY', 'VETERINARY']) {
    const e = await refused(pending.post('/onboarding/inspector/degree', { degreeType, degreeFileId: certificate, pin: '785001', serviceRadiusKm: 60 }));
    assert.equal(e.status, 422); assert.equal(e.code, 'DEGREE_NOT_ELIGIBLE');
    ok(`Degree ${degreeType} refused`, `${e.code}: ${e.message}`);
  }
  const badPin = await refused(pending.post('/onboarding/inspector/degree', { degreeType: 'BSC_AGRICULTURE', degreeFileId: certificate, pin: '999999', serviceRadiusKm: 60 }));
  assert.equal(badPin.code, 'PIN_UNKNOWN');
  ok('Unknown PIN, which the form answers by using GPS', `${badPin.code}: ${badPin.message}`);
  const degree = await pending.post<{ status: string }>('/onboarding/inspector/degree', { degreeType: 'BSC_AGRICULTURE', degreeFileId: certificate, pin: '785001', serviceRadiusKm: 60 });
  assert.equal(degree.status, 'PENDING');
  ok('POST /onboarding/inspector/degree', degree);
  const blocked = await refused(pending.post('/onboarding/inspector/availability', { available: true, serviceRadiusKm: 60 }));
  assert.equal(blocked.status, 403); assert.equal(blocked.code, 'INSPECTOR_NOT_APPROVED');
  ok('Availability blocked until approved', `${blocked.code}: ${blocked.message}`);
  const avail = await inspector.post<{ available: boolean; serviceRadiusKm: number }>('/onboarding/inspector/availability', { available: me.inspector.available, serviceRadiusKm: me.inspector.serviceRadiusKm });
  ok('Availability for an approved inspector', avail);
  const unknown = await refused(inspector.post('/onboarding/inspector/availability', { available: true, extra: 1 }));
  assert.equal(unknown.status, 400);
  ok('Sanity: the API does reject unknown fields, so the 200s above prove the bodies are right', unknown.message);

  // ---- A passing job, and the 409 when the order is not fully funded ------------------------------------------------
  const farmer = await login('+919000000201', 'FARMER');
  const buyer = await login('+919000000101', 'BUYER');
  const orderId = await makeOrder(farmer, buyer);
  const findJob = async (id: string) => (await inspector.get<Job[]>('/inspector/jobs')).find((j) => j.orderId === id);
  const job = await findJob(orderId);
  assert.ok(job, 'seeded inspector at PIN 782001 is auto-assigned');
  assert.ok(job.parameters.length > 0);
  for (const p of job.parameters) assert.equal(typeof p.key, 'string');
  ok('GET /inspector/jobs has parameters for the form', { order: job.orderCode, state: job.orderState, parameters: job.parameters.map((p) => `${p.label} (${p.unit}) ${p.min ?? ''}..${p.max ?? ''}${p.required ? '' : ' optional'}`) });
  const contact = await inspector.get<{ farmer: { name: string; phoneUnlocked: boolean } }>(`/orders/${orderId}`);
  assert.ok(contact.farmer.name);
  ok('GET /orders/:id for farmer contact', { farmer: contact.farmer.name, phoneUnlocked: contact.farmer.phoneUnlocked });

  const early = await refused(inspector.post(`/inspections/${job.id}/grading`, { readings: {}, scaleWeightKg: 1000, photoFileIds: ['x'] }));
  assert.equal(early.code, 'CHECK_IN_REQUIRED');
  ok('Grading before check-in refused', early.message);
  const far = await refused(inspector.post(`/inspections/${job.id}/check-in`, { lat: job.pickupLat + 0.05, lng: job.pickupLng }));
  assert.equal(far.status, 422); assert.equal(far.code, 'OUTSIDE_RADIUS');
  const farBody = far.body as { metres: number; radius: number };
  assert.ok(farBody.metres > 500); assert.equal(farBody.radius, 500);
  ok('Check-in too far away: the body carries metres and radius, as the screen expects', farBody);
  const checkin = await inspector.post<{ status: string; checkInAt: string; checkInMetres: number }>(`/inspections/${job.id}/check-in`, { lat: job.pickupLat + 0.001, lng: job.pickupLng });
  assert.equal(checkin.status, 'CHECKED_IN');
  ok('Check-in nearby: the response has what the screen reads', { status: checkin.status, checkInMetres: checkin.checkInMetres, checkInAt: checkin.checkInAt });

  const inSpec: Record<string, number> = {};
  const outSpec: Record<string, number> = {};
  for (const p of job.parameters) {
    if (p.min !== undefined && p.max !== undefined) inSpec[p.key] = (p.min + p.max) / 2; else if (p.max !== undefined) inSpec[p.key] = p.max; else if (p.min !== undefined) inSpec[p.key] = p.min; else inSpec[p.key] = 1;
    outSpec[p.key] = p.max !== undefined ? p.max + 100 : p.min !== undefined ? p.min - 100 : 1;
  }
  const photo = await upload(inspector, 'INSPECTION_PHOTO', orderId);
  ok('Inspection photo upload with orderId', photo);
  const missingKey = job.parameters.find((p) => p.required);
  if (missingKey) {
    const partial = { ...inSpec }; delete partial[missingKey.key];
    const e = await refused(inspector.post(`/inspections/${job.id}/grading`, { readings: partial, scaleWeightKg: 1000, photoFileIds: [photo] }));
    assert.equal(e.code, 'GRADING_INCOMPLETE');
    ok('Grading without a required reading refused', { code: e.code, missing: (e.body as { missing: string[] }).missing });
  }
  await inspector.post(`/inspections/${job.id}/grading`, { readings: inSpec, scaleWeightKg: 1000, photoFileIds: [photo] });
  ok('POST grading with generated readings', inSpec);
  const unfunded = await refused(inspector.post(`/inspections/${job.id}/mark-inspected`));
  assert.equal(unfunded.status, 409); assert.equal(unfunded.code, 'GUARD_FAILED');
  ok('Mark as Inspected before full funding', `409 ${unfunded.code}: ${unfunded.message}`);
  const saved = await findJob(orderId);
  assert.deepEqual(saved?.readings, inSpec);
  assert.deepEqual(saved?.photoFileIds, [photo]);
  ok('Readings and photos survive the 409, as the screen promises');

  await fundBalance(buyer, orderId);
  const passed = await inspector.post<{ result: string }>(`/inspections/${job.id}/mark-inspected`);
  assert.equal(passed.result, 'INSPECTED');
  ok('Mark as Inspected after funding', passed);
  const again = await refused(inspector.post(`/inspections/${job.id}/grading`, { readings: inSpec, scaleWeightKg: 1000, photoFileIds: [photo] }));
  assert.equal(again.status, 409);
  assert.equal((await findJob(orderId))?.status, 'INSPECTED');
  ok('A resend after a lost reply gets a 409 and the job already reads INSPECTED, so the screen reports success', again.code);

  // ---- A failed grade ------------------------------------------------------------------------------------------------
  const orderB = await makeOrder(farmer, buyer);
  const jobB = await findJob(orderB);
  assert.ok(jobB);
  await inspector.post(`/inspections/${jobB.id}/check-in`, { lat: jobB.pickupLat, lng: jobB.pickupLng });
  const photoB = await upload(inspector, 'INSPECTION_PHOTO', orderB);
  await inspector.post(`/inspections/${jobB.id}/grading`, { readings: outSpec, scaleWeightKg: 950, photoFileIds: [photoB] });
  const failed = await inspector.post<{ result: string; outOfSpec: string[] }>(`/inspections/${jobB.id}/mark-inspected`);
  assert.equal(failed.result, 'FAILED_GRADE');
  assert.ok(failed.outOfSpec.length > 0);
  ok('Out of spec gives FAILED_GRADE, with keys the screen maps to labels', failed);

  // ---- Cancel ----------------------------------------------------------------------------------------------------------
  const orderC = await makeOrder(farmer, buyer);
  const jobC = await findJob(orderC);
  assert.ok(jobC);
  const cancelled = await inspector.post<{ reassigned: boolean; selfCertRequired: boolean }>(`/inspections/${jobC.id}/cancel`);
  ok('POST cancel', cancelled);
  assert.equal(await findJob(orderC), undefined);
  ok('A cancelled job leaves the list');

  // ---- Earnings -------------------------------------------------------------------------------------------------------
  const earnings = await inspector.get<{ totalPaidPaise: string; payouts: { amountPaise: string; status: string; orderCode: string }[] }>('/payouts/me');
  assert.equal(typeof earnings.totalPaidPaise, 'string');
  for (const p of earnings.payouts) assert.equal(typeof p.amountPaise, 'string');
  ok('GET /payouts/me: money is in strings', { total: formatINR(earnings.totalPaidPaise), payouts: earnings.payouts.length });
  console.log(`\n${results.length} checks passed.`);
}

main().catch((e) => { console.error('\nFAILED:', e instanceof ApiError ? `${e.status} ${e.code}: ${e.message}` : e); process.exit(1); });
