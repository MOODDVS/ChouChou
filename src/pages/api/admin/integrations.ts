import type { APIRoute } from "astro";
import { controllaPlaceId } from "../../../lib/admin/googleRegole";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser } from "../../../lib/admin/superAdmin";
import { serviceAccountEmail, searchConsolePronto, sitoValido } from "../../../lib/searchConsole";
import { statoGoogle } from "../../../lib/googleBusiness";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

// Integrazioni di terzi (Réglages → Integrations). SOLO super admin.
//
// GET → configurazione (staff autenticato: serve alle pagine admin)
// PUT → salvataggio (super admin)
//
// ⚠️ QUI C'ERANO LE PRENOTAZIONI ESTERNE, tolte il 01/10/2026. Si poteva
// scegliere fra widget RestoHub, link, codice incollato o niente — e NESSUNO
// leggeva quella scelta: `lib/reservationMode.ts` non era importato da nessun
// file, in nessuno dei cinque clienti. Il pannello configurava, salvava, e
// sul sito non cambiava niente.
//
// ⚠️ E il disegno era sbagliato prima ancora di essere agganciato: una chiave
// di MARCHIO con dentro dell'HTML incollato. I due clienti che usano davvero
// un fornitore esterno hanno bisogno di una cosa PER SEDE — 450 Gradi ha tre
// widget Resto-Genius, uno per pizzeria — e l'hanno risolta meglio da soli,
// con qualche riga nel loro `config/client.ts`. E' li' che va rifatta, se
// servira': una voce per sede nel config del cliente, non un campo libero
// nell'admin.
// Google Business — livello 1: Place ID (lecture seule, clé API MOODD)
//                   livello 2: OAuth (répondre aux avis, horaires) — à venir
const K_GPLACE = "google_place_id";
const K_GTOKEN = "google_oauth_refresh"; // livello 2, scritto dal futuro callback OAuth
const K_GSC_SITE = "gsc_site"; // Search Console : sc-domain:… ou https://…/
const K_NL_QUOTA = "newsletter_monthly_quota"; // Newsletter incluse/mese (super admin)
const NL_QUOTA_DEFAULT = 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function leggi(chiavi: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const { data } = await supabaseAdmin.from("app_config").select("key, value").in("key", chiavi);
    for (const r of data ?? []) out[r.key as string] = String(r.value ?? "");
  } catch {
    /* niente config */
  }
  return out;
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const c = await leggi([K_GPLACE, K_GTOKEN, K_GSC_SITE, K_NL_QUOTA]);
  // Una chiamata sola a Google per sapere se il permesso vale ancora.
  const statoG = await statoGoogle();
  return json({
    google: {
      place_id: c[K_GPLACE] ?? "",
      // ⚠️ `connected` era `Boolean(token nel database)`: diceva «collegato»
      // anche quando Google l'aveva revocato da giorni. La stringa c'e', il
      // permesso no — e finche' l'app OAuth resta in «Testing» Google li
      // revoca ogni SETTE GIORNI. Adesso si chiede a Google, e si distingue
      // «scaduto» (ricollega) da «non risponde» (riprova).
      connected: statoG === "ok",
      stato: statoG,
      // la connessione OAuth è possibile solo con le credenziali MOODD configurate
      oauth_ready: Boolean(
        (import.meta.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID) &&
        (import.meta.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET)
      ),
    },
    search_console: {
      site: c[K_GSC_SITE] ?? "",
      // la chiave del service account è pronta lato server ?
      ready: searchConsolePronto(),
      // email del robot da aggiungere in Search Console (solo super admin)
      robot: isSuperUser(staff) ? serviceAccountEmail() : "",
    },
    newsletter: {
      monthly_quota: Number.isFinite(Number(c[K_NL_QUOTA])) && c[K_NL_QUOTA] !== ""
        ? Math.max(0, Math.floor(Number(c[K_NL_QUOTA])))
        : NL_QUOTA_DEFAULT,
    },
  });
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!isSuperUser(staff)) return json({ error: await msg("err.super") }, 403);

  let body: { google_place_id?: string; gsc_site?: string; newsletter_quota?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }

  // Salvataggio PARZIALE: ogni bottone "Enregistrer" tocca solo i suoi campi.
  // Scriviamo una chiave solo se il campo è presente nel body, così salvare
  // la Search Console non azzera le prenotazioni, e viceversa.
  const upserts: { key: string; value: string }[] = [];

  // --- Google Business : Place ID ---
  // ⚠️ SOLO A SEDE UNICA, e la storia spiega perche'. Il 15/09/2026 il Place
  // ID e' passato da qui alla scheda della sede: identifica UN esercizio
  // fisico, quindi tre pizzerie sono tre Place ID, e il posto giusto e' la
  // scheda del punto. La riga che resto' qui diceva che le installazioni a
  // sede unica «continuano a funzionare senza toccare niente» — ed era vero
  // solo per chi un Place ID ce l'aveva GIA'. Un cliente a sede unica
  // configurato dopo quel giorno non ha piu' avuto NESSUN posto dove
  // metterlo: la scheda della sede, a sede unica, non esiste. Il blocco
  // Google della Accueil non compariva, e in Integrations si leggeva
  // «CONNESSO» — perche' il livello 2 (OAuth) e' un'altra cosa.
  // E' lo stesso buco che quel giorno colpi' la scelta della scheda, dove il
  // rimedio fu `#g-unica`: qui e' lo stesso, scritto nel marchio.
  // Con piu' sedi si rifiuta: li' il posto giusto c'e', ed e' la scheda.
  // ⚠️ QUESTO ENDPOINT NON SA CHE LE SEDI ESISTONO, ed e' una difesa
  // strutturale: non importa niente da `admin/sede`, quindi il selettore
  // dell'header non puo' arrivarci per nessuna strada. Percio' qui NON si
  // controlla «e' multi-sede?» — sarebbe una seconda definizione di
  // multi-sede, accanto a quella vera. A decidere dove va il Place ID e'
  // chi disegna il campo: il super admin lo mostra solo quando le sedi non
  // ci sono, e con piu' sedi si imposta nella scheda del punto. Quello che
  // si scrive qui e' il valore DEL MARCHIO, che `leggiConfig` usa come
  // ripiego — esattamente cio' che serve a un'installazione a sede unica.
  if (body.google_place_id !== undefined) {
    const pid = String(body.google_place_id).trim().slice(0, 200);
    const esito = controllaPlaceId(pid);
    if (esito === "chiave") return json({ error: await msg("itg.g.isKey") }, 400);
    if (esito === "formato") return json({ error: await msg("loc.err.placeId") }, 400);
    upserts.push({ key: K_GPLACE, value: pid });
  }

  // --- Search Console : "sc-domain:exemple.be" ou une URL https ---
  if (body.gsc_site !== undefined) {
    const gscSite = String(body.gsc_site).trim().slice(0, 300);
    // Vuoto vuol dire «togli»; per tutto il resto decide `sitoValido`, la
    // stessa regola con cui il bottone «Vérifier» accetta una proprietà.
    if (gscSite && !sitoValido(gscSite)) {
      return json({ error: await msg("err.scSite") }, 400);
    }
    upserts.push({ key: K_GSC_SITE, value: gscSite });
  }

  // --- Newsletter : quota mensile incluso (super admin) ---
  if (body.newsletter_quota !== undefined) {
    const n = Math.floor(Number(body.newsletter_quota));
    if (!Number.isFinite(n) || n < 0 || n > 1000000) {
      return json({ error: await msg("err.nlQuota") }, 400);
    }
    upserts.push({ key: K_NL_QUOTA, value: String(n) });
  }

  if (!upserts.length) return json({ error: await msg("err.nothingSave") }, 400);
  const { error } = await supabaseAdmin.from("app_config").upsert(upserts, { onConflict: "key" });
  if (error) return json({ error: await msg("err.save") }, 500);
  return json({ ok: true });
};
