import type { APIRoute } from "astro";
import { invalidaAppConfig } from "../../../lib/appConfigCache";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import {
  ambitoDiRichiesta, leggi, salva, cancella, leggiConfig, scriviConfig, type Ambito,
} from "../../../lib/admin/sede";
import { aggiornaTimezone } from "../../../lib/slots";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

// Chiusure di SECTION per giorno (admin Réservations).
// GET    ?date=YYYY-MM-DD          → { closures: [{ zone, reason }], permanent: [zone…] }
// GET    ?future=1                 → { closures: [{ date, zone, reason }] } da oggi in poi
// POST   { date, zone, reason }    → chiude (upsert; reason: full | closed)
// POST   { permanent_zone, closed }→ chiude/riapre FINO A RIAPERTURA MANUALE
//                                    (app_config zone_closures_permanent)
// DELETE ?date=&zone=              → riapre

const K_PERM = "zone_closures_permanent";

/** Lista delle sections chiuse «jusqu'à réouverture» (mai bloccante).
 *  Configurazione, quindi per sede: le sale sono di quel punto. */
async function leggiPermanenti(ambito: Ambito): Promise<string[]> {
  try {
    const { valori } = await leggiConfig(ambito, [K_PERM]);
    const arr = JSON.parse(String(valori.get(K_PERM) || "[]"));
    return Array.isArray(arr) ? arr.map((z) => String(z).trim()).filter((z) => z && z.length <= 60) : [];
  } catch { return []; }
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

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
    const tz = await aggiornaTimezone();
    const oggi = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    // Storico a 90 giorni, ma solo di QUESTA sede: vedi service-closures.
    try {
      const limite = new Date(Date.parse(oggi) - 90 * 86400000).toISOString().slice(0, 10);
      await cancella("zone_closures", ambito).lt("date", limite);
    } catch { /* mai bloccante */ }
    const { data, error } = await leggi("zone_closures", ambito, "date, zone, reason")
      .gte("date", oggi)
      .order("date", { ascending: true });
    if (error) return json({ closures: [], missing: true });
    return json({ closures: data ?? [] });
  }

  const date = url.searchParams.get("date") ?? "";
  if (!RE_DATA.test(date)) return json({ error: await msg("err.date") }, 400);

  const permanent = await leggiPermanenti(ambito);
  const { data, error } = await leggi("zone_closures", ambito, "zone, reason").eq("date", date);
  // Tabella non ancora creata (migrazione #23): nessuna chiusura, non rotta
  if (error) return json({ closures: [], permanent, missing: true });
  return json({ closures: data ?? [], permanent });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { date?: string; zone?: string; reason?: string; permanent_zone?: string; closed?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.body") }, 400);
  }

  // Chiusura PERMANENTE: { permanent_zone, closed: true|false }
  if (body.permanent_zone !== undefined) {
    const zona = String(body.permanent_zone ?? "").trim().slice(0, 60);
    if (!zona) return json({ error: await msg("err.section") }, 400);
    const ambitoPerm = await ambitoDiRichiesta(request, staff);
    const lista = await leggiPermanenti(ambitoPerm);
    const nuova = body.closed ? [...new Set([...lista, zona])] : lista.filter((z) => z !== zona);
    const err = await scriviConfig(ambitoPerm, { [K_PERM]: JSON.stringify(nuova) });
    if (err) return json({ error: await msg("err.save") }, 500);
    invalidaAppConfig();
    return json({ ok: true, permanent: nuova });
  }
  const date = String(body.date ?? "");
  if (!RE_DATA.test(date)) return json({ error: await msg("err.date") }, 400);
  const zone = String(body.zone ?? "").trim();
  if (!zone || zone.length > 60) return json({ error: await msg("err.section") }, 400);
  const reason = body.reason === "full" ? "full" : "closed";

  const { error } = await salva(
    "zone_closures",
    await ambitoDiRichiesta(request, staff),
    { date, zone, reason },
    "date,zone",
  );
  if (error) {
    return json({ error: await msg("err.migrZoneClosures") }, 500);
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const date = url.searchParams.get("date") ?? "";
  if (!RE_DATA.test(date)) return json({ error: await msg("err.date") }, 400);
  const zone = (url.searchParams.get("zone") ?? "").trim();
  if (!zone) return json({ error: await msg("err.section") }, 400);

  const { error } = await cancella("zone_closures", await ambitoDiRichiesta(request, staff))
    .eq("date", date)
    .eq("zone", zone);
  if (error) return json({ error: await msg("err.delete") }, 500);
  return json({ ok: true });
};
