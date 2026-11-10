'use client';
/**
 * Persistent outbox for writes that are safe to repeat: bids, listings and the language choice.
 * Lives in localStorage, so it survives closing the app, and is tied to the user who queued it.
 * Uploads and KYC are deliberately excluded: KYC holds PAN and bank details that must not sit on the phone.
 *
 * Retry rules: a network failure, 5xx, 429 or 401 stays pending. Any other 4xx is a final answer from the server, so it
 * moves to `failed` and is shown to the farmer with the reason.
 */
import { ApiError, type ListingView } from '@agrimate/api-client';
import { useSyncExternalStore } from 'react';
import { api, isSignedIn } from './api';

export type QueueKind = 'LISTING' | 'BID' | 'LANGUAGE';
export interface QueueItem {
  id: string;
  kind: QueueKind;
  ownerId: string;
  method: 'POST' | 'PATCH';
  path: string;
  body: Record<string, unknown>;
  queuedAt: string;
  /** What to show in the waiting list, already translated when it was queued. */
  label: string;
  status: 'PENDING' | 'FAILED';
  attempts: number;
  error?: { code?: string; status: number; body?: unknown };
}

const KEY = 'agrimate.farmer.queue';
const EMPTY: QueueItem[] = [];
let snapshot: QueueItem[] | null = null;
const subscribers = new Set<() => void>();

const read = (): QueueItem[] => {
  if (typeof localStorage === 'undefined') return EMPTY;
  if (snapshot) return snapshot;
  try { snapshot = JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueueItem[]; } catch { snapshot = []; }
  return snapshot;
};
const write = (items: QueueItem[]) => {
  snapshot = items;
  localStorage.setItem(KEY, JSON.stringify(items));
  subscribers.forEach((s) => s());
};
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === KEY) { snapshot = null; subscribers.forEach((s) => s()); } });
}

export const useQueue = () => useSyncExternalStore((cb) => { subscribers.add(cb); return () => subscribers.delete(cb); }, read, () => EMPTY);

/** attempts: 1 means an earlier try may already have reached the server, so a listing gets the duplicate check first. */
export function enqueue(i: Pick<QueueItem, 'kind' | 'ownerId' | 'method' | 'path' | 'body' | 'label'> & { attempts?: number }) {
  // A newer bid on the same RFQ, or a newer language, replaces the waiting one.
  const rest = read().filter((q) => !(q.path === i.path && (q.kind === 'BID' || q.kind === 'LANGUAGE')));
  write([...rest, { ...i, id: crypto.randomUUID?.() ?? String(Date.now()), queuedAt: new Date().toISOString(), status: 'PENDING', attempts: i.attempts ?? 0 }]);
}
export const discard = (id: string) => write(read().filter((q) => q.id !== id));

/**
 * POST /listings has no idempotency key, so a listing whose response was lost could be created twice on retry. Before
 * repeating one, look for a listing of ours with the same terms created since it was queued. `_fresh` makes the service
 * worker skip its cache for this read.
 */
const CLOCK_SLACK_MS = 10 * 60_000; // queuedAt is phone time and createdAt is server time.
async function alreadyListed(item: QueueItem) {
  const mine = await api.get<ListingView[]>('/listings?mine=true&_fresh=1');
  const b = item.body as { commodityId: string; gradeId: string; quantityKg: number; pricePaisePerKg: string };
  return mine.some((l) => l.commodity.id === b.commodityId && l.grade.id === b.gradeId && l.quantityKg === b.quantityKg && l.pricePaisePerKg === b.pricePaisePerKg && Date.parse(l.createdAt) >= Date.parse(item.queuedAt) - CLOCK_SLACK_MS);
}

let flushing = false;
export async function flushQueue(ownerId: string | undefined) {
  if (flushing || !ownerId || !isSignedIn() || !navigator.onLine) return;
  flushing = true;
  const update = (id: string, patch: Partial<QueueItem>) => write(read().map((q) => (q.id === id ? { ...q, ...patch } : q)));
  try {
    for (const item of read().filter((q) => q.ownerId === ownerId && q.status === 'PENDING')) {
      try {
        if (item.kind === 'LISTING' && item.attempts > 0 && (await alreadyListed(item))) { discard(item.id); continue; }
        update(item.id, { attempts: item.attempts + 1 });
        await (item.method === 'PATCH' ? api.patch(item.path, item.body) : api.post(item.path, item.body));
        discard(item.id);
      } catch (e) {
        if (!(e instanceof ApiError)) return; // Still offline: stop, and try everything again on the next trigger.
        if (e.status === 401 || e.status === 429 || e.status >= 500) return;
        // A language the API does not know yet stays saved on this phone; there is nothing the farmer can do about it.
        if (item.kind === 'LANGUAGE') { discard(item.id); continue; }
        update(item.id, { status: 'FAILED', error: { code: e.code, status: e.status, body: e.body } });
      }
    }
  } finally {
    flushing = false;
  }
}
