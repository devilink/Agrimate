'use client';
/** The portal's single API client instance, plus helpers for turning failures into text a person can act on. */
import { ApiError, createApi, localStorageTokens } from '@agrimate/api-client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const MOCK_TOOLS = process.env.NEXT_PUBLIC_MOCK_TOOLS !== 'false';
export const tokens = localStorageTokens('agrimate.buyer');

/**
 * Refresh tokens rotate, and the API treats a reused one as theft and revokes every session of the user. The client
 * refreshes per failed request, so parallel requests with an expired access token would otherwise sign the user out.
 * This collapses identical in-flight refresh calls into one.
 */
const inFlightRefresh = new Map<string, Promise<Response>>();
const singleFlightFetch: typeof fetch = (input, init) => {
  const isRefresh = typeof input === 'string' && input.endsWith('/auth/refresh');
  if (!isRefresh) return fetch(input, init);
  const key = String(init?.body ?? '');
  let pending = inFlightRefresh.get(key);
  if (!pending) {
    pending = fetch(input, init).finally(() => inFlightRefresh.delete(key));
    inFlightRefresh.set(key, pending);
  }
  return pending.then((r) => r.clone());
};

export const api = createApi({
  baseUrl: API_URL,
  tokens,
  fetchImpl: singleFlightFetch,
  onSignedOut: () => {
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') window.location.assign('/login');
  },
});

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return 'Could not reach the server. Check your connection and try again.';
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Try again.';
}

/** Runs `fn` over `items` with at most `limit` calls in flight, so that a long list stays inside the API rate limit. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Fetches a bearer-protected PDF and saves it, because a plain link cannot carry the token. */
export async function downloadWithAuth(path: string, filename: string): Promise<void> {
  const res = await api.raw('GET', path);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(res.status, undefined, body?.message ?? `Download failed (${res.status})`, body);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Signed URLs expire, so they are fetched at the moment of use. The tab is opened first to satisfy popup blockers. */
export async function openFile(fileId: string): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const { url } = await api.get<{ url: string }>(`/files/${fileId}/download-url`);
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.assign(url);
    }
  } catch (e) {
    tab?.close();
    throw e;
  }
}
