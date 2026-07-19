import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

// Chiusure di SECTION per giorno (admin Réservations).
// GET    ?date=YYYY-MM-DD          → { closures: [{ zone, reason }] }
// GET    ?future=1                 → { closures: [{ date, zone, reason }] } da oggi in poi
// POST   { date, zone, reason }    → chiude (upsert; reason: full | closed)
// DELETE ?date=&zone=              → riapre

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
      await supabaseAdmin.from("zone_closures").delete().lt("date", limite);
    } catch { /* mai bloccante */ }
    const { data, error } = await supabaseAdmin
      .from("zone_closures")
      .select("date, zone, reason")
      .gte("date", oggi)
      .order("date", { ascending: true });
    if (error) return json({ closures: [], missing: true });
    return json({ closures: data ?? [] });
  }

  const date = url.searchParams.get("date") ?? "";
  if (!RE_DATA.test(date)) return json({ error: "Date invalide" }, 400);

  const { data, error } = await supabaseAdmin.from("zone_closures").select("zone, reason").eq("date", date);
  // Tabella non ancora creata (migrazione #23): nessuna chiusura, non rotta
  if (error) return json({ closures: [], missing: true });
  return json({ closures: data ?? [] });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { date?: string; zone?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  const date = String(body.date ?? "");
  if (!RE_DATA.test(date)) return json({ error: "Date invalide" }, 400);
  const zone = String(body.zone ?? "").trim();
  if (!zone || zone.length > 60) return json({ error: "Section invalide" }, 400);
  const reason = body.reason === "full" ? "full" : "closed";

  const { error } = await supabaseAdmin
    .from("zone_closures")
    .upsert({ date, zone, reason }, { onConflict: "date,zone" });
  if (error) {
    return json({ error: "Enregistrement impossible — migration supabase/zone_closures.sql à lancer ?" }, 500);
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const date = url.searchParams.get("date") ?? "";
  if (!RE_DATA.test(date)) return json({ error: "Date invalide" }, 400);
  const zone = (url.searchParams.get("zone") ?? "").trim();
  if (!zone) return json({ error: "Section invalide" }, 400);

  const { error } = await supabaseAdmin.from("zone_closures").delete().eq("date", date).eq("zone", zone);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
