'use client';
import { createApi, localStorageTokens } from '@agrimate/api-client';

const TOKEN_PREFIX = 'agrimate.farmer';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const API_CACHE = 'agrimate-api-v1';
const tokens = localStorageTokens(TOKEN_PREFIX);

/** Serialises token refreshes across requests, and across tabs where Web Locks exist. */
let chain: Promise<unknown> = Promise.resolve();
function serialised<T>(job: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('agrimate.farmer.refresh', job) as Promise<T>;
  const next = chain.then(job, job);
  chain = next.catch(() => undefined);
  return next;
}

/**
 * The API rotates refresh tokens and treats any reuse of a spent one as theft, revoking every session. The shared client
 * refreshes separately for each request that got a 401, so several parallel requests would sign the farmer out. Here,
 * refreshes run one at a time, and a request that waited behind a refresh reuses that refresh's result.
 */
const fetchImpl: typeof fetch = (input, init) => {
  if (!String(input).endsWith('/auth/refresh')) return fetch(input, init);
  const accessAtRequest = localStorage.getItem(`${TOKEN_PREFIX}.access`);
  return serialised(async () => {
    const access = localStorage.getItem(`${TOKEN_PREFIX}.access`);
    const refresh = localStorage.getItem(`${TOKEN_PREFIX}.refresh`);
    if (access && refresh && access !== accessAtRequest) {
      return new Response(JSON.stringify({ accessToken: access, refreshToken: refresh }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const res = await fetch(input, { ...init, body: JSON.stringify({ refreshToken: refresh }) });
    if (res.ok) {
      const b = (await res.clone().json()) as { accessToken: string; refreshToken: string };
      tokens.set(b.accessToken, b.refreshToken);
    }
    return res;
  });
};

const memory = new Map<string, unknown>();
/** Last response per path, so that going back to a screen is instant instead of a skeleton. */
export const memoryCache = memory;

export async function clearSavedData() {
  memory.clear();
  if (typeof caches !== 'undefined') await caches.delete(API_CACHE).catch(() => undefined);
}

export const api = createApi({
  baseUrl: API_URL,
  tokens,
  fetchImpl,
  onSignedOut: () => {
    void clearSavedData().finally(() => { window.location.href = '/login'; });
  },
});

/** Remembered at login so that the outbox knows whose writes these are, even offline. */
export const rememberUser = (id: string) => localStorage.setItem(`${TOKEN_PREFIX}.userId`, id);
export const currentUserId = () => (typeof localStorage === 'undefined' ? undefined : localStorage.getItem(`${TOKEN_PREFIX}.userId`) ?? undefined);

export const isSignedIn = () => typeof localStorage !== 'undefined' && !!localStorage.getItem(`${TOKEN_PREFIX}.refresh`);

export async function signOut() {
  await api.logout();
  await clearSavedData();
  window.location.href = '/login';
}

/** Takes over a session that the main Agrimate sign-in page started for a farmer (see app/handoff). */
export async function adoptSession(accessToken: string, refreshToken: string) {
  await clearSavedData();
  tokens.set(accessToken, refreshToken);
}
