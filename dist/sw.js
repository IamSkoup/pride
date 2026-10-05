const CACHE = 'pride-shell-v3';
const SHELL = ['/', '/offline.html', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
self.addEventListener('push', event => {
  const payload = event.data?.json() || {};
  const data = payload.data || payload;
  event.waitUntil(self.registration.showNotification(data.title || 'Pride Messenger', { body: data.body || 'Новое сообщение', icon: '/icon.svg', data: { url: data.url || '/' }, tag: data.tag || 'pride' }));
});
self.addEventListener('notificationclick', event => { event.notification.close(); event.waitUntil(self.clients.openWindow(event.notification.data?.url || '/')); });
