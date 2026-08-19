import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";

export const prerender = false;

const SELECT_BASE =
  "id, category, category_order, sort_order, name, description_fr, description_en, image_url, allergens, price_cents, available, orderable, discount_type, discount_value, discount_scope, is_bestseller, is_vegan, is_spicy, is_suggestion";
const SELECT = SELECT_BASE + ", sold_out, name_i18n, desc_i18n";

// Lingue del sito pubblico supportate (traduzioni piatti). Vedi superAdmin.ts.
const LANG_CODES = ["fr", "en", "it", "nl", "es"];
/** Ripulisce un oggetto { lang: testo } tenendo solo codici noti e testi non vuoti. */
function pulisciI18n(raw: unknown, max: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const code of LANG_CODES) {
      const v = String(r[code] ?? "").trim();
      if (v) out[code] = v.slice(0, max);
    }
  }
  return out;
}
/** Errore Postgres dovuto alle colonne nuove non ancora migrate. */
function mancaI18n(msg: string): boolean {
  return msg.includes("name_i18n") || msg.includes("desc_i18n") || msg.includes("sold_out");
}

/** Ordine della sezione (menu_categories); null se la sezione non esiste. */
async function ordineCategoria(nome: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("menu_categories")
    .select("sort_order")
    .eq("name", nome)
    .maybeSingle();
  return data ? data.sort_order : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Valida i campi di un piatto in arrivo dall'admin.
 * `parziale = true` (PUT): valida solo i campi presenti.
 * Ritorna { errore } oppure { campi } pronti per il DB.
 */
function validaCampi(
  body: Record<string, unknown>,
  parziale: boolean
): { errore?: string; campi?: Record<string, unknown> } {
  const campi: Record<string, unknown> = {};

  if (!parziale || "name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) return { errore: "Nom requis" };
    campi.name = name.slice(0, 120);
  }
  if (!parziale || "category" in body) {
    const cat = String(body.category ?? "").trim();
    if (!cat) return { errore: "Catégorie requise" };
    campi.category = cat.slice(0, 60);
  }
  if (!parziale || "price_cents" in body) {
    const n = Math.round(Number(body.price_cents));
    if (!Number.isFinite(n) || n < 0 || n > 100000) return { errore: "Prix invalide" };
    campi.price_cents = n;
  }
  if ("category_order" in body) {
    const n = Math.floor(Number(body.category_order));
    if (!Number.isFinite(n) || n < 0 || n > 999) return { errore: "Ordre catégorie invalide" };
    campi.category_order = n;
  }
  if ("sort_order" in body) {
    const n = Math.floor(Number(body.sort_order));
    if (!Number.isFinite(n) || n < 0 || n > 9999) return { errore: "Position invalide" };
    campi.sort_order = n;
  }
  if ("description_fr" in body) {
    const v = String(body.description_fr ?? "").trim();
    campi.description_fr = v ? v.slice(0, 500) : null;
  }
  if ("description_en" in body) {
    const v = String(body.description_en ?? "").trim();
    campi.description_en = v ? v.slice(0, 500) : null;
  }
  if ("name_i18n" in body) {
    campi.name_i18n = pulisciI18n(body.name_i18n, 120);
  }
  if ("desc_i18n" in body) {
    const d = pulisciI18n(body.desc_i18n, 500);
    campi.desc_i18n = d;
    // Allinea le colonne legacy (menu pubblico attuale FR/EN)
    campi.description_fr = d.fr ?? null;
    campi.description_en = d.en ?? null;
  }
  if ("image_url" in body) {
    const v = String(body.image_url ?? "").trim();
    if (v && !/^https:\/\/\S+$/i.test(v)) return { errore: "Photo invalide" };
    campi.image_url = v ? v.slice(0, 500) : null;
  }
  if ("allergens" in body) {
    const arr = body.allergens;
    if (!Array.isArray(arr)) return { errore: "Allergènes invalides" };
    const puliti = [...new Set(arr.map((x) => Math.floor(Number(x))))];
    if (puliti.some((n) => !Number.isFinite(n) || n < 1 || n > 14)) {
      return { errore: "Allergènes invalides (1–14)" };
    }
    campi.allergens = puliti.sort((a, b) => a - b);
  }
  if ("available" in body) campi.available = !!body.available;
  if ("orderable" in body) campi.orderable = !!body.orderable;

  // --- Badge (best-seller / végan / épicé) ---
  if ("is_bestseller" in body) campi.is_bestseller = !!body.is_bestseller;
  if ("is_vegan" in body) campi.is_vegan = !!body.is_vegan;
  if ("is_spicy" in body) campi.is_spicy = !!body.is_spicy;
  if ("is_suggestion" in body) campi.is_suggestion = !!body.is_suggestion;
  if ("sold_out" in body) campi.sold_out = !!body.sold_out;

  // --- Sconto ---
  if ("discount_type" in body) {
    const t = body.discount_type;
    if (t !== null && t !== "" && t !== "fixed" && t !== "percent") {
      return { errore: "Type de réduction invalide" };
    }
    campi.discount_type = t === "fixed" || t === "percent" ? t : null;
  }
  if ("discount_value" in body) {
    const v = Math.round(Number(body.discount_value));
    if (!Number.isFinite(v) || v < 0 || v > 100000) return { errore: "Valeur de réduction invalide" };
    campi.discount_value = v;
  }
  if ("discount_scope" in body) {
    if (body.discount_scope !== "all" && body.discount_scope !== "online") {
      return { errore: "Application de la réduction invalide" };
    }
    campi.discount_scope = body.discount_scope;
  }
  // Coerenza: percentuale sensata; senza tipo, valore a zero
  if (campi.discount_type === "percent" && Number(campi.discount_value ?? 0) > 99) {
    return { errore: "Pourcentage invalide (1–99)" };
  }
  if ("discount_type" in campi && campi.discount_type === null) {
    campi.discount_value = 0;
  }

  return { campi };
}

// GET /api/admin/menu — TUTTI i piatti (anche nascosti), ordinati
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const ordina = (sel: string) =>
    supabaseAdmin
      .from("menu_items")
      .select(sel)
      .order("category_order", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
  let res: { data: unknown[] | null; error: { message?: string } | null } = await ordina(SELECT);
  if (res.error && mancaI18n(res.error.message ?? "")) {
    res = await ordina(SELECT_BASE);
  }
  if (res.error) return json({ error: "Lecture impossible" }, 500);
  return json({ items: res.data ?? [] });
};

// POST /api/admin/menu — crea un piatto
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const { errore, campi } = validaCampi(body, false);
  if (errore) return json({ error: errore }, 400);
  if (!campi) return json({ error: "Requête invalide" }, 400);

  // Default sensati se non forniti
  if (!("available" in campi)) campi.available = true;
  if (!("orderable" in campi)) campi.orderable = true;
  if (!("allergens" in campi)) campi.allergens = [];
  if (!("sort_order" in campi)) campi.sort_order = 0;

  // La sezione deve esistere; l'ordine viene dal registro sezioni
  const ord = await ordineCategoria(campi.category as string);
  if (ord === null) return json({ error: "Section inconnue" }, 400);
  campi.category_order = ord;

  let res: { data: unknown; error: { message?: string } | null } = await supabaseAdmin
    .from("menu_items")
    .insert(campi)
    .select(SELECT)
    .single();
  if (res.error && mancaI18n(res.error.message ?? "")) {
    delete campi.name_i18n;
    delete campi.desc_i18n;
    delete campi.sold_out;
    res = await supabaseAdmin.from("menu_items").insert(campi).select(SELECT_BASE).single();
  }
  if (res.error || !res.data) return json({ error: "Création impossible" }, 500);
  return json({ item: res.data });
};

// PUT /api/admin/menu — aggiorna un piatto (campi parziali ammessi)
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  const { errore, campi } = validaCampi(body, true);
  if (errore) return json({ error: errore }, 400);
  if (!campi || Object.keys(campi).length === 0) {
    return json({ error: "Rien à modifier" }, 400);
  }

  if ("category" in campi) {
    const ord = await ordineCategoria(campi.category as string);
    if (ord === null) return json({ error: "Section inconnue" }, 400);
    campi.category_order = ord;
  }

  let res: { data: unknown; error: { message?: string } | null } = await supabaseAdmin
    .from("menu_items")
    .update(campi)
    .eq("id", id)
    .select(SELECT)
    .single();
  if (res.error && mancaI18n(res.error.message ?? "")) {
    delete campi.name_i18n;
    delete campi.desc_i18n;
    delete campi.sold_out;
    res = await supabaseAdmin.from("menu_items").update(campi).eq("id", id).select(SELECT_BASE).single();
  }
  if (res.error || !res.data) return json({ error: "Modification impossible" }, 500);
  return json({ item: res.data });
};

// PATCH /api/admin/menu — riordina i piatti di UNA sezione (drag & drop).
// body: { category: string, order: [id, id, ...] } nell'ordine desiderato.
export const PATCH: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { category?: string; order?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }
  const category = String(body.category ?? "").trim();
  const order = body.order;
  if (!category) return json({ error: "Section requise" }, 400);
  if (!Array.isArray(order) || order.length === 0) return json({ error: "Ordre requis" }, 400);
  if (order.some((id) => !/^[0-9a-f-]{36}$/i.test(String(id)))) return json({ error: "Id invalide" }, 400);
  if (new Set(order).size !== order.length) return json({ error: "Doublons dans l'ordre" }, 400);

  // L'ordine deve contenere ESATTAMENTE i piatti della sezione
  const { data: righe, error: errItems } = await supabaseAdmin
    .from("menu_items")
    .select("id")
    .eq("category", category);
  if (errItems || !righe) return json({ error: "Lecture impossible" }, 500);
  const attuali = new Set(righe.map((r) => r.id));
  if (order.length !== attuali.size || order.some((id) => !attuali.has(id))) {
    return json({ error: "Liste incomplète" }, 400);
  }

  for (let i = 0; i < order.length; i++) {
    const { error } = await supabaseAdmin
      .from("menu_items")
      .update({ sort_order: i + 1 })
      .eq("id", order[i]);
    if (error) return json({ error: "Enregistrement impossible" }, 500);
  }
  return json({ ok: true });
};

// DELETE /api/admin/menu?id=... — elimina un piatto
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Id invalide" }, 400);

  const { error } = await supabaseAdmin.from("menu_items").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);

  return json({ ok: true });
};
