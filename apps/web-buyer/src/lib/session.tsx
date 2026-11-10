'use client';
/** Session for the signed-in portal: loads the profile, and sends everyone who is not a signed-in buyer back to /login. */
import type { MeView } from '@agrimate/api-client';
import { ApiError } from '@agrimate/api-client';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, tokens } from './api';

interface Session {
  me: MeView;
  kybVerified: boolean;
  reloadMe: () => Promise<void>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession must be used inside SessionGate');
  return s;
}

export function SessionGate({ children, loading, failed }: { children: ReactNode; loading: ReactNode; failed: (message: string, retry: () => void) => ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<MeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    if (!tokens.getAccess()) {
      router.replace('/login');
      return;
    }
    try {
      const m = await api.get<MeView>('/auth/me');
      if (m.role !== 'BUYER') {
        await api.logout();
        router.replace('/login?reason=role');
        return;
      }
      setMe(m);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await tokens.clear();
        router.replace('/login');
        return;
      }
      setError(errorMessage(e));
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  const value = useMemo<Session | null>(() => me && ({
    me,
    kybVerified: me.buyer?.kybStatus === 'VERIFIED',
    reloadMe: load,
    signOut: async () => {
      await api.logout();
      router.replace('/login');
    },
  }), [me, load, router]);

  if (error && !me) return <>{failed(error, () => void load())}</>;
  if (!value) return <>{loading}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
