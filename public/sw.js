// Service worker minimo — serve a Chrome (Android) per riconoscere
// l'admin come app installabile (PWA vera, non semplice scorciatoia).
// Nessuna cache: tutte le richieste passano dritte alla rete.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Gestore volutamente vuoto: presente solo per l'installabilità.
});
