'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';

export interface Resource<T> { data: T | undefined; error: string | null; loading: boolean; reload: () => Promise<void> }

/**
 * Loads data and keeps the previous value on screen during a reload, so that refreshes never flash a skeleton.
 * Pass null as the loader to wait (for example until a dropdown has a value). Stale responses are discarded.
 */
export function useResource<T>(loader: (() => Promise<T>) | null, deps: readonly unknown[], opts: { pollMs?: number } = {}): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(loader !== null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const run = loaderRef.current;
    const id = ++seq.current;
    if (!run) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const v = await run();
      if (id === seq.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(errorMessage(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!opts.pollMs) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, reload]);

  return { data, error, loading, reload };
}

/** Wraps a mutation: tracks the submitting state and the API's error text. Returns true when `fn` succeeded. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clearError: useCallback(() => setError(null), []), setError };
}
