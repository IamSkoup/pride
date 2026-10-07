const CACHE = 'pride-shell-v4';
const BASE = new URL('.', self.location.href).pathname;
const SHELL = ['','offline.html','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest'].map(path => `${BASE}${path}`);
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('pride-shell-') && key !== CACHE).map(key => caches.delete(key)))), self.clients.claim()])); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(`${BASE}offline.html`)));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = { body: event.data?.text() || '' }; }
  const data = payload.data || payload;
  event.waitUntil(self.registration.showNotification(data.title || 'Pride Messenger', { body: data.body || 'Новое сообщение', icon: `${BASE}icon.svg`, data: { url: data.url || BASE }, tag: data.tag || 'pride' }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || BASE, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname.startsWith(BASE));
    if (existing) { await existing.focus(); if ('navigate' in existing) await existing.navigate(target); return; }
    await self.clients.openWindow(target);
  }));
});
