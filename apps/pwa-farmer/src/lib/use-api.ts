'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, memoryCache } from './api';
import { onSwMessage } from './sw-client';

export interface ApiState<T> { data: T | undefined; error: unknown; loading: boolean; reload: () => Promise<void> }

/** Reads a GET endpoint. Re-reads when the service worker reports fresher data and when the connection returns. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | undefined>(() => (path ? (memoryCache.get(path) as T | undefined) : undefined));
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!!path && !memoryCache.has(path));
  const latest = useRef(path);
  latest.current = path;

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api.get<T>(path);
      if (latest.current !== path) return;
      memoryCache.set(path, d);
      setData(d);
      setError(null);
    } catch (e) {
      if (latest.current === path) setError(e);
    } finally {
      if (latest.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!path) return;
    setData(memoryCache.get(path) as T | undefined);
    setLoading(!memoryCache.has(path));
    void reload();
    const onOnline = () => void reload();
    window.addEventListener('online', onOnline);
    const off = onSwMessage((m) => {
      const u = new URL(m.url);
      if (u.pathname + u.search === `/api/v1${path}`) void reload();
    });
    return () => { window.removeEventListener('online', onOnline); off(); };
  }, [path, reload]);

  return { data, error, loading, reload };
}
