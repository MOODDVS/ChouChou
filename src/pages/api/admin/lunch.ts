import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

// LUNCH (tab Lunch della pagina Menu admin) — formules del mezzogiorno.
// GET          → { lunches: [...] } (missing: true se la #38 non è lanciata)
// POST         → crea { name?, courses, date_from?, date_to?, items?, combos?, active? }
// PATCH        → aggiorna { id, ...campi presenti }
// DELETE ?id=  → elimina (il client la invia come POST + X-Method-Override)

const SELECT_BASE = "id, name, courses, date_from, date_to, items, combos, active, created_at";
const SELECT = SELECT_BASE + ", name_i18n, hide_items";

/** name_i18n: { code: string } ripulito (trim, max 60), scarta vuoti. */
function pulisciI18n(v: unknown): Record<string, string> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const code = String(k).toLowerCase().slice(0, 5);
    const testo = String(val ?? "").trim().slice(0, 60);
    if (code && testo) out[code] = testo;
  }
  return out;
}

/** true se l'errore Supabase riguarda una colonna opzionale (migrazione non lanciata). */
function mancaI18n(err: { message?: string } | null): boolean {
  return !!err?.message && /name_i18n|hide_items/i.test(err.message);
}
const PORTATE = ["entree", "plat", "dessert"]; // ordine canonico
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_UUID = /^[0-9a-f-]{36}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Portate valide, dedupe, ordine canonico. "plat" è SEMPRE presente. */
function pulisciCourses(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const set = new Set((v as unknown[]).map(String).filter((c) => PORTATE.includes(c)));
  set.add("plat");
  return PORTATE.filter((c) => set.has(c));
}

/** items: { portata: [uuid…] } limitato alle portate attive (max 30 piatti l'una). */
function pulisciItems(v: unknown, courses: string[]): Record<string, string[]> | null {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string[]> = {};
  for (const c of courses) {
    const arr = (v as Record<string, unknown>)[c];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) return null;
    const ids = (arr as unknown[]).map(String).filter((id) => RE_UUID.test(id)).slice(0, 30);
    out[c] = [...new Set(ids)];
  }
  return out;
}

/** combos MANUALI: parts ⊆ portate attive (≥1), prezzo 1cent–500€, niente doppioni. */
function pulisciCombos(v: unknown, courses: string[]): { parts: string[]; price_cents: number }[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 12) return null;
  const out: { parts: string[]; price_cents: number }[] = [];
  const visti = new Set<string>();
  for (const c of v as { parts?: unknown; price_cents?: unknown }[]) {
    const set = new Set(
      (Array.isArray(c?.parts) ? (c.parts as unknown[]) : []).map(String).filter((p) => courses.includes(p))
    );
    const parts = PORTATE.filter((p) => set.has(p));
    if (!parts.length) return null;
    const chiave = parts.join("+");
    if (visti.has(chiave)) return null; // stessa combinazione due volte
    visti.add(chiave);
    const prezzo = Math.round(Number(c?.price_cents));
    if (!Number.isFinite(prezzo) || prezzo < 1 || prezzo > 50000) return null;
    out.push({ parts, price_cents: prezzo });
  }
  return out;
}

function pulisciData(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim();
  if (!s) return null; // vuoto = senza limite
  return RE_DATA.test(s) ? s : undefined;
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let { data, error } = await supabaseAdmin
    .from("lunch_menus")
    .select(SELECT)
    .order("created_at", { ascending: true });
  // Colonna name_i18n non ancora presente: riprova senza
  if (error && mancaI18n(error)) {
    ({ data, error } = await supabaseAdmin
      .from("lunch_menus")
      .select(SELECT_BASE)
      .order("created_at", { ascending: true }));
  }
  // Tabella non ancora creata (migrazione #38): tab vuoto, non rotto
  if (error) return json({ lunches: [], missing: true });
  return json({ lunches: data ?? [] });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const courses = pulisciCourses(body.courses ?? ["plat"]);
  if (!courses) return json({ error: "Portate invalides" }, 400);
  const items = pulisciItems(body.items, courses);
  if (!items) return json({ error: "Plats invalides" }, 400);
  const combos = pulisciCombos(body.combos, courses);
  if (!combos || !combos.length) return json({ error: "Ajoutez au moins une combinaison avec un prix" }, 400);
  const df = pulisciData(body.date_from);
  const dt = pulisciData(body.date_to);
  if (df === undefined || dt === undefined) return json({ error: "Dates invalides" }, 400);
  if (df && dt && df > dt) return json({ error: "La date de fin précède le début" }, 400);

  const nameI18n = pulisciI18n(body.name_i18n);
  const riga: Record<string, unknown> = {
    name: String(body.name ?? "").trim().slice(0, 60) || (courses.length === 1 ? "Plat du jour" : "Lunch"),
    courses,
    date_from: df,
    date_to: dt,
    items,
    combos,
    active: body.active === undefined ? true : Boolean(body.active),
  };
  if (nameI18n !== undefined) riga.name_i18n = nameI18n;
  if (body.hide_items !== undefined) riga.hide_items = Boolean(body.hide_items);
  let { data, error } = await supabaseAdmin.from("lunch_menus").insert(riga).select(SELECT).single();
  if (error && mancaI18n(error)) {
    delete riga.name_i18n;
    delete riga.hide_items;
    ({ data, error } = await supabaseAdmin.from("lunch_menus").insert(riga).select(SELECT_BASE).single());
  }
  if (error || !data) {
    return json({ error: "Création impossible — migration supabase/lunch_menus.sql à lancer ?" }, 500);
  }
  return json({ lunch: data }, 201);
};

export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }
  const id = String(body.id ?? "");
  if (!RE_UUID.test(id)) return json({ error: "Id invalide" }, 400);

  // Le portate servono anche per validare items/combos: se non arrivano nel
  // body si leggono dalla riga esistente.
  let courses: string[] | null = null;
  if (body.courses !== undefined) {
    courses = pulisciCourses(body.courses);
    if (!courses) return json({ error: "Portate invalides" }, 400);
  } else {
    const { data: cur } = await supabaseAdmin.from("lunch_menus").select("courses").eq("id", id).maybeSingle();
    courses = pulisciCourses(cur?.courses ?? ["plat"]) ?? ["plat"];
  }

  const campi: Record<string, unknown> = {};
  if (body.courses !== undefined) campi.courses = courses;
  if (body.name !== undefined) campi.name = String(body.name ?? "").trim().slice(0, 60) || "Lunch";
  if (body.items !== undefined) {
    const items = pulisciItems(body.items, courses);
    if (!items) return json({ error: "Plats invalides" }, 400);
    campi.items = items;
  }
  if (body.combos !== undefined) {
    const combos = pulisciCombos(body.combos, courses);
    if (!combos || !combos.length) return json({ error: "Ajoutez au moins une combinaison avec un prix" }, 400);
    campi.combos = combos;
  }
  if (body.date_from !== undefined) {
    const df = pulisciData(body.date_from);
    if (df === undefined) return json({ error: "Dates invalides" }, 400);
    campi.date_from = df;
  }
  if (body.date_to !== undefined) {
    const dt = pulisciData(body.date_to);
    if (dt === undefined) return json({ error: "Dates invalides" }, 400);
    campi.date_to = dt;
  }
  if (campi.date_from && campi.date_to && String(campi.date_from) > String(campi.date_to)) {
    return json({ error: "La date de fin précède le début" }, 400);
  }
  if (body.active !== undefined) campi.active = Boolean(body.active);
  if (body.name_i18n !== undefined) campi.name_i18n = pulisciI18n(body.name_i18n) ?? {};
  if (body.hide_items !== undefined) campi.hide_items = Boolean(body.hide_items);
  if (!Object.keys(campi).length) return json({ error: "Rien à modifier" }, 400);

  let { data, error } = await supabaseAdmin
    .from("lunch_menus")
    .update(campi)
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error && mancaI18n(error)) {
    const campiSenza = { ...campi };
    delete campiSenza.name_i18n;
    delete campiSenza.hide_items;
    ({ data, error } = await supabaseAdmin
      .from("lunch_menus")
      .update(campiSenza)
      .eq("id", id)
      .select(SELECT_BASE)
      .single());
  }
  if (error || !data) return json({ error: "Modification impossible" }, 500);
  return json({ lunch: data });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id") ?? "";
  if (!RE_UUID.test(id)) return json({ error: "Id invalide" }, 400);

  const { error } = await supabaseAdmin.from("lunch_menus").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
