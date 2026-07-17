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

// Handles a real push message arriving from the SpendSync push server —
// this is what makes the notification appear even if the app is fully closed.
self.addEventListener('push', (event) => {
  let data = { title: 'SpendSync', body: "Don't forget to log today's spends!" };
  if (event.data) {
    try { data = event.data.json(); }
    catch (e) { data.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'SpendSync', {
      body: data.body,
      icon: 'logo.png',
      badge: 'logo.png',
      tag: 'ss-daily-reminder',
      renotify: true
    })
  );
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