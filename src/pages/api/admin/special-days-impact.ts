import type { APIRoute } from "astro";
import { ambitoDiRichiesta, leggi, aggiorna } from "../../../lib/admin/sede";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { emailChiusuraResa, annullaEmailReview, type ResaEmail } from "../../../lib/notifications";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

// Impatto di una CHIUSURA (jour spécial "fermé") sulle prenotazioni.
// GET  ?from=&to=  -> prenotazioni CONFERMATE nell'intervallo (per il modale).
// POST { from, to } -> le annulla e invia a ogni cliente l'email di chiusura.

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
// ⚠️ `location_id` nel select, altrimenti l'email di chiusura parte con i
// dati del marchio: `ambitoDiRiga(undefined)` rende SEDE_UNICA, che e' un
// ripiego giusto per un cliente a sede unica e sbagliato per un gruppo.
const CAMPI =
  "id, location_id, date, heure, service_key, people, zone, first_name, last_name, phone, email, lang, cancel_token, review_email_id";

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
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") || from;
  if (!RE_DATE.test(from) || !RE_DATE.test(to)) return json({ error: await msg("err.dates") }, 400);
  const { data, error } = await leggi("reservations", ambito, "id, date, heure, service_key, people, first_name, last_name")
    .gte("date", from)
    .lte("date", to)
    .eq("status", "confirmed")
    .order("date", { ascending: true })
    .order("heure", { ascending: true });
  if (error) return json({ error: await msg("err.read") }, 500);
  return json({ reservations: data ?? [] });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);
  let body: { from?: string; to?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.request") }, 400);
  }
  const from = String(body.from ?? "");
  const to = String(body.to || from);
  if (!RE_DATE.test(from) || !RE_DATE.test(to)) return json({ error: await msg("err.dates") }, 400);

  const { data, error } = await leggi("reservations", ambito, CAMPI)
    .gte("date", from)
    .lte("date", to)
    .eq("status", "confirmed");
  if (error) return json({ error: await msg("err.read") }, 500);
  const rows = (data ?? []) as unknown as (ResaEmail & { review_email_id?: string | null })[];
  if (!rows.length) return json({ ok: true, cancelled: 0 });

  const ids = rows.map((r) => r.id);
  const { error: upErr } = await aggiorna("reservations", ambito, { status: "cancelled" })
    .in("id", ids);
  if (upErr) return json({ error: await msg("err.cancel") }, 500);

  // Email di chiusura al cliente + stop dell'email recensione programmata (best-effort).
  await Promise.allSettled(
    rows.map(async (r) => {
      await emailChiusuraResa(r);
      if (r.review_email_id) await annullaEmailReview(r.review_email_id);
    })
  );
  return json({ ok: true, cancelled: rows.length });
};
