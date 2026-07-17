import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { TIMEZONE } from "../../../lib/slots";

export const prerender = false;

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_ORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function oggiISO(): string {
  return DateTime.now().setZone(TIMEZONE).toFormat("yyyy-MM-dd");
}

// GET /api/admin/special-days — giorni speciali attuali e futuri
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const { data, error } = await supabaseAdmin
    .from("special_days")
    .select("id, type, date_from, date_to, lunch_open, lunch_close, dinner_open, dinner_close, note")
    .gte("date_to", oggiISO())
    .order("date_from", { ascending: true });

  if (error) return json({ error: "Lecture impossible" }, 500);
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
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const type = body.type === "open" ? "open" : body.type === "closed" ? "closed" : null;
  if (!type) return json({ error: "Type invalide" }, 400);

  const from = String(body.date_from ?? "");
  const to = String(body.date_to ?? from);
  if (!RE_DATA.test(from) || !RE_DATA.test(to)) {
    return json({ error: "Dates invalides" }, 400);
  }
  if (to < from) return json({ error: "Fin avant début" }, 400);
  if (to < oggiISO()) return json({ error: "Dates déjà passées" }, 400);

  let lunch_open: string | null = null;
  let lunch_close: string | null = null;
  let dinner_open: string | null = null;
  let dinner_close: string | null = null;

  if (type === "open") {
    lunch_open = body.lunch_open ?? null;
    lunch_close = body.lunch_close ?? null;
    if (!lunch_open || !lunch_close || !RE_ORA.test(lunch_open) || !RE_ORA.test(lunch_close) || lunch_open >= lunch_close) {
      return json({ error: "Heures d'ouverture invalides" }, 400);
    }
    dinner_open = body.dinner_open ?? null;
    dinner_close = body.dinner_close ?? null;
    if (dinner_open || dinner_close) {
      if (!dinner_open || !dinner_close || !RE_ORA.test(dinner_open) || !RE_ORA.test(dinner_close) || dinner_open >= dinner_close) {
        return json({ error: "Heures du soir invalides" }, 400);
      }
      if (lunch_close >= dinner_open) {
        return json({ error: "Midi et Soir se chevauchent" }, 400);
      }
    }
  }

  // Evita sovrapposizioni con altri giorni speciali (fonte di confusione).
  const { data: overlap, error: errOv } = await supabaseAdmin
    .from("special_days")
    .select("id")
    .lte("date_from", to)
    .gte("date_to", from)
    .limit(1);
  if (errOv) return json({ error: "Vérification impossible" }, 500);
  if (overlap && overlap.length > 0) {
    return json({ error: "Chevauchement avec un jour spécial existant" }, 400);
  }

  const { error } = await supabaseAdmin.from("special_days").insert({
    type,
    date_from: from,
    date_to: to,
    lunch_open,
    lunch_close,
    dinner_open,
    dinner_close,
    note: String(body.note ?? "").slice(0, 200),
  });
  if (error) return json({ error: "Enregistrement impossible" }, 500);

  return json({ ok: true });
};

// DELETE /api/admin/special-days?id=... — elimina un giorno speciale
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  const { error } = await supabaseAdmin.from("special_days").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);

  return json({ ok: true });
};
