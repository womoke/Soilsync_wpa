const CACHE_NAME = 'soilsync-shell-v2'
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icons.svg', './favicon.svg']

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
    )
})

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) =>
            Promise.all(
                cacheNames
                    .filter((cacheName) => cacheName !== CACHE_NAME)
                    .map((cacheName) => caches.delete(cacheName)),
            ),
        ),
    )
    self.clients.claim()
})

self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url)
    if (
        event.request.method !== 'GET' ||
        requestUrl.origin !== self.location.origin ||
        requestUrl.pathname.startsWith('/api/')
    ) {
        return
    }

    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    if (networkResponse.ok) {
                        const responseClone = networkResponse.clone()
                        caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', responseClone))
                    }
                    return networkResponse
                })
                .catch(() => caches.match('./index.html')),
        )
        return
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse
            }

            return fetch(event.request)
                .then((networkResponse) => {
                    if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                        return networkResponse
                    }

                    if (['script', 'style', 'image', 'font'].includes(event.request.destination)) {
                        const responseClone = networkResponse.clone()
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone))
                    }
                    return networkResponse
                })
                .catch(() => caches.match('./index.html'))
        }),
    )
})
