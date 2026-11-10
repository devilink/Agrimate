import type { MeView, SessionUser } from '@agrimate/api-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setSignedOutHandler, tokens } from './api';
import { APP_ROLE } from './config';
import { clearCache } from './data';

const ME_KEY = 'agrimate.me';

interface Auth {
  status: 'loading' | 'out' | 'in';
  me: MeView | null;
  requestOtp: (phone: string) => Promise<{ devOtp?: string }>;
  signIn: (i: { phone: string; code: string; name?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
}
const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}

/** Signed-in screens only render once `me` exists, so this cannot be null there. */
export function useMe(): MeView {
  const { me } = useAuth();
  if (!me) throw new Error('useMe used while signed out');
  return me;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Auth['status']>('loading');
  const [me, setMe] = useState<MeView | null>(null);

  const setSignedOut = useCallback(() => { setMe(null); setStatus('out'); }, []);

  const refreshMe = useCallback(async () => {
    const fresh = await api.get<MeView>('/auth/me');
    setMe(fresh);
    setStatus('in');
    await AsyncStorage.setItem(ME_KEY, JSON.stringify(fresh));
  }, []);

  useEffect(() => {
    setSignedOutHandler(setSignedOut);
    (async () => {
      if (!(await tokens.getRefresh())) { setSignedOut(); return; }
      // The last known profile lets a driver open the app with no signal at all.
      const saved = await AsyncStorage.getItem(ME_KEY).catch(() => null);
      if (saved) { try { setMe(JSON.parse(saved) as MeView); setStatus('in'); } catch { /* Fetched again below. */ } }
      try {
        await refreshMe();
      } catch {
        // With a saved profile the app keeps working offline. Without one there is nothing to show, so go to sign-in.
        if (!saved) setStatus('out');
      }
    })();
  }, [refreshMe, setSignedOut]);

  const value = useMemo<Auth>(() => ({
    status,
    me,
    refreshMe,
    requestOtp: (phone) => api.requestOtp(phone),
    async signIn({ phone, code, name }) {
      // role and name only count for a brand-new number. Existing accounts keep what they have.
      const user: SessionUser = await api.verifyOtp({ phone, code, role: APP_ROLE, language: 'en', ...(name ? { name } : {}) });
      if (user.role !== APP_ROLE) {
        await api.logout();
        throw new Error(`This number is registered for the ${user.role.toLowerCase()} side of Agrimate, so it cannot be used in this app.`);
      }
      await refreshMe();
    },
    async signOut() {
      await api.logout();
      await AsyncStorage.removeItem(ME_KEY);
      await clearCache();
      setSignedOut();
    },
  }), [status, me, refreshMe, setSignedOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
