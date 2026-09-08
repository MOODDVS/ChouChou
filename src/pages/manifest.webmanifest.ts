import type { APIRoute } from "astro";
import { caricaBootAdmin } from "../lib/admin/adminBoot";
import { CLIENT } from "../config/client";

export const prerender = false;

/**
 * MANIFEST dell'app installata (PWA), generato a runtime.
 *
 * PERCHE' NON E' PIU' UN FILE STATICO: la scelta «icona RestoHub o icona del
 * cliente» sta in app_config e la fa il super admin. Un file in `public/` non
 * la puo' leggere — e per di piu' `public/**` ha policy `merge=ours`, quindi
 * un manifest statico andrebbe toccato cliente per cliente e non si
 * propagherebbe mai.
 *
 * ⚠️ Il percorso e' /manifest.webmanifest, NON /manifest.json: i file in
 * `public/` oscurano le rotte con lo stesso percorso, e il vecchio
 * `public/manifest.json` sopravvive nei repo dei clienti proprio per via del
 * `merge=ours`. Cambiando percorso la rotta vince sempre.
 *
 * ⚠️ `id` resta "/admin" per SEMPRE: e' l'identita' dell'app per il sistema
 * operativo. Cambiarlo farebbe credere ad Android/iOS che sia un'altra app,
 * e chi l'ha gia' installata si ritroverebbe due icone.
 *
 * ⚠️ Chi ha GIA' installato l'app non vede il cambio di icona: il sistema
 * tiene quella del momento dell'installazione. Serve disinstallare e
 * reinstallare. E' scritto anche nell'interfaccia del super admin.
 */
export const GET: APIRoute = async () => {
  const boot = await caricaBootAdmin();
  const cliente = boot.pwaBrand === "client" && boot.appIcon;

  const icone = cliente
    ? [{ src: boot.appIcon as string, sizes: "512x512", type: "image/png", purpose: "any" }]
    : [
        { src: "/restohub/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/restohub/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/restohub/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      ];

  // Con il marchio del cliente anche i colori seguono il suo tema, se c'e'.
  const bg = (cliente && boot.theme.bg) || "#002f35";
  const nome = cliente ? CLIENT.nome || "RestoHub" : "RestoHub";

  const manifest = {
    id: "/admin",
    name: nome,
    short_name: nome.slice(0, 12),
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: bg,
    theme_color: bg,
    icons: icone,
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      // Corta: il super deve poter cambiare marchio e vedere l'effetto sui
      // NUOVI installi senza aspettare una cache di un giorno.
      "Cache-Control": "public, max-age=300",
    },
  });
};
