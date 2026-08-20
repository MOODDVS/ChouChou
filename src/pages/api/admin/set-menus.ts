import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

// SET MENUS (tab « Menù » della pagina Menu admin) — menu à prix fixe.
// GET          → { menus: [...] } (missing: true se la tabella non è creata)
// POST         → crea { name?, name_i18n?, desc_i18n?, image_url?, courses, price_cents, wine_supplement_cents?, date_from?, date_to?, active?, hide_items?, sort_order? }
// PATCH        → aggiorna { id, ...campi presenti }
// DELETE ?id=  → elimina (il client la invia come POST + X-Method-Override)

const SELECT_BASE =
  "id, name, name_i18n, desc_i18n, image_url, courses, price_cents, wine_supplement_cents, date_from, date_to, active, hide_items, sort_order, created_at";
const SELECT = SELECT_BASE + ", is_draft";

/** true se l'errore Supabase riguarda la colonna is_draft (migrazione non lanciata). */
function mancaColonna(err: { message?: string } | null): boolean {
  return !!err?.message && /is_draft/i.test(err.message);
}
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_UUID = /^[0-9a-f-]{36}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** name_i18n / desc_i18n: { code: string } ripulito (trim, max len), scarta vuoti. */
function pulisciI18n(v: unknown, maxLen: number): Record<string, string> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const code = String(k).toLowerCase().slice(0, 5);
    const testo = String(val ?? "").trim().slice(0, maxLen);
    if (code && testo) out[code] = testo;
  }
  return out;
}

/** courses: array di { category?, name (≤60), name_i18n, mode ("and"|"choice"), items: [uuid] (≤30) }, max 12 portate. */
type Course = {
  category: string | null;
  name: string;
  name_i18n: Record<string, string>;
  mode: string;
  items: string[];
  customs: { name_i18n: Record<string, string> }[];
};
function pulisciCourses(v: unknown): Course[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 12) return null;
  const out: Course[] = [];
  for (const c of v as { category?: unknown; name?: unknown; name_i18n?: unknown; mode?: unknown; items?: unknown; customs?: unknown }[]) {
    const category = String(c?.category ?? "").trim().slice(0, 60);
    const name = String(c?.name ?? "").trim().slice(0, 60);
    const nameI18n = pulisciI18n(c?.name_i18n, 60) ?? {};
    const mode = c?.mode === "and" ? "and" : "choice";
    const arr = Array.isArray(c?.items) ? (c.items as unknown[]) : [];
    const items = [...new Set(arr.map(String).filter((id) => RE_UUID.test(id)))].slice(0, 30);
    const customsRaw = Array.isArray(c?.customs) ? (c.customs as { name_i18n?: unknown }[]) : [];
    const customs = customsRaw
      .map((cu) => ({ name_i18n: pulisciI18n(cu?.name_i18n, 2000) ?? {} }))
      .filter((cu) => Object.keys(cu.name_i18n).length)
      .slice(0, 30);
    if (!category && !name && !items.length && !customs.length) continue; // portata vuota: scarta
    out.push({ category: category || null, name: name || category || "—", name_i18n: nameI18n, mode, items, customs });
  }
  return out;
}

function pulisciData(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  const s = String(v ?? "").trim();
  if (!s) return null; // vuoto = senza limite
  return RE_DATA.test(s) ? s : undefined;
}

function pulisciCents(v: unknown, def: number | null): number | null {
  if (v === undefined || v === null || String(v).trim() === "") return def;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 500000) return def;
  return n;
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let resp: { data: unknown[] | null; error: { message?: string } | null } = await supabaseAdmin
    .from("set_menus")
    .select(SELECT)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (resp.error && mancaColonna(resp.error)) {
    resp = await supabaseAdmin
      .from("set_menus")
      .select(SELECT_BASE)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
  }
  if (resp.error) return json({ menus: [], missing: true });
  return json({ menus: resp.data ?? [] });
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

  const courses = pulisciCourses(body.courses);
  if (!courses) return json({ error: "Portate invalides" }, 400);
  const price = pulisciCents(body.price_cents, 0) ?? 0;
  const wine = pulisciCents(body.wine_supplement_cents, null);
  const df = pulisciData(body.date_from);
  const dt = pulisciData(body.date_to);
  if (df === undefined || dt === undefined) return json({ error: "Dates invalides" }, 400);
  if (df && dt && df > dt) return json({ error: "La date de fin précède le début" }, 400);

  const riga: Record<string, unknown> = {
    name: String(body.name ?? "").trim().slice(0, 60) || "Menu",
    name_i18n: pulisciI18n(body.name_i18n, 60) ?? {},
    desc_i18n: pulisciI18n(body.desc_i18n, 600) ?? {},
    image_url: body.image_url ? String(body.image_url).slice(0, 500) : null,
    courses,
    price_cents: price,
    wine_supplement_cents: wine,
    date_from: df,
    date_to: dt,
    active: body.active === undefined ? true : Boolean(body.active),
    hide_items: Boolean(body.hide_items),
    is_draft: Boolean(body.is_draft),
    sort_order: pulisciCents(body.sort_order, 0) ?? 0,
  };
  let { data, error } = await supabaseAdmin.from("set_menus").insert(riga).select(SELECT).single();
  if (error && mancaColonna(error)) {
    delete riga.is_draft;
    ({ data, error } = await supabaseAdmin.from("set_menus").insert(riga).select(SELECT_BASE).single());
  }
  if (error || !data) {
    return json({ error: error?.message ?? "Création impossible — migration supabase/set_menus.sql à lancer ?" }, 500);
  }
  return json({ menu: data }, 201);
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

  const campi: Record<string, unknown> = {};
  if (body.name !== undefined) campi.name = String(body.name ?? "").trim().slice(0, 60) || "Menu";
  if (body.name_i18n !== undefined) campi.name_i18n = pulisciI18n(body.name_i18n, 60) ?? {};
  if (body.desc_i18n !== undefined) campi.desc_i18n = pulisciI18n(body.desc_i18n, 600) ?? {};
  if (body.image_url !== undefined) campi.image_url = body.image_url ? String(body.image_url).slice(0, 500) : null;
  if (body.courses !== undefined) {
    const courses = pulisciCourses(body.courses);
    if (!courses) return json({ error: "Portate invalides" }, 400);
    campi.courses = courses;
  }
  if (body.price_cents !== undefined) campi.price_cents = pulisciCents(body.price_cents, 0) ?? 0;
  if (body.wine_supplement_cents !== undefined) campi.wine_supplement_cents = pulisciCents(body.wine_supplement_cents, null);
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
  if (body.hide_items !== undefined) campi.hide_items = Boolean(body.hide_items);
  if (body.is_draft !== undefined) campi.is_draft = Boolean(body.is_draft);
  if (body.sort_order !== undefined) campi.sort_order = pulisciCents(body.sort_order, 0) ?? 0;
  if (!Object.keys(campi).length) return json({ error: "Rien à modifier" }, 400);

  let { data, error } = await supabaseAdmin
    .from("set_menus")
    .update(campi)
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error && mancaColonna(error)) {
    const campiSenza = { ...campi };
    delete campiSenza.is_draft;
    ({ data, error } = await supabaseAdmin
      .from("set_menus")
      .update(campiSenza)
      .eq("id", id)
      .select(SELECT_BASE)
      .single());
  }
  if (error || !data) return json({ error: error?.message ?? "Modification impossible" }, 500);
  return json({ menu: data });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id") ?? "";
  if (!RE_UUID.test(id)) return json({ error: "Id invalide" }, 400);

  const { error } = await supabaseAdmin.from("set_menus").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
