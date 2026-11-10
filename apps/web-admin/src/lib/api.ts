import { ApiError, createApi, localStorageTokens } from '@agrimate/api-client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const tokens = localStorageTokens('agrimate.admin');

/** The admin and verifier sign-in page lives at an unlisted path; nothing in any portal links to it. */
export const LOGIN_PATH = '/adminagri';

/** The main site. Transport managers sign in there, alongside buyers and farmers, and are handed over to /handoff. */
export const PORTAL_URL = (process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** Remembers which sign-in page this browser's console user came from, so sign-out and expiry send them back to it. */
const ENTRY_KEY = 'agrimate.admin.entry';
export const setEntry = (entry: 'transport' | null) => {
  if (typeof localStorage === 'undefined') return;
  if (entry) localStorage.setItem(ENTRY_KEY, entry); else localStorage.removeItem(ENTRY_KEY);
};

export function goToLogin(reason?: 'expired' | 'role') {
  if (typeof window === 'undefined' || window.location.pathname === LOGIN_PATH || window.location.pathname === '/handoff') return;
  if (localStorage.getItem(ENTRY_KEY) === 'transport') {
    window.location.assign(`${PORTAL_URL}/login?as=transport`);
    return;
  }
  window.location.assign(reason ? `${LOGIN_PATH}?reason=${reason}` : LOGIN_PATH);
}

/**
 * The API rotates refresh tokens and treats reuse of a spent one as theft, revoking the whole family. createApi refreshes
 * once per 401, so a page that loads several things in parallel on an expired access token would reuse the token and sign
 * the operator out. This wrapper shares one in-flight refresh between concurrent callers holding the same token.
 */
const inFlightRefresh = new Map<string, Promise<Response>>();
const singleFlightFetch: typeof fetch = (input, init) => {
  const isRefresh = typeof input === 'string' && input.endsWith('/auth/refresh') && typeof init?.body === 'string';
  if (!isRefresh) return fetch(input, init);
  const key = init!.body as string;
  let pending = inFlightRefresh.get(key);
  if (!pending) {
    pending = fetch(input, init).finally(() => inFlightRefresh.delete(key));
    inFlightRefresh.set(key, pending);
  }
  return pending.then((r) => r.clone());
};

export const api = createApi({ baseUrl: API_URL, tokens, fetchImpl: singleFlightFetch, onSignedOut: () => goToLogin('expired') });

/** The API's own message when there is one, and a useful sentence for a network failure. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return `Could not reach the API at ${API_URL}. Check that it is running.`;
  return e instanceof Error ? e.message : 'Something went wrong';
}

/** createApi only signs out when a refresh fails; a 401 with no refresh token left comes back as a plain error. */
export function handleAuthError(e: unknown) {
  if (e instanceof ApiError && e.status === 401) void Promise.resolve(tokens.clear()).then(() => goToLogin('expired'));
}
