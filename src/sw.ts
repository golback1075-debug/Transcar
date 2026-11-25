import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  matchPrecache,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies';

interface SwExtendableEvent extends Event {
  waitUntil(f: Promise<unknown>): void;
}

interface SwMessageEvent extends Event {
  data?: { type?: string } | null;
  waitUntil?(f: Promise<unknown>): void;
}

interface SwGlobal {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
  skipWaiting(): Promise<void>;
  clients: {
    claim(): Promise<void>;
  };
  addEventListener(type: 'install', listener: (event: SwExtendableEvent) => void): void;
  addEventListener(type: 'activate', listener: (event: SwExtendableEvent) => void): void;
  addEventListener(type: 'message', listener: (event: SwMessageEvent) => void): void;
}

const sw = self as unknown as SwGlobal;

const NAV_CACHE_NAME = 'transcar-html-nav-v2';
const PUBLIC_API_CACHE_NAME = 'transcar-public-api-v2';
const RUNTIME_API_CACHE_NAME = 'transcar-runtime-api-v2';
const GOOGLE_FONTS_CACHE_NAME = 'google-fonts-cache';
const GSTATIC_FONTS_CACHE_NAME = 'gstatic-fonts-cache';

const ACTIVE_RUNTIME_CACHES = new Set([
  NAV_CACHE_NAME,
  PUBLIC_API_CACHE_NAME,
  RUNTIME_API_CACHE_NAME,
  GOOGLE_FONTS_CACHE_NAME,
  GSTATIC_FONTS_CACHE_NAME,
]);

precacheAndRoute((self as unknown as SwGlobal).__WB_MANIFEST);
cleanupOutdatedCaches();

sw.addEventListener('install', (event) => {
  event.waitUntil(sw.skipWaiting());
});

// Safe activation: wait for user confirmation ("Update Now") via SKIP_WAITING message
// so open tabs with unsaved rental contracts or forms are never interrupted mid-operation.
sw.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void sw.skipWaiting();
  }
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Remove legacy/obsolete Cache Storage buckets without touching IndexedDB or localStorage
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(
          keys.map((key) => {
            if (key.startsWith('workbox-precache')) return Promise.resolve(false);
            if (ACTIVE_RUNTIME_CACHES.has(key)) return Promise.resolve(false);
            return caches.delete(key);
          }),
        );
      }
      await sw.clients.claim();
    })(),
  );
});

// Version check endpoints must NEVER be served from cache
registerRoute(
  ({ url }) => url.pathname === '/version.json' || url.pathname === '/api/version',
  new NetworkOnly(),
  'GET',
);

// HTML navigations (/, /index.html, /book):
// Always try fresh network HTML first (bypassing HTTP/CDN cache) so opening the website
// or reopening after uninstalling the PWA never gets stuck on a stale HTML version.
// Falls back cleanly to cached HTML / precached index.html when offline.
const navStrategy = new NetworkFirst({
  cacheName: NAV_CACHE_NAME,
  networkTimeoutSeconds: 3,
  plugins: [
    {
      requestWillFetch: async ({ request }) =>
        new Request(request, { cache: 'no-store' }),
    },
    new CacheableResponsePlugin({ statuses: [200] }),
    new ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 60 * 60 * 24 * 7,
    }),
  ],
});

registerRoute(
  new NavigationRoute(
    async (params) => {
      try {
        const res = await navStrategy.handle(params);
        if (res) return res;
      } catch {
        // Offline fallback below
      }
      const precached = (await matchPrecache('/index.html')) || (await matchPrecache('index.html'));
      if (precached) return precached;
      const cache = await caches.open(NAV_CACHE_NAME);
      const cachedNav = await cache.match('/index.html');
      if (cachedNav) return cachedNav;
      const allKeys = await caches.keys();
      for (const key of allKeys) {
        const c = await caches.open(key);
        const match = (await c.match('/index.html')) || (await c.match('/'));
        if (match) return match;
      }
      return Response.error();
    },
    {
      denylist: [/^\/api\//, /^\/version\.json$/, /^\/sw\.js$/, /^\/dev-sw\.js$/],
    },
  ),
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/public/'),
  new NetworkFirst({
    cacheName: PUBLIC_API_CACHE_NAME,
    networkTimeoutSeconds: 4,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 60 * 60 * 24 * 7,
      }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
  'GET',
);

registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/api/events') &&
    url.pathname !== '/api/version',
  new NetworkFirst({
    cacheName: RUNTIME_API_CACHE_NAME,
    networkTimeoutSeconds: 4,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 120,
        maxAgeSeconds: 60 * 60 * 24 * 7,
      }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
  'GET',
);

registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({
    cacheName: GOOGLE_FONTS_CACHE_NAME,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
  'GET',
);

registerRoute(
  /^https:\/\/fonts\.gstatic\.com\/.*/i,
  new CacheFirst({
    cacheName: GSTATIC_FONTS_CACHE_NAME,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
  'GET',
);
