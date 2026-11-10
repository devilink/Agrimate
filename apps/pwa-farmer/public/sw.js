/*
 * Agrimate farmer app service worker. Hand-written: no build plugin.
 *
 * - App shell (route HTML + hashed static assets): precached on install, so that the app opens with no network.
 * - Pages: network first, but a slow connection falls back to the saved copy after 3 seconds.
 * - API GET data: stale-while-revalidate. The saved copy answers at once and the network refreshes it; when the data
 *   changed, open pages get an `api-updated` message and re-read. This is what shows last-seen orders offline.
 * - Mutations are never queued here: the page owns that (src/lib/queue.ts), because only it knows what is safe to retry.
 *
 * The version comes from the registration URL (/sw.js?v=<build id>), so each build gets a fresh shell cache.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const SHELL_CACHE = `agrimate-shell-${VERSION}`;
// Not versioned: last-seen data should survive an app update. The page deletes this cache on sign-out.
const API_CACHE = 'agrimate-api-v1';
const NETWORK_WAIT_MS = 3000;
/** After a successful write, reads go to the network first for this long, so that a screen never shows its old self. */
const FRESH_AFTER_WRITE_MS = 10000;

const ROUTES = ['/', '/login', '/kyc', '/listings', '/listings/new', '/organic', '/rfqs', '/rfqs/bid', '/orders', '/orders/detail', '/orders/dispatch', '/orders/self-cert', '/ledger', '/account'];
const STATIC_FILES = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png'];

let lastWriteAt = 0;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const assets = new Set(STATIC_FILES);
    await Promise.allSettled(ROUTES.map(async (route) => {
      const res = await fetch(route, { cache: 'no-cache' });
      if (!res.ok) return;
      const html = await res.clone().text();
      await cache.put(route, res);
      for (const m of html.matchAll(/\/_next\/static\/[^"'\\\s)]+/g)) assets.add(m[0]);
    }));
    await Promise.allSettled([...assets].map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('agrimate-shell-') && n !== SHELL_CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/** The page sends what it already loaded before this worker took control, e.g. the language chunk on first visit. */
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-urls') return;
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const urls = (event.data.urls || []).filter((u) => new URL(u).origin === self.location.origin && new URL(u).pathname.startsWith('/_next/static/'));
    await Promise.allSettled(urls.map(async (u) => { if (!(await cache.match(u))) await cache.add(u); }));
  })());
});

const notify = async (type, url) => {
  const list = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of list) c.postMessage({ type, url });
};

/** Signed links expire and auth responses carry tokens, so neither is ever stored. */
const isCacheableApiGet = (url) => {
  const p = url.pathname.slice('/api/v1'.length);
  if (p.startsWith('/files/')) return false;
  if (p.startsWith('/auth/') && p !== '/auth/me') return false;
  return !url.searchParams.has('_fresh');
};

async function apiStaleWhileRevalidate(event, request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request.url, { ignoreVary: true });
  const revalidate = fetch(request).then(async (res) => {
    if (res.ok) {
      const fresh = await res.clone().text();
      const old = cached ? await cached.clone().text() : null;
      await cache.put(request.url, res.clone());
      if (old !== null && old !== fresh) await notify('api-updated', request.url);
    } else if (res.status === 401) {
      // The access token expired, which only the page can fix. Drop the copy and ask it to re-read: that read reaches
      // the network, gets the 401, and the API client refreshes the token and retries.
      await cache.delete(request.url, { ignoreVary: true });
      if (cached) await notify('api-reread', request.url);
    } else if (res.status === 403 || res.status === 404) {
      await cache.delete(request.url, { ignoreVary: true });
    }
    return res;
  });
  if (!cached) return revalidate;
  if (Date.now() - lastWriteAt < FRESH_AFTER_WRITE_MS) return revalidate.catch(() => cached);
  event.waitUntil(revalidate.catch(() => undefined));
  return cached;
}

/** Waits briefly for the network. A slow rural connection gets the saved copy now, and the download still updates it. */
async function networkThenSaved(event, request, key, fallbackKey) {
  const cache = await caches.open(SHELL_CACHE);
  const saved = (await cache.match(key)) || (fallbackKey ? await cache.match(fallbackKey) : undefined);
  const network = fetch(request).then(async (res) => {
    if (res.ok) await cache.put(key, res.clone());
    return res;
  });
  event.waitUntil(network.catch(() => undefined));
  if (!saved) return network.catch(() => Response.error());
  const timeout = new Promise((resolve) => setTimeout(() => resolve(saved), NETWORK_WAIT_MS));
  return Promise.race([network.catch(() => saved), timeout]);
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const isApi = url.pathname.startsWith('/api/v1/');

  if (request.method !== 'GET') {
    if (isApi) event.respondWith(fetch(request).then((res) => { if (res.ok) lastWriteAt = Date.now(); return res; }));
    return;
  }
  if (isApi) {
    if (isCacheableApiGet(url)) event.respondWith(apiStaleWhileRevalidate(event, request));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Pages take their ids from the query string, so that one saved copy of each screen serves any order offline.
    event.respondWith(networkThenSaved(event, request, url.pathname, '/'));
  } else if (url.searchParams.has('_rsc') || request.headers.get('RSC')) {
    // Next's in-app navigation data. On failure Next falls back to a full page load, which the branch above serves.
    event.respondWith(networkThenSaved(event, request, url.pathname + url.search));
  } else if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(cacheFirst(request));
  }
});
