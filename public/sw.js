/* Renvio PWA service worker. No inline eval, no dynamic code execution. */
const CACHE_NAME = 'renvio-v1';
const PRECACHE = ['/', '/servio-default.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        // A missing icon or an offline install must never fail the whole SW install.
        await Promise.allSettled(PRECACHE.map((path) => cache.add(path)));
      } catch {
        // Cache storage can be unavailable (private mode) — continue without precache.
      }
      if (typeof self.skipWaiting === 'function') self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        );
      } catch {
        // Ignore cache cleanup errors.
      }
      if (self.clients && typeof self.clients.claim === 'function') {
        await self.clients.claim();
      }
    })(),
  );
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      } catch {
        // Best-effort cache fill only.
      }
    }
    return response;
  } catch {
    try {
      const cache = await caches.open(CACHE_NAME);
      return (
        (await cache.match(request, { ignoreSearch: true })) ||
        (await cache.match('/')) ||
        Response.error()
      );
    } catch {
      return Response.error();
    }
  }
}

async function cacheFirstAsset(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.ok) {
      try {
        await cache.put(request, response.clone());
      } catch {
        // Best-effort cache fill only.
      }
    }
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never touch API traffic or the owner cabinet, including its data fetches.
  if (url.pathname.startsWith('/api/')) return;
  if (/^\/s\/[^/]+\/owner(?:\/|$)/.test(url.pathname)) return;
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  event.respondWith(cacheFirstAsset(request));
});

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') payload = parsed;
    } catch {
      payload = { body: event.data.text() };
    }
  }
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Renvio';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: typeof payload.icon === 'string' ? payload.icon : undefined,
    data: { url: typeof payload.url === 'string' ? payload.url : '/' },
    actions: [
      { action: 'open', title: 'Открыть' },
      { action: 'close', title: 'Закрыть' },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'close') return;

  const rawUrl =
    event.notification.data && typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : '/';
  let target;
  try {
    target = new URL(rawUrl, self.location.origin);
    if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);
  } catch {
    target = new URL('/', self.location.origin);
  }

  event.waitUntil(
    (async () => {
      const clients = self.clients
        ? await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        : [];
      for (const client of clients) {
        if (typeof client.focus !== 'function') continue;
        await client.focus();
        if (typeof client.navigate === 'function') {
          await client.navigate(target.href);
        }
        return;
      }
      if (self.clients && typeof self.clients.openWindow === 'function') {
        await self.clients.openWindow(target.href);
      }
    })(),
  );
});
