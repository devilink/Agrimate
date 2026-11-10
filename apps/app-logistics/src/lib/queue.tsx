/** Connects the queue engine to the phone: AsyncStorage, expo-file-system, the API client and the network listener. */
import { ApiError, type MyTrip } from '@agrimate/api-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { api } from './api';
import { useAuth } from './auth';
import { deleteKeptFile, keepFile, keptFileExists, keptFileUri, putToSignedUrl, type LocalFile } from './files';
import { useNet } from './net';
import { QueueEngine, type QueueItem, type QueueUpload } from './queueEngine';

export const QUEUE_FOLDER = 'queue';

export const queue = new QueueEngine({
  storage: { get: (k) => AsyncStorage.getItem(k), set: (k, v) => AsyncStorage.setItem(k, v) },
  now: () => Date.now(),
  createUpload: (u) => api.post('/files/upload-url', { purpose: u.purpose, sha256: u.sha256, contentType: u.contentType, sizeBytes: u.sizeBytes, ...(u.orderId ? { orderId: u.orderId } : {}) }),
  put: (url, u) => putToSignedUrl(url, { uri: keptFileUri(u.localName, QUEUE_FOLDER), contentType: u.contentType }),
  complete: async (fileId) => { await api.post(`/files/${fileId}/complete`); },
  post: (path, body) => api.post(path, body),
  async tripStatus(tripId) {
    const mine = await api.get<MyTrip[]>('/trips/mine');
    return mine.find((t) => t.id === tripId)?.status ?? null;
  },
  localFileExists: (name) => keptFileExists(name, QUEUE_FOLDER),
  deleteLocalFile: (name) => deleteKeptFile(name, QUEUE_FOLDER),
  describeError: (e) => {
    if (e instanceof ApiError) return { status: e.status, code: e.code, message: e.message };
    if (e && typeof e === 'object' && 'status' in e && 'message' in e) return e as { status: number; code?: string; message: string };
    return { message: e instanceof Error ? e.message : 'Connection problem' };
  },
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
});

/** Moves a file into the queue's own folder, so the OS cannot clear it, and describes it for the queue. */
export function queueUpload(file: LocalFile, purpose: string, orderId?: string): QueueUpload {
  return { localName: keepFile(file.uri, QUEUE_FOLDER), purpose, contentType: file.contentType, sizeBytes: file.sizeBytes, sha256: file.sha256, ...(orderId ? { orderId } : {}) };
}

export function QueueProvider({ children }: { children: ReactNode }) {
  const { me, refreshMe } = useAuth();
  const { online } = useNet();
  const userId = me?.id ?? null;

  useEffect(() => {
    if (!userId) return undefined;
    queue.load(userId).catch(() => undefined);
    return () => queue.unload();
  }, [userId]);

  useEffect(() => { queue.setOnline(online); }, [online]);

  // Sent documents change the approval status, which decides what the app shows.
  useEffect(() => queue.onDone((i) => { if (i.kind === 'PROFILE') refreshMe().catch(() => undefined); }), [refreshMe]);

  // Timers do not run while the app is in the background, so opening it again is a good moment to retry.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') queue.setOnline(online); });
    return () => sub.remove();
  }, [online]);

  return <>{children}</>;
}

const noItems: QueueItem[] = [];
export const useQueueItems = () => useSyncExternalStore(queue.subscribe, queue.list, () => noItems);

/** Runs `fn` whenever a queued action finishes, which is the moment fresh data is worth fetching. */
export function useQueueDone(fn: (item: QueueItem) => void) {
  useEffect(() => queue.onDone(fn), [fn]);
}

export function describeWaiting(item: QueueItem, online: boolean, now: number): string {
  if (item.attention) return item.attention.message;
  if (item.progress) return `${item.progress}...`;
  if (!online) return 'Waiting for a connection. It will send by itself.';
  const seconds = Math.ceil((item.nextAttemptAt - now) / 1000);
  if (item.lastError && seconds > 0) return `Connection problem. Trying again in about ${seconds < 60 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`}.`;
  return 'Waiting to send.';
}
