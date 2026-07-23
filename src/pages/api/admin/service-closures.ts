import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

// Chiusure di servizio per giorno (admin Réservations).
// GET    ?date=YYYY-MM-DD                → { closures: [{ service_key, reason }], permanent: [key…] }
// GET    ?future=1                       → { closures: [{ date, service_key, reason }] } da oggi in poi
// POST   { date, service_key, reason }   → chiude (upsert; reason: full | closed)
// POST   { permanent_key, closed }       → chiude/riapre FINO A RIAPERTURA MANUALE
//                                          (app_config service_closures_permanent)
// DELETE ?date=&service_key=             → riapre

/** Lista dei service chiusi «jusqu'à réouverture» (app_config, mai bloccante). */
async function leggiPermanenti(): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin.from("app_config").select("value").eq("key", "service_closures_permanent").maybeSingle();
    const arr = JSON.parse(String(data?.value || "[]"));
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

  // Tutte le chiusure da oggi in poi (fuso del ristorante)
  if (url.searchParams.get("future") === "1") {
    let tz = "Europe/Brussels";
    try {
      const { data: cfg } = await supabaseAdmin.from("app_config").select("value").eq("key", "timezone").single();
      const v = String(cfg?.value ?? "");
      if (v) {
        new Intl.DateTimeFormat("en", { timeZone: v });
        tz = v;
      }
    } catch { /* default */ }
    const oggi = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    // Storico limitato a 90 giorni: le chiusure più vecchie si eliminano da sole
    try {
      const limite = new Date(Date.parse(oggi) - 90 * 86400000).toISOString().slice(0, 10);
      await supabaseAdmin.from("service_closures").delete().lt("date", limite);
    } catch { /* mai bloccante */ }
    const { data, error } = await supabaseAdmin
      .from("service_closures")
      .select("date, service_key, reason")
      .gte("date", oggi)
      .order("date", { ascending: true });
    if (error) return json({ closures: [], missing: true });
    return json({ closures: data ?? [] });
  }

  const date = url.searchParams.get("date") ?? "";
  if (!RE_DATA.test(date)) return json({ error: "Date invalide" }, 400);

  const permanent = await leggiPermanenti();
  const { data, error } = await supabaseAdmin
    .from("service_closures")
    .select("service_key, reason")
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
    return json({ error: "Corps invalide" }, 400);
  }

  // Chiusura PERMANENTE: { permanent_key, closed: true|false }
  if (body.permanent_key !== undefined) {
    const key = String(body.permanent_key ?? "");
    if (!RE_KEY.test(key)) return json({ error: "Service invalide" }, 400);
    const lista = await leggiPermanenti();
    const nuova = body.closed ? [...new Set([...lista, key])] : lista.filter((k) => k !== key);
    const { error } = await supabaseAdmin
      .from("app_config")
      .upsert({ key: "service_closures_permanent", value: JSON.stringify(nuova) }, { onConflict: "key" });
    if (error) return json({ error: "Enregistrement impossible" }, 500);
    return json({ ok: true, permanent: nuova });
  }

  const date = String(body.date ?? "");
  if (!RE_DATA.test(date)) return json({ error: "Date invalide" }, 400);
  const key = String(body.service_key ?? "");
  if (!RE_KEY.test(key)) return json({ error: "Service invalide" }, 400);
  const reason = body.reason === "closed" ? "closed" : "full";

  const { error } = await supabaseAdmin
    .from("service_closures")
    .upsert({ date, service_key: key, reason }, { onConflict: "date,service_key" });
  if (error) {
    return json({ error: "Enregistrement impossible — migration supabase/service_closures.sql à lancer ?" }, 500);
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const date = url.searchParams.get("date") ?? "";
  if (!RE_DATA.test(date)) return json({ error: "Date invalide" }, 400);
  const key = url.searchParams.get("service_key") ?? "";
  if (!RE_KEY.test(key)) return json({ error: "Service invalide" }, 400);

  const { error } = await supabaseAdmin.from("service_closures").delete().eq("date", date).eq("service_key", key);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
