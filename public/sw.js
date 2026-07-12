// Service worker minimo — serve a Chrome (Android) per riconoscere
// l'admin come app installabile (PWA vera, non semplice scorciatoia).
// Il gestore fetch DEVE fare un lavoro reale (respondWith): Chrome
// ignora i gestori vuoti e in quel caso non propone l'installazione.
// Nessuna cache: tutte le richieste passano dritte alla rete.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
