// SpendSync service worker
// Its only job is to let the page call registration.showNotification()
// so daily reminders show up as real OS-level notifications — this is
// required on several mobile browsers (e.g. Android Chrome blocks the
// plain `new Notification()` constructor and requires a service worker).

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Tapping a notification focuses an already-open SpendSync tab, or opens one.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if ('focus' in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow('./');
        })
    );
});