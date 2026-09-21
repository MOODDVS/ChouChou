import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggi, inserisci, cancella } from "../../../lib/admin/sede";
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

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_ORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function minOra(s: string): number {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return h * 60 + (m || 0);
}
// Fascia valida anche se scavalca la mezzanotte (close ≤ open ⇒ giorno dopo).
function fasciaValida(open: string, close: string): boolean {
  if (!RE_ORA.test(open) || !RE_ORA.test(close)) return false;
  const o = minOra(open);
  let c = minOra(close);
  if (c <= o) c += 1440;
  return c > o && c - o <= 1440;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Oggi nel fuso DI QUESTA SEDE. ⚠️ Decide se un giorno speciale e' «passato»:
 *  a cavallo della mezzanotte, il fuso sbagliato lo fa sparire dall'elenco un
 *  giorno prima — o rifiuta una data che e' ancora buona. */
function oggiISO(fuso: string): string {
  return DateTime.now().setZone(fuso).toFormat("yyyy-MM-dd");
}

// GET /api/admin/special-days — giorni speciali attuali e futuri
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // `special_days` e' «mista»: da una sede si vedono i SUOI giorni speciali E
  // quelli che valgono per tutte — Natale chiude tutti, i lavori chiudono uno.
  const ambito = await ambitoDiRichiesta(request, staff);
  const oggi = oggiISO(await fusoDi(ambito));
  let { data, error } = await leggi(
    "special_days",
    ambito,
    "id, location_id, type, date_from, date_to, lunch_open, lunch_close, dinner_open, dinner_close, note, services",
  )
    .gte("date_to", oggi)
    .order("date_from", { ascending: true });
  // Migrazione #33 non ancora lanciata: si rilegge senza la colonna services
  if (error && String(error.message ?? "").includes("services")) {
    const retry = await leggi(
      "special_days",
      ambito,
      "id, location_id, type, date_from, date_to, lunch_open, lunch_close, dinner_open, dinner_close, note",
    )
      .gte("date_to", oggi)
      .order("date_from", { ascending: true });
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (error) return json({ error: await msg("err.read") }, 500);

  return json({ days: data ?? [] });
};

// POST /api/admin/special-days — crea un giorno speciale
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: {
    type?: string;
    date_from?: string;
    date_to?: string;
    lunch_open?: string | null;
    lunch_close?: string | null;
    dinner_open?: string | null;
    dinner_close?: string | null;
    note?: string;
    services?: string[] | null;
    /** Multi-sede: «vale per tutte le sedi». Assente = solo questa. */
    tutte?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.request") }, 400);
  }

  // ⚠️ L'ambito si prende QUI, non a meta' funzione: serve gia' alla
  // validazione delle date, e `const` dichiarata dopo l'uso non e' un errore
  // di compilazione — e' un ReferenceError a runtime, dentro un ramo che
  // scatta solo con una data passata. Ci siamo gia' cascati due volte.
  const ambito = await ambitoDiRichiesta(request, staff);
  const oggi = oggiISO(await fusoDi(ambito));

  const type = body.type === "open" ? "open" : body.type === "closed" ? "closed" : null;
  if (!type) return json({ error: await msg("err.type") }, 400);

  const from = String(body.date_from ?? "");
  const to = String(body.date_to ?? from);
  if (!RE_DATA.test(from) || !RE_DATA.test(to)) {
    return json({ error: await msg("err.dates") }, 400);
  }
  if (to < from) return json({ error: await msg("err.endBeforeStart") }, 400);
  if (to < oggi) return json({ error: await msg("err.datesPast") }, 400);

  let lunch_open: string | null = null;
  let lunch_close: string | null = null;
  let dinner_open: string | null = null;
  let dinner_close: string | null = null;

  if (type === "open") {
    lunch_open = body.lunch_open ?? null;
    lunch_close = body.lunch_close ?? null;
    if (!lunch_open || !lunch_close || !fasciaValida(lunch_open, lunch_close)) {
      return json({ error: await msg("err.openHours") }, 400);
    }
    dinner_open = body.dinner_open ?? null;
    dinner_close = body.dinner_close ?? null;
    if (dinner_open || dinner_close) {
      if (!dinner_open || !dinner_close || !fasciaValida(dinner_open, dinner_close)) {
        return json({ error: await msg("err.eveningHours") }, 400);
      }
      if (lunch_close >= dinner_open) {
        return json({ error: await msg("err.lunchDinnerOverlap") }, 400);
      }
    }
  }

  // Evita sovrapposizioni con altri giorni speciali (fonte di confusione).
  // La sovrapposizione si cerca solo fra i giorni che valgono QUI: quello di
  // un'altra sede non si sovrappone a niente, e bloccarlo sarebbe un errore
  // che il ristoratore non potrebbe nemmeno capire — non vede quella riga.
  const { data: overlap, error: errOv } = await leggi("special_days", ambito, "id")
    .lte("date_from", to)
    .gte("date_to", from)
    .limit(1);
  if (errOv) return json({ error: await msg("err.check") }, 500);
  if (overlap && overlap.length > 0) {
    return json({ error: await msg("err.sdOverlap") }, 400);
  }

  // Servizi attivi (solo "ouvert"): token "key|HH:MM-HH:MM".
  // null = tutti (retro-compatibile) · [] = nessuno (solo ordini).
  let services: string[] | null = null;
  if (type === "open" && Array.isArray(body.services)) {
    services = body.services
      .map((t) => String(t))
      .filter((t) => /^[a-z_]{1,30}(\|([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d)?$/.test(t))
      .slice(0, 10);
  }

  const riga: Record<string, unknown> = {
    type,
    date_from: from,
    date_to: to,
    lunch_open,
    lunch_close,
    dinner_open,
    dinner_close,
    note: String(body.note ?? "").slice(0, 200),
  };
  if (services !== null) riga.services = services;
  // «Vale per tutte le sedi»: la scelta di chi crea. Natale chiude tutti, i
  // lavori in sala chiudono un punto solo.
  const tutte = body.tutte === true;
  let ins = await inserisci("special_days", ambito, riga, tutte);
  // Migrazione #33 non ancora lanciata: si salva senza la colonna
  if (ins.error && String(ins.error.message ?? "").includes("services")) {
    delete riga.services;
    ins = await inserisci("special_days", ambito, riga, tutte);
  }
  if (ins.error) return json({ error: await msg("err.save") }, 500);

  return json({ ok: true });
};

// DELETE /api/admin/special-days?id=... — elimina un giorno speciale
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: await msg("err.id") }, 400);

  const { error } = await cancella("special_days", await ambitoDiRichiesta(request, staff)).eq("id", id);
  if (error) return json({ error: await msg("err.delete") }, 500);

  return json({ ok: true });
};
