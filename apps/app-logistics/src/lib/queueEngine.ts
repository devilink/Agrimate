/**
 * The persistent outbox: this is what makes a dropped connection harmless.
 *
 * A queue item is one complete action: zero or more local files to upload, then one POST that references the resulting
 * file ids. Everything is written to storage before the network is touched, and after each step, so killing the app at any
 * point resumes from the last finished step instead of losing work or uploading a photo twice.
 *
 * Rules worth knowing:
 * - Items for one trip run strictly in order, so a pickup can never overtake its E-Way bill.
 * - Network failures, 5xx, 408 and 429 retry with backoff. Backoff resets when the connection returns.
 * - Other 4xx mean the server said no. Retrying cannot help, so the item stops and asks the person. It is never dropped.
 * - The reply to a POST can be lost after the server has acted. A 409 therefore triggers a check of the trip's real
 *   status, and an action that turns out to have landed counts as done.
 *
 * No React Native imports, so that it can be tested in plain Node (scripts/queue-engine.test.mts).
 */

export interface QueueUpload {
  /** File name inside the queue's folder, not a full path, since app container paths can change across updates. */
  localName: string;
  purpose: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  orderId?: string;
  fileId?: string;
  /** The bytes reached storage, so only /complete is left. */
  uploaded?: boolean;
  completed?: boolean;
}

export type QueueKind = 'PROFILE' | 'EWAY' | 'PICKUP' | 'DELIVER';

export interface QueueItem {
  id: string;
  kind: QueueKind;
  label: string;
  tripId?: string;
  createdAt: number;
  uploads: Record<string, QueueUpload>;
  /** Maps a body field to the upload slot whose file id goes there. */
  fileFields: Record<string, string>;
  path: string;
  body: Record<string, unknown>;
  /** Trip statuses that prove this action has already happened. */
  doneWhenTripStatus?: string[];
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  /** Set when the server refused the action. Stops retries until the person acts. */
  attention?: { message: string; code?: string };
  progress?: string;
}

export interface EngineError { status?: number; code?: string; message: string }

export interface QueueDeps {
  storage: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };
  now(): number;
  /** Must resolve to the file id. */
  createUpload(u: QueueUpload): Promise<{ fileId: string; uploadUrl: string }>;
  put(uploadUrl: string, u: QueueUpload): Promise<void>;
  complete(fileId: string): Promise<void>;
  post(path: string, body: Record<string, unknown>): Promise<unknown>;
  tripStatus(tripId: string): Promise<string | null>;
  localFileExists(localName: string): boolean;
  deleteLocalFile(localName: string): void;
  /** Normalises anything thrown by the functions above. No `status` means a network failure. */
  describeError(e: unknown): EngineError;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

export function backoffMs(attempts: number, random = Math.random()): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempts, 10));
  // Up to 20% jitter, so that phones reconnecting to the same tower do not all retry at once.
  return Math.round(ceiling * (0.8 + 0.2 * random));
}

const isRetryable = (e: EngineError) => e.code === 'UPLOAD_FAILED' || e.status === undefined || e.status === 0 || e.status === 401 || e.status === 408 || e.status === 425 || e.status === 429 || e.status >= 500;

export class QueueEngine {
  private items: QueueItem[] = [];
  private key: string | null = null;
  private running = false;
  private rerun = false;
  private online = true;
  private timer: unknown = null;
  private listeners = new Set<() => void>();
  private doneListeners = new Set<(item: QueueItem) => void>();
  private deps: QueueDeps;

  constructor(deps: QueueDeps) { this.deps = deps; }

  list = (): QueueItem[] => this.items;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  onDone = (fn: (item: QueueItem) => void) => { this.doneListeners.add(fn); return () => { this.doneListeners.delete(fn); }; };

  private emit() {
    this.items = [...this.items];
    for (const fn of this.listeners) fn();
  }

  private async persist() {
    if (this.key) await this.deps.storage.set(this.key, JSON.stringify(this.items));
  }

  /** Each user has their own queue, because uploaded files belong to the account that created them. */
  async load(userId: string) {
    this.key = `agrimate.queue.${userId}`;
    const raw = await this.deps.storage.get(this.key);
    let saved: QueueItem[] = [];
    if (raw) { try { saved = JSON.parse(raw) as QueueItem[]; } catch { saved = []; } }
    // Anything shown as in progress was interrupted when the app last stopped.
    this.items = saved.map((i) => { const { progress: _gone, ...rest } = i; return rest; });
    this.emit();
    this.kick();
  }

  unload() {
    this.key = null;
    this.items = [];
    this.clearTimer();
    this.emit();
  }

  private clearTimer() {
    if (this.timer !== null) { this.deps.clearTimer(this.timer); this.timer = null; }
  }

  /**
   * Adds an action. The same action for the same trip replaces the earlier one, keeping uploads already sent when the
   * bytes are identical. That lets a person fix a wrong delivery code without sending the PoD photo again.
   */
  async add(input: Pick<QueueItem, 'kind' | 'label' | 'tripId' | 'uploads' | 'fileFields' | 'path' | 'body' | 'doneWhenTripStatus'>) {
    const previous = this.items.find((i) => i.kind === input.kind && i.tripId === input.tripId);
    const uploads: Record<string, QueueUpload> = {};
    for (const [slot, u] of Object.entries(input.uploads)) {
      const old = previous?.uploads[slot];
      uploads[slot] = old && old.sha256 === u.sha256 ? { ...u, localName: old.localName, fileId: old.fileId, uploaded: old.uploaded, completed: old.completed } : u;
      if (old && uploads[slot]!.localName !== u.localName) this.deleteQuietly(u.localName);
    }
    if (previous) {
      const stillUsed = new Set(Object.values(uploads).map((u) => u.localName));
      for (const u of Object.values(previous.uploads)) if (!stillUsed.has(u.localName)) this.deleteQuietly(u.localName);
    }
    const item: QueueItem = { ...input, uploads, id: previous?.id ?? `${this.deps.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: previous?.createdAt ?? this.deps.now(), attempts: 0, nextAttemptAt: 0 };
    this.items = previous ? this.items.map((i) => (i.id === previous.id ? item : i)) : [...this.items, item];
    // Saved first: from here on the action survives anything that happens to the app or the network.
    await this.persist();
    this.emit();
    this.kick();
    return item;
  }

  async remove(id: string) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    this.items = this.items.filter((i) => i.id !== id);
    await this.persist();
    this.cleanup(item);
    this.emit();
    this.kick();
  }

  /** The person pressed Retry. */
  async retry(id: string) {
    this.items = this.items.map((i) => {
      if (i.id !== id) return i;
      const { attention: _a, lastError: _e, ...rest } = i;
      return { ...rest, attempts: 0, nextAttemptAt: 0 };
    });
    await this.persist();
    this.emit();
    this.kick();
  }

  setOnline(online: boolean) {
    const returned = online && !this.online;
    this.online = online;
    if (returned) {
      // Backoff exists for when the network is down. It is back, so waiting any longer helps nobody.
      this.items = this.items.map((i) => (i.attention ? i : { ...i, nextAttemptAt: 0 }));
      this.emit();
    }
    this.kick();
  }

  kick() {
    if (this.running) { this.rerun = true; return; }
    void this.run();
  }

  private next(): QueueItem | undefined {
    const now = this.deps.now();
    const blockedTrips = new Set<string>();
    for (const item of this.items) {
      const eligible = !item.attention && item.nextAttemptAt <= now;
      if (item.tripId) {
        if (blockedTrips.has(item.tripId)) continue;
        if (!eligible) { blockedTrips.add(item.tripId); continue; }
      }
      if (eligible) return item;
    }
    return undefined;
  }

  private async run() {
    this.running = true;
    this.clearTimer();
    try {
      while (this.key && this.online) {
        const item = this.next();
        if (!item) break;
        await this.process(item);
      }
    } finally {
      this.running = false;
    }
    if (this.rerun) { this.rerun = false; this.kick(); return; }
    this.schedule();
  }

  private schedule() {
    this.clearTimer();
    if (!this.key || !this.online) return;
    const times = this.items.filter((i) => !i.attention).map((i) => i.nextAttemptAt);
    if (!times.length) return;
    this.timer = this.deps.setTimer(() => { this.timer = null; this.kick(); }, Math.max(100, Math.min(...times) - this.deps.now()));
  }

  private update(id: string, patch: Partial<QueueItem>) {
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
  }

  private current(id: string) { return this.items.find((i) => i.id === id); }

  private async setUpload(id: string, slot: string, patch: Partial<QueueUpload>) {
    const item = this.current(id);
    if (!item) return;
    this.update(id, { uploads: { ...item.uploads, [slot]: { ...item.uploads[slot]!, ...patch } } });
    await this.persist();
  }

  private async sendUploads(item: QueueItem) {
    const slots = Object.keys(item.uploads);
    for (const [index, slot] of slots.entries()) {
      const u = this.current(item.id)?.uploads[slot];
      if (!u || u.completed) continue;
      if (!this.deps.localFileExists(u.localName)) throw { status: 410, code: 'LOCAL_FILE_MISSING', message: 'The photo for this item is no longer on the phone. Remove this item and take the photo again.' } satisfies EngineError;
      this.update(item.id, { progress: slots.length > 1 ? `Sending file ${index + 1} of ${slots.length}` : 'Sending file' });
      this.emit();
      if (!u.uploaded) {
        // A signed URL expires, so each try gets a fresh one rather than storing it.
        const init = await this.deps.createUpload(u);
        await this.setUpload(item.id, slot, { fileId: init.fileId });
        await this.deps.put(init.uploadUrl, u);
        await this.setUpload(item.id, slot, { uploaded: true });
      }
      const fileId = this.current(item.id)?.uploads[slot]?.fileId;
      if (!fileId) throw { status: 0, message: 'Upload has no file id' } satisfies EngineError;
      try {
        await this.deps.complete(fileId);
      } catch (e) {
        const err = this.deps.describeError(e);
        // Storage does not have the bytes after all, or they arrived damaged. Upload again.
        if (err.code === 'FILE_NOT_UPLOADED' || err.code === 'HASH_MISMATCH') await this.setUpload(item.id, slot, { uploaded: false, fileId: undefined });
        throw e;
      }
      await this.setUpload(item.id, slot, { completed: true });
    }
  }

  private bodyFor(id: string): Record<string, unknown> {
    const item = this.current(id)!;
    const body = { ...item.body };
    for (const [field, slot] of Object.entries(item.fileFields)) body[field] = item.uploads[slot]?.fileId;
    return body;
  }

  private cleanup(item: QueueItem) {
    for (const u of Object.values(item.uploads)) this.deleteQuietly(u.localName);
  }

  private deleteQuietly(name: string) {
    try { this.deps.deleteLocalFile(name); } catch { /* A leftover file only costs a little space. */ }
  }

  private async finish(id: string) {
    const item = this.current(id);
    if (!item) return;
    this.items = this.items.filter((i) => i.id !== id);
    await this.persist();
    this.cleanup(item);
    this.emit();
    for (const fn of this.doneListeners) fn(item);
  }

  /** After a 409: did the action actually land, with only the reply lost? */
  private async alreadyDone(item: QueueItem): Promise<boolean> {
    if (!item.tripId || !item.doneWhenTripStatus) return false;
    const status = await this.deps.tripStatus(item.tripId);
    return !!status && item.doneWhenTripStatus.includes(status);
  }

  private async process(item: QueueItem) {
    this.update(item.id, { progress: 'Sending' });
    this.emit();
    try {
      await this.sendUploads(item);
      this.update(item.id, { progress: 'Confirming' });
      this.emit();
      await this.deps.post(item.path, this.bodyFor(item.id));
      await this.finish(item.id);
    } catch (e) {
      const err = this.deps.describeError(e);
      const live = this.current(item.id);
      if (!live) return; // Removed while it was being sent.
      if (err.status === 409 && err.code === 'ILLEGAL_TRANSITION') {
        const done = await this.alreadyDone(live).catch(() => null);
        if (done === true) { await this.finish(item.id); return; }
        if (done === null) { await this.retryLater(item.id, err); return; }
      }
      // A file the server cannot find, or one left incomplete, gets uploaded again before giving up.
      if (err.code === 'FILE_NOT_UPLOADED' || (err.code === 'HASH_MISMATCH' && live.attempts < 2)) { await this.retryLater(item.id, err); return; }
      if (isRetryable(err)) { await this.retryLater(item.id, err); return; }
      const { progress: _p, ...rest } = live;
      this.items = this.items.map((i) => (i.id === item.id ? { ...rest, attention: { message: err.message, code: err.code } } : i));
      await this.persist();
      this.emit();
    }
  }

  private async retryLater(id: string, err: EngineError) {
    const live = this.current(id);
    if (!live) return;
    const attempts = live.attempts + 1;
    const { progress: _p, ...rest } = live;
    this.items = this.items.map((i) => (i.id === id ? { ...rest, attempts, nextAttemptAt: this.deps.now() + backoffMs(attempts), lastError: err.message } : i));
    await this.persist();
    this.emit();
  }
}
