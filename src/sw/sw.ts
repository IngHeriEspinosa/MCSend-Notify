/**
 * Service worker de la PWA (Serwist). Lo compila scripts/build-sw.mjs con esbuild e inyecta el
 * manifiesto de precarga tras `next build`.
 *
 * - Precarga: CSS, fuentes y las páginas sin conexión (/es/offline y /en/offline).
 * - JS y recursos estáticos de Next (`/_next/static`, con hash): caché primero.
 * - Imágenes de marca e iconos: caché con revalidación.
 * - Páginas, API, seguimiento de correos y Server Actions: siempre red. Los datos de los tenants
 *   nunca se guardan en el dispositivo (equipos compartidos); sin conexión se muestra la página
 *   offline en el idioma de la URL.
 */
/// <reference lib="webworker" />
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
} from 'serwist';

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: Array<PrecacheEntry | string> | undefined;
};

const offlineFor = (pathname: string) =>
  pathname.startsWith('/en') ? '/en/offline' : '/es/offline';

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  disableDevLogs: true,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/trk/')),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/_next/static/'),
      handler: new CacheFirst({
        cacheName: 'mcsn-static',
        plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60 })],
      }),
    },
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && (url.pathname.startsWith('/brand/') || url.pathname.startsWith('/icons/')),
      handler: new StaleWhileRevalidate({
        cacheName: 'mcsn-brand',
        plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 30 * 24 * 60 * 60 })],
      }),
    },
    {
      matcher: ({ request }) => request.mode === 'navigate',
      handler: new NetworkOnly(),
    },
  ],
  fallbacks: {
    entries: ['/es/offline', '/en/offline'].map((url) => ({
      url,
      matcher: ({ request }) =>
        request.destination === 'document' && offlineFor(new URL(request.url).pathname) === url,
    })),
  },
});

serwist.addEventListeners();
