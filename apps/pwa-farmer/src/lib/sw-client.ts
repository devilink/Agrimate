'use client';

type SwMessage = { type: 'api-updated' | 'api-reread'; url: string };
const listeners = new Set<(m: SwMessage) => void>();
let wired = false;

/** Subscribes to "this API response changed" messages from the service worker. */
export function onSwMessage(fn: (m: SwMessage) => void) {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !wired) {
    wired = true;
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent<SwMessage>) => {
      if (e.data?.type === 'api-updated' || e.data?.type === 'api-reread') listeners.forEach((l) => l(e.data));
    });
  }
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Production only: a caching worker in `next dev` would serve stale code. Needs a secure context (HTTPS or localhost). */
export function registerServiceWorker() {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
  const url = `/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'}`;
  navigator.serviceWorker.register(url, { scope: '/' }).then(() => navigator.serviceWorker.ready).then((reg) => {
    // Hand over what this first page load fetched before the worker existed, such as the language chunk.
    const urls = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.includes('/_next/static/'));
    reg.active?.postMessage({ type: 'cache-urls', urls });
  }).catch(() => undefined);
}
