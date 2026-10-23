// Service worker minimo — serve a Chrome (Android) per riconoscere
// l'admin come app installabile (PWA vera, non semplice scorciatoia).
// Il gestore fetch DEVE fare un lavoro reale (respondWith): Chrome
// ignora i gestori vuoti e in quel caso non propone l'installazione.
// Nessuna cache: tutte le richieste passano dritte alla rete.
self.addEventListener("install", () => {
  self.skipWaiting();
});

// VELOCITA' (23/10/2026): il «navigation preload». Senza, ogni pagina
// aspettava che il service worker si svegliasse PRIMA di partire verso il
// server (sul telefono, decine o centinaia di millisecondi a ogni tocco):
// con il preload la richiesta parte subito, in parallelo al risveglio.
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    self.registration.navigationPreload ? self.registration.navigationPreload.enable().catch(() => {}) : Promise.resolve(),
  ]));
});

self.addEventListener("fetch", (event) => {
  // Interviene SOLO sulle navigazioni: basta a Chrome per considerare l'admin
  // una PWA installabile. Tutte le altre richieste (API, asset, manifest)
  // passano dritte al browser, cosi' un endpoint che fallisce (dev server
  // spento, offline) NON genera errori ne' warning dal service worker.
  if (event.request.mode !== "navigate") return;
  event.respondWith((async () => {
    try {
      const pronta = await event.preloadResponse;
      if (pronta) return pronta;
      return await fetch(event.request);
    } catch (e) {
      return Response.error();
    }
  })());
});

// --- Notifiche push (PWA admin) ---
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const title = d.title || "RestoHub";
  const opts = {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: d.tag || undefined,
    data: { url: d.url || "/admin" },
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { try { c.navigate(url); } catch (e) {} return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
