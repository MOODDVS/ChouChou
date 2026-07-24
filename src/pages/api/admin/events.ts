import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

// Eventi LOCALI del ristorante (festa del quartiere, brocante, ricorrenze
// del locale...): promemoria mostrati nella tile "Jours spéciaux" della
// Accueil accanto alle feste ufficiali. Nessun effetto su orari o widget.
// Salvati in app_config "custom_events" come JSON:
//   [{ date: "YYYY-MM-DD", label: string, yearly: boolean }]
// yearly = si ripete ogni anno alla stessa data.
// GET → { events } · PUT { events } → sostituisce la lista (max 100)

const CHIAVE = "custom_events";
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

interface Evento {
  date: string;
  label: string;
  yearly: boolean;
}

/** Lista validata dal body; null se il formato non torna. */
function pulisci(input: unknown): Evento[] | null {
  if (!Array.isArray(input) || input.length > 100) return null;
  const out: Evento[] = [];
  for (const r of input) {
    const riga = r as Record<string, unknown> | null;
    const date = String(riga?.date ?? "");
    const label = String(riga?.label ?? "").trim().slice(0, 80);
    if (!RE_DATA.test(date) || !label) return null;
    out.push({ date, label, yearly: riga?.yearly === true });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", CHIAVE)
      .maybeSingle();
    const events = pulisci(JSON.parse(data?.value ?? "[]")) ?? [];
    return json({ events });
  } catch {
    return json({ events: [] });
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { events?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }
  const events = pulisci(body.events);
  if (events === null) return json({ error: "Liste invalide" }, 400);

  const { error } = await supabaseAdmin
    .from("app_config")
    .upsert({ key: CHIAVE, value: JSON.stringify(events) }, { onConflict: "key" });
  if (error) return json({ error: "Enregistrement impossible" }, 500);

  return json({ ok: true, events });
};
