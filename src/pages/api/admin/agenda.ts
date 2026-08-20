import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

// CRUD degli eventi/agenda del ristorante (admin RestoHub → Agenda).
// GET    → elenco (data crescente)
// POST   → crea
// PUT    → aggiorna (id obbligatorio; toggle rapido { id, active })
// DELETE → elimina (?id=…) — via middleware anche POST + X-Method-Override

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

interface LinkExt {
  label: string;
  url: string;
}

interface EventoInput {
  id?: string;
  title?: string;
  body?: string;
  image_url?: string;
  gallery?: unknown;
  date_start?: string;
  date_end?: string | null;
  links?: unknown;
  rsvp?: boolean;
  active?: boolean;
  title_i18n?: Record<string, string> | null;
  body_i18n?: Record<string, string> | null;
  body_long_i18n?: Record<string, string> | null;
  rsvp_max?: number | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const urlOk = (u: string) => /^https?:\/\//.test(u) || u.startsWith("/") || u.startsWith("#");

/** Galleria: array di URL immagine (http/https), max 24. */
function pulisciGallery(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    const u = String(v ?? "").trim();
    if (/^https?:\/\//.test(u) && !out.includes(u)) out.push(u);
    if (out.length >= 24) break;
  }
  return out;
}

/** Link esterni: array di { label, url }, url valido, max 12. */
function pulisciLinks(input: unknown): LinkExt[] {
  if (!Array.isArray(input)) return [];
  const out: LinkExt[] = [];
  for (const r of input) {
    const riga = r as Record<string, unknown> | null;
    const url = String(riga?.url ?? "").trim();
    if (!url || !urlOk(url)) continue;
    const label = String(riga?.label ?? "").trim().slice(0, 80) || url;
    out.push({ label, url });
    if (out.length >= 12) break;
  }
  return out;
}

/** name_i18n / body_i18n: { code: string } ripulito (trim, max len), scarta vuoti. */
function pulisciI18n(v: unknown, maxLen: number): Record<string, string> {
  if (v === undefined || v === null || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const code = String(k).toLowerCase().slice(0, 5);
    const testo = String(val ?? "").trim().slice(0, maxLen);
    if (code && testo) out[code] = testo;
  }
  return out;
}
function mancaI18n(err: { message?: string } | null): boolean {
  return !!err?.message && /title_i18n|body_i18n|body_long_i18n|rsvp_max/i.test(err.message);
}

/** Valida e normalizza i campi di un evento. */
function valida(b: EventoInput): { errore?: string; valori?: Record<string, unknown> } {
  const title = (b.title ?? "").trim();
  if (!title) return { errore: "Le titre est obligatoire" };

  const date_start = (b.date_start ?? "").trim();
  if (!RE_DATA.test(date_start)) return { errore: "Date de début obligatoire" };

  let date_end: string | null = (b.date_end ?? "")?.toString().trim() || null;
  if (date_end !== null) {
    if (!RE_DATA.test(date_end)) return { errore: "Date de fin invalide" };
    if (date_end < date_start) return { errore: "La date de fin précède le début" };
    if (date_end === date_start) date_end = null; // un solo giorno
  }

  return {
    valori: {
      title: title.slice(0, 160),
      body: (b.body ?? "").trim() || null,
      image_url: (b.image_url ?? "").trim() || null,
      gallery: pulisciGallery(b.gallery),
      date_start,
      date_end,
      links: pulisciLinks(b.links),
      rsvp: b.rsvp === true,
      active: b.active !== false,
      title_i18n: pulisciI18n(b.title_i18n, 160),
      body_i18n: pulisciI18n(b.body_i18n, 2000),
      body_long_i18n: pulisciI18n(b.body_long_i18n, 6000),
      rsvp_max: typeof b.rsvp_max === "number" && Number.isFinite(b.rsvp_max) && b.rsvp_max > 0 && b.rsvp_max <= 100000 ? Math.floor(b.rsvp_max) : null,
    },
  };
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const { data, error } = await supabaseAdmin
    .from("agenda_events")
    .select("*")
    .order("date_start", { ascending: true });
  if (error) return json({ error: "Lecture impossible" }, 500);
  return json({ events: data ?? [] });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: EventoInput;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const v = valida(body);
  if (v.errore) return json({ error: v.errore }, 400);

  let ins = await supabaseAdmin.from("agenda_events").insert(v.valori!).select("id").single();
  if (ins.error && mancaI18n(ins.error)) {
    const senza = { ...v.valori! };
    delete senza.title_i18n;
    delete senza.body_i18n;
    delete senza.body_long_i18n;
    delete senza.rsvp_max;
    ins = await supabaseAdmin.from("agenda_events").insert(senza).select("id").single();
  }
  if (ins.error || !ins.data) return json({ error: "Enregistrement impossible" }, 500);
  return json({ ok: true, id: ins.data.id }, 201);
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: EventoInput;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  if (!body.id) return json({ error: "id manquant" }, 400);

  // Toggle rapido pubblicato/bozza: solo { id, active }
  if (body.title === undefined && typeof body.active === "boolean") {
    const { error } = await supabaseAdmin
      .from("agenda_events")
      .update({ active: body.active })
      .eq("id", body.id);
    if (error) return json({ error: "Enregistrement impossible" }, 500);
    return json({ ok: true });
  }

  const v = valida(body);
  if (v.errore) return json({ error: v.errore }, 400);

  let upd = (await supabaseAdmin.from("agenda_events").update(v.valori!).eq("id", body.id)).error;
  if (upd && mancaI18n(upd)) {
    const senza = { ...v.valori! };
    delete senza.title_i18n;
    delete senza.body_i18n;
    delete senza.body_long_i18n;
    delete senza.rsvp_max;
    upd = (await supabaseAdmin.from("agenda_events").update(senza).eq("id", body.id)).error;
  }
  if (upd) return json({ error: "Enregistrement impossible" }, 500);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id manquant" }, 400);

  const { error } = await supabaseAdmin.from("agenda_events").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
