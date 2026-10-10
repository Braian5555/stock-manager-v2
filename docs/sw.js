// Retiro de la copia vieja de GitHub Pages.
// Reemplaza al service worker de la versión anterior: borra lo guardado para usar sin
// conexión, se da de baja y manda cada pestaña abierta a la app nueva en Firebase.
const NEW_APP = 'https://stock-manager-a7cf7.web.app/';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(NEW_APP);
  })());
});
