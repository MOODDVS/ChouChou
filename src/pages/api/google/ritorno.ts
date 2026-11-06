import type { APIRoute } from "astro";
import { destinazioneRitorno } from "../../../lib/googleBusiness";

export const prerender = false;

// IL RITORNO UNICO DA GOOGLE (6/11/2026) — vedi `lib/googleRitorno.ts`.
//
// Google torna QUI per tutti i siti (l'unico indirizzo registrato nella sua
// console: https://app.restohub.cloud/api/google/ritorno). Questa pagina non
// scambia il codice e non salva niente: legge dallo `state` il sito che ha
// chiesto il collegamento e ci rimanda il browser, con `code`, `state` ed
// eventuale `error` cosi' come sono. Il sito poi fa tutto da se'
// (`/api/google/callback`), come prima.
//
// ⚠️ Rimanda SOLO se lo `state` e' firmato con il segreto dell'app Google di
// MOODD: senza, nessuno puo' usarla per spedire un codice a un sito suo.

const SENZA_CACHE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export const GET: APIRoute = async ({ url }) => {
  const dove = destinazioneRitorno(url.searchParams.get("state") ?? "");
  if (!dove) {
    return new Response("Lien Google invalide ou expiré. Recommence depuis l'admin (Intégrations → Google Business).", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...SENZA_CACHE },
    });
  }
  const avanti = new URL(dove);
  for (const k of ["code", "state", "error"]) {
    const v = url.searchParams.get(k);
    if (v) avanti.searchParams.set(k, v);
  }
  return new Response(null, { status: 302, headers: { Location: avanti.toString(), ...SENZA_CACHE } });
};
