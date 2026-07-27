import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { emailChiusuraResa, annullaEmailReview, type ResaEmail } from "../../../lib/notifications";
import { assegnaTavoli } from "../../../lib/planSalle";

export const prerender = false;

// Impatto della chiusura di una SECTION (Fermeture exceptionnelle) sulle
// prenotazioni di quel giorno, e applicazione delle decisioni:
//  - move       -> sposta in un'altra section (+ auto-assegnazione tavolo se plan mode)
//  - cancel     -> annulla + email di chiusura al cliente
//  - recontact  -> marca "à recontacter" (richiamo a voce)

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Zone = { name: string; seats: number };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function leggiSezioni(): Promise<Zone[]> {
  const { data } = await supabaseAdmin
    .from("app_config").select("value").eq("key", "reservation_zones").maybeSingle();
  try {
    const raw = JSON.parse(String((data as { value?: unknown } | null)?.value ?? "[]")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((z) => ({ name: String((z as { name?: unknown }).name ?? ""), seats: Math.floor(Number((z as { seats?: unknown }).seats)) || 0 }))
      .filter((z) => z.name);
  } catch {
    return [];
  }
}

async function planModeOn(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("app_config").select("value").eq("key", "reservation_plan_mode").maybeSingle();
  return String((data as { value?: unknown } | null)?.value ?? "") === "1";
}

// GET ?date=&zone=  -> { reservations, sections, plan_mode }
export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const date = url.searchParams.get("date") ?? "";
  const zone = url.searchParams.get("zone") ?? "";
  if (!RE_DATE.test(date) || !zone) return json({ error: "Paramètres invalides" }, 400);

  const zones = await leggiSezioni();
  const { data, error } = await supabaseAdmin
    .from("reservations")
    .select("id, heure, service_key, people, zone, first_name, last_name")
    .eq("date", date)
    .eq("status", "confirmed")
    .order("heure", { ascending: true });
  if (error) return json({ error: "Lecture impossible" }, 500);
  type Row = { id: string; heure: string; service_key: string | null; people: number; zone: string | null; first_name: string; last_name: string };
  const rows = (data ?? []) as unknown as Row[];

  const affected = rows.filter((r) => r.zone === zone);
  const bookedByZone = new Map<string, number>();
  for (const r of rows) if (r.zone) bookedByZone.set(r.zone, (bookedByZone.get(r.zone) ?? 0) + (Number(r.people) || 0));

  const sections = zones
    .filter((z) => z.name !== zone)
    .map((z) => {
      const booked = bookedByZone.get(z.name) ?? 0;
      return { name: z.name, seats: z.seats, booked, free: Math.max(0, z.seats - booked) };
    });

  return json({ reservations: affected, sections, plan_mode: await planModeOn() });
};

// POST { date, zone, decisions:[{id, action:"move"|"cancel"|"recontact", toZone?}] }
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  let body: { date?: string; zone?: string; decisions?: { id?: string; action?: string; toZone?: string }[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }
  const date = String(body.date ?? "");
  if (!RE_DATE.test(date)) return json({ error: "Date invalide" }, 400);
  const decisions = Array.isArray(body.decisions) ? body.decisions : [];
  if (!decisions.length) return json({ ok: true, moved: 0, cancelled: 0, recontact: 0 });

  const ids = decisions.map((d) => String(d.id ?? "")).filter(Boolean);
  const CAMPI = "id, date, heure, service_key, people, zone, first_name, last_name, phone, email, lang, cancel_token, review_email_id";
  const { data, error } = await supabaseAdmin.from("reservations").select(CAMPI).in("id", ids);
  if (error) return json({ error: "Lecture impossible" }, 500);
  type Full = ResaEmail & { review_email_id?: string | null };
  const byId = new Map<string, Full>();
  for (const r of (data ?? []) as unknown as Full[]) byId.set(r.id, r);

  let moved = 0, cancelled = 0, recontact = 0;
  for (const d of decisions) {
    const r = byId.get(String(d.id ?? ""));
    if (!r) continue;
    if (d.action === "move" && d.toZone) {
      await supabaseAdmin.from("reservations").update({ zone: d.toZone }).eq("id", r.id);
      const combo = await assegnaTavoli({
        date: r.date,
        heure: String(r.heure).slice(0, 5),
        service_key: r.service_key,
        zone: d.toZone,
        people: Math.floor(Number(r.people)) || 1,
        excludeId: r.id,
      });
      const { error: tErr } = await supabaseAdmin.from("reservations").update({ tables: combo ? combo.ids : null }).eq("id", r.id);
      if (tErr) { /* migrazione #37 assente: si ignora */ }
      moved++;
    } else if (d.action === "cancel") {
      await supabaseAdmin.from("reservations").update({ status: "cancelled" }).eq("id", r.id);
      try { await supabaseAdmin.from("reservations").update({ tables: null }).eq("id", r.id); } catch { /* #37 assente */ }
      await emailChiusuraResa(r);
      if (r.review_email_id) await annullaEmailReview(r.review_email_id);
      cancelled++;
    } else if (d.action === "recontact") {
      const { error: rErr } = await supabaseAdmin.from("reservations").update({ recontact: true }).eq("id", r.id);
      if (rErr) { /* migrazione #43 non lanciata */ }
      recontact++;
    }
  }
  return json({ ok: true, moved, cancelled, recontact });
};
