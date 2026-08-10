/* Service worker for the studio console: shows "someone just booked" alerts on the phone. */

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Mizuki Flora', body: event.data.text() }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Mizuki Flora', {
      body: payload.body || '',
      icon: '/admin/icon-192.png',
      badge: '/admin/icon-192.png',
      // Collapses repeat alerts for the same booking into one line rather than a stack.
      tag: payload.tag || 'mizuki-booking',
      data: { url: payload.url || '/admin/calendar' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/admin/calendar'

  // Focus the console if it is already open rather than piling up tabs.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('/admin') && 'focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
