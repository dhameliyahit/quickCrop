/**
 * QuickLabelCrop - Service Worker
 * Provides offline caching, lightning-fast loads, and PWA installability.
 */

const CACHE_NAME = 'quicklabelcrop-v2';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/flipkart-shipping-label-crop-tool/',
  '/flipkart-shipping-label-crop-tool/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/pdf-cropper.js',
  '/js/pdf-parser.js',
  '/js/pwa.js',
  '/assets/logo.svg',
  '/assets/app-icon.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-512.png',
  '/assets/flipkart-logo.svg',
  '/assets/binocular-404-error.json',
  '/404.html',
  '/manifest.webmanifest'
];

// Install Event: Precache core app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[Service Worker] Non-fatal precache warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up old caches & claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Stale-While-Revalidate for local assets, Network-First for external
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Dedicated handling for HTML page navigation to prevent ERR_FAILED on redirects
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          // If server issued a redirect (e.g. 301/308), Chrome cannot accept redirected responses in respondWith directly
          if (networkResponse.redirected) {
            return Response.redirect(networkResponse.url, 302);
          }
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback
          return caches.match(request).then((cachedResponse) => {
            return cachedResponse || caches.match('/index.html');
          });
        })
    );
    return;
  }

  const url = new URL(request.url);

  // If request is from our own origin
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        }).catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
  } else {
    // External CDN libraries (pdf-lib, pdf.js, fonts): Cache-first fallback
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        }).catch(() => cachedResponse);
      })
    );
  }
});
