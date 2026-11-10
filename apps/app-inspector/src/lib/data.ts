/**
 * Fetching with a local copy. Saved data shows at once and stays visible offline, and the network is only touched on
 * first show, on pull-to-refresh, or when a caller asks. There is no polling, so idle screens use no data.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './format';
import { useNet } from './net';

const PREFIX = 'agrimate.cache.';

export async function clearCache() {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
}

export function useCached<T>(key: string, fetcher: () => Promise<T>, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const { online } = useNet();
  const [data, setData] = useState<T | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await fetcherRef.current();
      setData(fresh);
      setSavedAt(Date.now());
      setError(null);
      AsyncStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value: fresh })).catch(() => undefined);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let alive = true;
    (async () => {
      const raw = await AsyncStorage.getItem(PREFIX + key).catch(() => null);
      if (alive && raw) {
        try {
          const saved = JSON.parse(raw) as { at: number; value: T };
          setData((current) => current ?? saved.value);
          setSavedAt((current) => current ?? saved.at);
        } catch { /* A damaged local copy is simply ignored. */ }
      }
      if (alive) reload();
    })();
    return () => { alive = false; };
  }, [key, enabled, reload]);

  // Coming back online refreshes once if the last attempt failed.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && enabled && error) reload();
    wasOnline.current = online;
  }, [online, enabled, error, reload]);

  return { data, loading, error, reload, savedAt };
}
