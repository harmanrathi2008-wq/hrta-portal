const CACHE_NAME = 'hrta-portal-cache-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/assets/nta_logo.png',
  '/assets/cosmic_bg.png'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).catch(err => {
      console.error('[Service Worker] Install caching failed:', err);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).catch(err => {
      console.error('[Service Worker] Activation failed:', err);
    })
  );
  self.clients.claim();
});

// Fetch Event (Network First for pages/API, Cache First for assets)
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Bypass service worker for ALL cross-origin requests (e.g. Cloudinary, Supabase, Google Fonts)
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  // Bypass for local non-GET requests or local API routes
  if (
    requestUrl.pathname.startsWith('/api') || 
    event.request.method !== 'GET'
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache the response if it's a valid local static resource
        if (response.status === 200 && (event.request.url.includes('/assets/') || event.request.url.includes('.js') || event.request.url.includes('.css'))) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseClone).catch(e => {
                console.warn('[Service Worker] Failed to write resource to cache (quota exceeded?):', e);
              });
            })
            .catch(err => {
              console.warn('[Service Worker] Failed to open cache for storing resource:', err);
            });
        }
        return response;
      })
      .catch((err) => {
        console.warn('[Service Worker] Network request failed, falling back to cache:', err);
        // Fallback to cache if network fails
        return caches.match(event.request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // If the HTML page request fails (due to offline), serve index.html for SPA router
            if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/').then(fallback => {
                return fallback || new Response('Offline and no fallback resource available.', {
                  status: 503,
                  headers: { 'Content-Type': 'text/plain' }
                });
              });
            }
            // Fallback response for missing assets
            return new Response('Offline asset unavailable.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            });
          })
          .catch(cacheErr => {
            console.error('[Service Worker] Cache lookup error:', cacheErr);
            return new Response('Offline service error.', {
              status: 500,
              headers: { 'Content-Type': 'text/plain' }
            });
          });
      })
  );
});
