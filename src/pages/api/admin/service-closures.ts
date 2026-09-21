import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import {
  ambitoDiRichiesta, leggi, salva, cancella, leggiConfig, scriviConfig, type Ambito,
} from "../../../lib/admin/sede";
import { fusoDi } from "../../../lib/fuso";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

// Chiusure di servizio per giorno (admin Réservations).
// GET    ?date=YYYY-MM-DD                → { closures: [{ service_key, reason }], permanent: [key…] }
// GET    ?future=1                       → { closures: [{ date, service_key, reason }] } da oggi in poi
// POST   { date, service_key, reason }   → chiude (upsert; reason: full | closed)
// POST   { permanent_key, closed }       → chiude/riapre FINO A RIAPERTURA MANUALE
//                                          (app_config service_closures_permanent)
// DELETE ?date=&service_key=             → riapre

const K_PERM = "service_closures_permanent";

/** Lista dei service chiusi «jusqu'à réouverture» (mai bloccante).
 *  E' configurazione, quindi vive nei due strati come tutto il resto: un
 *  punto puo' tenere chiusa la sera senza chiuderla agli altri. */
async function leggiPermanenti(ambito: Ambito): Promise<string[]> {
  try {
    const { valori } = await leggiConfig(ambito, [K_PERM]);
    const arr = JSON.parse(String(valori.get(K_PERM) || "[]"));
    return Array.isArray(arr) ? arr.map(String).filter((k) => RE_KEY.test(k)) : [];
  } catch { return []; }
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_KEY = /^[a-z_]{1,30}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const ambito = await ambitoDiRichiesta(request, staff);

  // Tutte le chiusure da oggi in poi (fuso del ristorante)
  if (url.searchParams.get("future") === "1") {
    // Il fuso si legge con l'ambito, non da una copia locale: era la terza
    // lettura a mano della stessa chiave, e dal 21/09 e' anche di QUESTA sede.
    const tz = await fusoDi(ambito);
    const oggi = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    // Storico limitato a 90 giorni: le chiusure più vecchie si eliminano da
    // sole — ma solo quelle di QUESTA sede, o si farebbe pulizia in casa
    // d'altri senza che nessuno l'abbia chiesto.
    try {
      const limite = new Date(Date.parse(oggi) - 90 * 86400000).toISOString().slice(0, 10);
      await cancella("service_closures", ambito).lt("date", limite);
    } catch { /* mai bloccante */ }
    const { data, error } = await leggi("service_closures", ambito, "date, service_key, reason")
      .gte("date", oggi)
      .order("date", { ascending: true });
    if (error) return json({ closures: [], missing: true });
    return json({ closures: data ?? [] });
  }

  const date = url.searchParams.get("date") ?? "";
  if (!RE_DATA.test(date)) return json({ error: await msg("err.date") }, 400);

  const permanent = await leggiPermanenti(ambito);
  const { data, error } = await leggi("service_closures", ambito, "service_key, reason")
    .eq("date", date);
  // Tabella non ancora creata (migrazione #22): nessuna chiusura, non rotta
  if (error) return json({ closures: [], permanent, missing: true });
  return json({ closures: data ?? [], permanent });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { date?: string; service_key?: string; reason?: string; permanent_key?: string; closed?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }

  // Chiusura PERMANENTE: { permanent_key, closed: true|false }
  if (body.permanent_key !== undefined) {
    const key = String(body.permanent_key ?? "");
    if (!RE_KEY.test(key)) return json({ error: await msg("err.service") }, 400);
    const ambitoPerm = await ambitoDiRichiesta(request, staff);
    const lista = await leggiPermanenti(ambitoPerm);
    const nuova = body.closed ? [...new Set([...lista, key])] : lista.filter((k) => k !== key);
    const err = await scriviConfig(ambitoPerm, { [K_PERM]: JSON.stringify(nuova) });
    if (err) return json({ error: await msg("err.save") }, 500);
    return json({ ok: true, permanent: nuova });
  }

  const date = String(body.date ?? "");
  if (!RE_DATA.test(date)) return json({ error: await msg("err.date") }, 400);
  const key = String(body.service_key ?? "");
  if (!RE_KEY.test(key)) return json({ error: await msg("err.service") }, 400);
  const reason = body.reason === "closed" ? "closed" : "full";

  const { error } = await salva(
    "service_closures",
    await ambitoDiRichiesta(request, staff),
    { date, service_key: key, reason },
    "date,service_key",
  );
  if (error) {
    return json({ error: await msg("err.migrServiceClosures") }, 500);
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const date = url.searchParams.get("date") ?? "";
  if (!RE_DATA.test(date)) return json({ error: await msg("err.date") }, 400);
  const key = url.searchParams.get("service_key") ?? "";
  if (!RE_KEY.test(key)) return json({ error: await msg("err.service") }, 400);

  const { error } = await cancella("service_closures", await ambitoDiRichiesta(request, staff))
    .eq("date", date)
    .eq("service_key", key);
  if (error) return json({ error: await msg("err.delete") }, 500);
  return json({ ok: true });
};
