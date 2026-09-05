/**
 * QuickLabelCrop - Service Worker
 * Provides offline caching, lightning-fast loads, and PWA installability.
 */

const CACHE_NAME = 'quicklabelcrop-v1';
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
