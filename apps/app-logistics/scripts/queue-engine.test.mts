// Run with: node scripts/queue-engine.test.mts (Node strips the TypeScript types itself.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backoffMs, QueueEngine, type QueueDeps, type QueueUpload } from '../src/lib/queueEngine.ts';

const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const netDown = () => Object.assign(new Error('Network request failed'), { name: 'TypeError' });
const refused = (status: number, code: string, message: string) => ({ status, code, message });

/** A fake phone and server. `store` plays AsyncStorage, so that passing it to a new harness simulates an app restart. */
function harness(store = new Map<string, string>()) {
  const log: string[] = [];
  const h = {
    store, log, clock: 1_000, timers: [] as { fn: () => void; at: number }[], files: new Set(['pod.jpg', 'sig.jpg', 'bill.jpg', 'pod2.jpg']), deleted: [] as string[],
    failCreate: 0, failPut: 0, failComplete: null as unknown, tripStatus: null as string | null,
    post: (path: string, _body: Record<string, unknown>): Promise<unknown> => { log.push(`post ${path}`); return Promise.resolve({}); },
    bodies: [] as Record<string, unknown>[], nextFile: 1,
  };
  const deps: QueueDeps = {
    storage: { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } },
    now: () => h.clock,
    createUpload: async (u) => { log.push(`create ${u.localName}`); if (h.failCreate > 0) { h.failCreate--; throw netDown(); } return { fileId: `f${h.nextFile++}`, uploadUrl: `https://s3/${u.localName}?sig=${h.clock}` }; },
    put: async (url, u) => { log.push(`put ${u.localName} ${url}`); if (h.failPut > 0) { h.failPut--; throw netDown(); } },
    complete: async (id) => { log.push(`complete ${id}`); if (h.failComplete) { const e = h.failComplete; h.failComplete = null; throw e; } },
    post: async (path, body) => { h.bodies.push(body); return h.post(path, body); },
    tripStatus: async () => { log.push('check trip'); return h.tripStatus; },
    localFileExists: (n) => h.files.has(n),
    deleteLocalFile: (n) => { h.deleted.push(n); h.files.delete(n); },
    describeError: (e) => {
      if (e && typeof e === 'object' && 'status' in e) return e as { status: number; code?: string; message: string };
      return { message: (e as Error).message };
    },
    setTimer: (fn, ms) => { const t = { fn, at: h.clock + ms }; h.timers.push(t); return t; },
    clearTimer: (t) => { h.timers = h.timers.filter((x) => x !== t); },
  };
  return { h, engine: new QueueEngine(deps) };
}

const up = (localName: string, purpose = 'POD_PHOTO', sha256 = `sha-${localName}`): QueueUpload => ({ localName, purpose, contentType: 'image/jpeg', sizeBytes: 100, sha256 });
const deliver = (tripId = 't1', overrides: Record<string, unknown> = {}) => ({
  kind: 'DELIVER' as const, tripId, label: 'PoD', path: `/trips/${tripId}/deliver`, body: { lat: 26, lng: 91, receivedWeightKg: 900, receiverOtp: '123456', ...overrides },
  uploads: { pod: up('pod.jpg') }, fileFields: { podPhotoFileId: 'pod' }, doneWhenTripStatus: ['DELIVERED'],
});

test('offline: nothing is sent, the item is saved, and it sends on reconnect', async () => {
  const { h, engine } = harness();
  await engine.load('u1');
  engine.setOnline(false);
  await engine.add(deliver());
  await settle();
  assert.deepEqual(h.log, []);
  assert.equal(engine.list().length, 1);
  assert.equal(JSON.parse(h.store.get('agrimate.queue.u1')!).length, 1, 'written to storage before any network');
  engine.setOnline(true);
  await settle();
  assert.deepEqual(h.log.map((l) => l.split(' ')[0]), ['create', 'put', 'complete', 'post']);
  assert.equal(h.bodies[0]!.podPhotoFileId, 'f1');
  assert.equal(h.bodies[0]!.receiverOtp, '123456');
  assert.equal(engine.list().length, 0);
  assert.deepEqual(h.deleted, ['pod.jpg'], 'local file removed only after success');
});

test('app killed while offline: a new process picks the PoD up from storage', async () => {
  const first = harness();
  await first.engine.load('u1');
  first.engine.setOnline(false);
  await first.engine.add(deliver());
  const second = harness(first.h.store);
  await second.engine.load('u1');
  await settle();
  assert.ok(second.h.log.includes('post /trips/t1/deliver'));
  assert.equal(second.engine.list().length, 0);
});

test('app killed after the bytes reached storage: resumes at complete, without uploading again', async () => {
  const first = harness();
  first.h.failComplete = netDown();
  await first.engine.load('u1');
  await first.engine.add(deliver());
  await settle();
  assert.equal(first.engine.list()[0]!.uploads.pod!.uploaded, true);
  const second = harness(first.h.store);
  second.h.clock = 10_000_000;
  await second.engine.load('u1');
  await settle();
  assert.deepEqual(second.h.log, ['complete f1', 'post /trips/t1/deliver']);
});

test('dropped upload: retries with backoff and asks for a fresh signed URL', async () => {
  const { h, engine } = harness();
  h.failPut = 1;
  await engine.load('u1');
  await engine.add(deliver());
  await settle();
  const item = engine.list()[0]!;
  assert.equal(item.attempts, 1);
  assert.ok(item.nextAttemptAt > h.clock, 'waits before retrying');
  assert.ok(item.lastError);
  assert.equal(h.timers.length, 1, 'a retry timer is set');
  h.clock = item.nextAttemptAt + 1;
  h.timers[0]!.fn();
  await settle();
  const puts = h.log.filter((l) => l.startsWith('put'));
  assert.equal(puts.length, 2);
  assert.notEqual(puts[0], puts[1], 'second attempt used a new URL');
  assert.equal(engine.list().length, 0);
});

test('reply lost after the server delivered: 409 plus a status check counts as done', async () => {
  const { h, engine } = harness();
  let calls = 0;
  h.post = () => { calls++; if (calls === 1) { h.tripStatus = 'DELIVERED'; return Promise.reject(netDown()); } return Promise.reject(refused(409, 'ILLEGAL_TRANSITION', 'Trip is not in transit')); };
  await engine.load('u1');
  await engine.add(deliver());
  await settle();
  assert.equal(engine.list().length, 1, 'the first failure looks like a dropped connection');
  h.clock = engine.list()[0]!.nextAttemptAt + 1;
  engine.kick();
  await settle();
  assert.ok(h.log.includes('check trip'));
  assert.equal(engine.list().length, 0, 'no false alarm for the driver');
  assert.equal(calls, 2);
});

test('a real 409 stops and shows the guard message, and the action is kept', async () => {
  const { h, engine } = harness();
  h.tripStatus = 'ACCEPTED';
  h.post = () => Promise.reject(refused(409, 'GUARD_FAILED', 'Balance not paid'));
  await engine.load('u1');
  await engine.add({ kind: 'PICKUP', tripId: 't1', label: 'Pickup', path: '/trips/t1/pickup', body: {}, uploads: {}, fileFields: {}, doneWhenTripStatus: ['PICKED_UP', 'DELIVERED'] });
  await settle();
  assert.equal(engine.list()[0]!.attention?.message, 'Balance not paid');
  assert.equal(h.timers.length, 0, 'no automatic retry for a refusal');
  h.post = () => Promise.resolve({});
  await engine.retry(engine.list()[0]!.id);
  await settle();
  assert.equal(engine.list().length, 0);
});

test('a trip stays in order: pickup cannot overtake a stuck E-Way bill, but other trips carry on', async () => {
  const { h, engine } = harness();
  h.post = (path) => { h.log.push(`post ${path}`); return path === '/trips/t1/eway-bill' ? Promise.reject(refused(422, 'FILE_WRONG_PURPOSE', 'Wrong')) : Promise.resolve({}); };
  await engine.load('u1');
  engine.setOnline(false);
  await engine.add({ kind: 'EWAY', tripId: 't1', label: 'Bill', path: '/trips/t1/eway-bill', body: { ewayBillNumber: '123456' }, uploads: { bill: up('bill.jpg', 'EWAY_BILL') }, fileFields: { fileId: 'bill' } });
  await engine.add({ kind: 'PICKUP', tripId: 't1', label: 'Pickup', path: '/trips/t1/pickup', body: {}, uploads: {}, fileFields: {} });
  await engine.add(deliver('t2'));
  engine.setOnline(true);
  await settle();
  assert.ok(!h.log.includes('post /trips/t1/pickup'), 'pickup held back');
  assert.ok(h.log.includes('post /trips/t2/deliver'), 'other trip not held up');
  assert.equal(engine.list().length, 2);
});

test('wrong delivery code: the fix reuses the uploaded photo and sends the new code', async () => {
  const { h, engine } = harness();
  h.post = (_p, body) => (body.receiverOtp === '111111' ? Promise.reject(refused(422, 'RECEIVER_OTP_INVALID', 'Wrong delivery code')) : Promise.resolve({}));
  await engine.load('u1');
  await engine.add(deliver('t1', { receiverOtp: '111111' }));
  await settle();
  const stuck = engine.list()[0]!;
  assert.equal(stuck.attention?.code, 'RECEIVER_OTP_INVALID');
  assert.equal(stuck.uploads.pod!.completed, true);
  h.log.length = 0;
  await engine.add(deliver('t1', { receiverOtp: '222222' }));
  await settle();
  assert.deepEqual(h.log.filter((l) => l.startsWith('create') || l.startsWith('put')), [], 'photo not sent twice');
  assert.equal(h.bodies.at(-1)!.podPhotoFileId, 'f1');
  assert.equal(h.bodies.at(-1)!.receiverOtp, '222222');
  assert.equal(engine.list().length, 0);
});

test('storage lost the bytes: complete says not uploaded, so the file is uploaded again', async () => {
  const { h, engine } = harness();
  h.failComplete = refused(409, 'FILE_NOT_UPLOADED', 'File bytes have not arrived yet');
  await engine.load('u1');
  await engine.add(deliver());
  await settle();
  const item = engine.list()[0]!;
  assert.equal(item.attention, undefined);
  assert.equal(item.uploads.pod!.uploaded, false);
  assert.equal(item.uploads.pod!.fileId, undefined);
  h.clock = item.nextAttemptAt + 1;
  engine.kick();
  await settle();
  assert.equal(h.log.filter((l) => l.startsWith('put')).length, 2);
  assert.equal(engine.list().length, 0);
});

test('missing local file is reported instead of retrying for ever', async () => {
  const { h, engine } = harness();
  h.files.delete('pod.jpg');
  await engine.load('u1');
  await engine.add(deliver());
  await settle();
  assert.equal(engine.list()[0]!.attention?.code, 'LOCAL_FILE_MISSING');
});

test('5xx and 429 retry; reconnecting clears the wait', async () => {
  const { h, engine } = harness();
  h.post = () => Promise.reject(refused(503, 'X', 'Down'));
  await engine.load('u1');
  await engine.add(deliver());
  await settle();
  const item = engine.list()[0]!;
  assert.equal(item.attention, undefined);
  assert.ok(item.nextAttemptAt > h.clock);
  h.post = () => Promise.resolve({});
  engine.setOnline(false);
  engine.setOnline(true);
  await settle();
  assert.equal(engine.list().length, 0, 'sent at once on reconnect, without waiting out the backoff');
});

test('signing out keeps the queue for that user only', async () => {
  const { engine } = harness();
  await engine.load('u1');
  engine.setOnline(false);
  await engine.add(deliver());
  engine.unload();
  assert.equal(engine.list().length, 0);
  await engine.load('u2');
  assert.equal(engine.list().length, 0, 'another account does not see it');
  engine.unload();
  await engine.load('u1');
  assert.equal(engine.list().length, 1, 'back again for the same account');
});

test('backoff grows and is capped at five minutes', () => {
  assert.equal(backoffMs(0, 1), 5_000);
  assert.equal(backoffMs(1, 1), 10_000);
  assert.equal(backoffMs(4, 1), 80_000);
  assert.equal(backoffMs(50, 1), 300_000);
  assert.equal(backoffMs(50, 0), 240_000);
});
