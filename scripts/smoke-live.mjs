#!/usr/bin/env node
/**
 * End-to-end smoke test against a RUNNING stack (API + Supabase database and storage) using seeded accounts.
 * Covers what the in-process test suite deliberately mocks: real signed-URL uploads, multipart, server re-hashing and the
 * background outbox job. Runs Case 2 with external transport. Usage: `pnpm smoke` (API_URL overrides the target).
 */
import { createHash, randomBytes } from 'node:crypto';

const API = process.env.API_URL ?? 'http://localhost:4000';
let passed = 0;
const ok = (cond, label, extra) => {
  if (!cond) { console.error(`FAIL  ${label}`, extra ?? ''); process.exit(1); }
  passed++; console.log(`ok    ${label}`);
};
async function call(token, method, path, body) {
  const res = await fetch(`${API}/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, body: json };
}
const must = async (token, method, path, body, want = [200, 201]) => {
  const r = await call(token, method, path, body);
  if (!want.includes(r.status)) { console.error(`FAIL  ${method} ${path} -> ${r.status}`, r.body); process.exit(1); }
  return r.body;
};
async function login(phone) {
  const { devOtp } = await must(null, 'POST', '/auth/otp/request', { phone });
  ok(!!devOtp, `OTP issued for ******${phone.slice(-4)}`);
  return (await must(null, 'POST', '/auth/otp/verify', { phone, code: devOtp })).accessToken;
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
async function upload(token, purpose, bytes, contentType = 'image/jpeg') {
  const init = await must(token, 'POST', '/files/upload-url', { purpose, sha256: sha(bytes), contentType, sizeBytes: bytes.length });
  const put = await fetch(init.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
  ok(put.ok, `signed PUT to object storage (${purpose})`, put.status);
  const done = await must(token, 'POST', `/files/${init.fileId}/complete`);
  ok(done.sha256 === sha(bytes), 'server re-hash matches the device hash');
  return init.fileId;
}

const health = await must(null, 'GET', '/../../health');
ok(health.status === 'ok', `API healthy, providers ${JSON.stringify(health.providers)}`);
ok(health.providers.payment === 'mock', 'payment provider is mocked (this script moves pretend money only)');

const [buyer, farmer, inspector] = [await login('+919000000101'), await login('+919000000201'), await login('+919000000301')];

// Tampered bytes must be refused by the server-side hash check.
const good = randomBytes(1024);
const t = await must(farmer, 'POST', '/files/upload-url', { purpose: 'DISPATCH_PHOTO', sha256: sha(good), contentType: 'image/jpeg' });
await fetch(t.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: randomBytes(1024) });
ok((await call(farmer, 'POST', `/files/${t.fileId}/complete`)).body.code === 'HASH_MISMATCH', 'tampered upload rejected');

// Multipart against real storage, as the self-certification recorder uses it.
const big = randomBytes(6 * 1024 * 1024);
const mp = await must(farmer, 'POST', '/files/upload-url', { purpose: 'DISPATCH_PHOTO', sha256: sha(big), contentType: 'video/webm', multipart: true });
const parts = [];
for (const [n, chunk] of [[1, big.subarray(0, 5 * 1024 * 1024)], [2, big.subarray(5 * 1024 * 1024)]]) {
  const { url } = await must(farmer, 'POST', `/files/${mp.fileId}/parts`, { partNumber: n });
  const put = await fetch(url, { method: 'PUT', body: chunk });
  ok(put.ok && !!put.headers.get('etag'), `multipart part ${n} uploaded`);
  parts.push({ partNumber: n, etag: put.headers.get('etag') });
}
ok((await must(farmer, 'POST', `/files/${mp.fileId}/multipart-complete`, { parts })).sha256 === sha(big), 'multipart object re-hash matches');

// Case 2, 3 t at Rs 48/kg.
const commodities = await must(null, 'GET', '/masters/commodities');
const paddy = commodities.find((c) => c.code === 'PADDY');
const gradeA = paddy.grades.find((g) => g.code === 'A');
const listing = await must(farmer, 'POST', '/listings', { commodityId: paddy.id, gradeId: gradeA.id, quantityKg: 3000, pricePaisePerKg: '4800' });
const order = await must(buyer, 'POST', `/listings/${listing.id}/accept`, { acceptContract: true, deliveryPin: '781001' });
ok(order.state === 'AWAITING_ADVANCE' && !!order.virtualAccount?.accountNumber, `order ${order.code} matched with a VAN`);
ok(order.farmer.phone.startsWith('+91') && !order.farmer.phone.includes('*'), 'phones unlocked at MATCHED');

await must(buyer, 'POST', `/dev/mock-bank/orders/${order.id}/credit`);
const locked = await must(buyer, 'GET', `/orders/${order.id}`);
ok(locked.state === 'LOGISTICS_PENDING' && !!locked.t0At && locked.slaDays === 2, 'advance locked, 2-day SLA running');
ok(!!locked.inspection?.inspectorId, 'inspector auto-assigned');

await must(buyer, 'POST', `/orders/${order.id}/logistics/external`, { vehicleNo: 'AS01AB1234', driverPhone: '9876543210' });
ok((await call(buyer, 'POST', `/orders/${order.id}/depart`)).status === 409, 'departure refused without balance and inspection');
await must(buyer, 'POST', `/dev/mock-bank/orders/${order.id}/credit`);

const job = (await must(inspector, 'GET', '/inspector/jobs')).find((j) => j.orderId === order.id);
ok((await call(inspector, 'POST', `/inspections/${job.id}/check-in`, { lat: 26.5, lng: 92.9 })).body.code === 'OUTSIDE_RADIUS', 'far-away check-in refused');
await must(inspector, 'POST', `/inspections/${job.id}/check-in`, { lat: job.pickupLat, lng: job.pickupLng });
const photo = await upload(inspector, 'INSPECTION_PHOTO', randomBytes(2048));
await must(inspector, 'POST', `/inspections/${job.id}/grading`, { readings: { moisture: 13, foreignMatter: 0.5, damaged: 1 }, scaleWeightKg: 3000, photoFileIds: [photo] });
ok((await must(inspector, 'POST', `/inspections/${job.id}/mark-inspected`)).result === 'INSPECTED', 'marked as inspected');
ok((await must(buyer, 'GET', `/files/${photo}/download-url`)).url.includes('X-Amz-Signature'), 'buyer gets a signed URL for the inspection photo');

await must(buyer, 'POST', `/orders/${order.id}/depart`);
await must(buyer, 'POST', `/orders/${order.id}/confirm-delivery`, { receivedWeightKg: 2925 }); // Exactly 2.5%.
const el = await must(buyer, 'GET', `/orders/${order.id}/dispute-eligibility`);
ok(el.windowOpen && el.weightDisputeAllowed === false && el.discrepancyPercent === 2.5, 'weight dispute blocked at exactly 2.5%');
const final = await must(buyer, 'GET', `/orders/${order.id}`);
ok(final.state === 'DISPUTE_WINDOW', 'order is in its dispute window');

// The outbox worker runs every 15 s in the background, so wait for it rather than calling it.
const admin = (await must(null, 'POST', '/auth/login', { email: 'admin@agrimate.local', password: 'Admin@12345' })).accessToken;
const accounts = await must(admin, 'GET', '/admin/ledger/accounts');
ok(accounts.trialBalancePaise === '0', 'ledger trial balance is zero');
const metricsInit = process.env.METRICS_TOKEN ? { headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` } } : {};
const metricsBefore = await (await fetch(`${API}/metrics`, metricsInit)).text();
const pending = () => fetch(`${API}/metrics`, metricsInit).then((r) => r.text()).then((s) => Number(/agrimate_outbox_pending (\d+)/.exec(s)?.[1] ?? -1));
let drained = false;
for (let i = 0; i < 12 && !drained; i++) { if ((await pending()) === 0) drained = true; else await new Promise((r) => setTimeout(r, 3000)); }
ok(drained, 'background job drained the notification outbox', metricsBefore);

console.log(`\n${passed} checks passed. Order ${order.code} left in DISPUTE_WINDOW; it auto-settles after 24 h.`);
