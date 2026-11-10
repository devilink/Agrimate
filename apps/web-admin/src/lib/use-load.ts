'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { handleAuthError } from './api';

export interface Loaded<T> { data: T | undefined; error: unknown; loading: boolean; loaded: boolean; reload: () => Promise<void> }

/**
 * Loads on mount and whenever deps change. A change of deps clears the old data, so rows from the previous filter are
 * never shown under the new one. A manual reload keeps them on screen and flags a failure above them.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [s, setS] = useState<{ data: T | undefined; error: unknown; loading: boolean; loaded: boolean }>({ data: undefined, error: null, loading: true, loaded: false });
  const seq = useRef(0);
  const latest = useRef(fn);
  latest.current = fn;

  const run = useCallback(async (reset: boolean) => {
    const id = ++seq.current;
    setS((p) => (reset ? { data: undefined, error: null, loading: true, loaded: false } : { ...p, loading: true }));
    try {
      const data = await latest.current();
      if (id === seq.current) setS({ data, error: null, loading: false, loaded: true });
    } catch (e) {
      handleAuthError(e);
      if (id === seq.current) setS((p) => ({ ...p, error: e, loading: false }));
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(true); }, deps);
  const reload = useCallback(() => run(false), [run]);
  return { ...s, reload };
}
