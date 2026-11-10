/**
 * The shared API client, wired for React Native: SecureStore for tokens, a request timeout, and a guard around refresh.
 *
 * Why the guard: the API rotates refresh tokens and revokes the whole session if a spent token is ever replayed. The
 * shared client has no single-flight logic, so two requests that hit 401 together would refresh twice with the same
 * token and sign the user out. The wrapper shares one refresh response between callers presenting the same token.
 */
import { createApi, type TokenStore } from '@agrimate/api-client';
import * as SecureStore from 'expo-secure-store';
import { REQUEST_TIMEOUT_MS } from './config';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const ACCESS = 'agrimate.access';
const REFRESH = 'agrimate.refresh';
const cache: { loaded: boolean; access: string | null; refresh: string | null } = { loaded: false, access: null, refresh: null };

async function load() {
  if (cache.loaded) return;
  const [access, refresh] = await Promise.all([SecureStore.getItemAsync(ACCESS), SecureStore.getItemAsync(REFRESH)]);
  // A concurrent set() may have run while the store was being read. Its values are newer.
  if (!cache.loaded) Object.assign(cache, { loaded: true, access, refresh });
}

export const tokens: TokenStore = {
  async getAccess() { await load(); return cache.access; },
  async getRefresh() { await load(); return cache.refresh; },
  async set(access, refresh) {
    Object.assign(cache, { loaded: true, access, refresh });
    await Promise.all([SecureStore.setItemAsync(ACCESS, access), SecureStore.setItemAsync(REFRESH, refresh)]);
  },
  async clear() {
    Object.assign(cache, { loaded: true, access: null, refresh: null });
    await Promise.all([SecureStore.deleteItemAsync(ACCESS), SecureStore.deleteItemAsync(REFRESH)]);
  },
};

function withTimeout(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** Refresh responses by request body (which holds the token). Kept briefly to cover a caller that read the token just before it rotated. */
const refreshes = new Map<string, Promise<{ status: number; text: string }>>();

// The shared client always passes the URL as a string.
const guardedFetch = ((input: string, init?: RequestInit) => {
  if (!input.endsWith('/auth/refresh') || typeof init?.body !== 'string') return withTimeout(input, init);
  const key = init.body;
  let shared = refreshes.get(key);
  if (!shared) {
    shared = withTimeout(input, init).then(async (r) => ({ status: r.status, text: await r.text() }));
    refreshes.set(key, shared);
    const forget = () => setTimeout(() => refreshes.delete(key), 30_000);
    shared.then(forget, () => refreshes.delete(key));
  }
  return shared.then((r) => new Response(r.text, { status: r.status, headers: { 'Content-Type': 'application/json' } }));
}) as typeof fetch;

let signedOutHandler: () => void = () => undefined;
export const setSignedOutHandler = (fn: () => void) => { signedOutHandler = fn; };

export const api = createApi({ baseUrl: API_URL, tokens, fetchImpl: guardedFetch, onSignedOut: () => signedOutHandler() });
