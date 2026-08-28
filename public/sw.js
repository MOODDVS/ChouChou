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
  const req = event.request;
  // Intercetta SOLO le GET same-origin: le altre (POST, cross-origin verso
  // Supabase/Stripe/font, schemi non http) le gestisce il browser da solo.
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  // Passthrough alla rete, ma senza far esplodere la promise se la fetch
  // fallisce (richiesta annullata durante una navigazione, offline, ecc.):
  // il .catch evita gli "Uncaught (in promise) TypeError: Failed to fetch".
  event.respondWith(fetch(req).catch(() => Response.error()));
});

// --- Notifiche push (PWA admin) ---
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const title = d.title || "MOODD";
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
