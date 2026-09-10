import { supabaseAdmin } from "../db";

// Pre-carica lato server (SSR, Fase 2) i dati della pagina /admin/menu:
// categorie (con conteggio piatti, come /api/admin/categories) + piatti
// (come /api/admin/menu). Query semplici e stabili: copia leggera, gli
// endpoint restano la fonte per le mutazioni.

const MENU_SELECT_BASE =
  "id, category, category_order, sort_order, name, description_fr, description_en, image_url, allergens, price_cents, available, orderable, discount_type, discount_value, discount_scope, is_bestseller, is_vegan, is_spicy, is_suggestion, is_seasonal";
// ⚠️ Questa lista DEVE restare allineata a COLONNE_NUOVE in
// `api/admin/menu.ts`. Ci mancava `variants`, e siccome questa e' la lettura
// SSR (quella del PRIMO caricamento della pagina), le varianti salvate
// sparivano a ogni reload: c'erano nel database, c'erano nella risposta
// dell'API dopo il salvataggio, ma non nei dati con cui la pagina nasce.
const MENU_COLONNE_NUOVE = ["sold_out", "name_i18n", "desc_i18n", "variants"];
const MENU_SELECT = MENU_SELECT_BASE + ", " + MENU_COLONNE_NUOVE.join(", ");

async function caricaItems(): Promise<{ data: unknown[] | null }> {
  const ordina = (sel: string) =>
    supabaseAdmin
      .from("menu_items")
      .select(sel)
      .order("category_order", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
  let res: { data: unknown[] | null; error: { message?: string } | null } = await ordina(MENU_SELECT);
  // Su un cliente indietro con le migrazioni si toglie SOLO la colonna che
  // manca, non tutte: prima bastava una colonna assente per perdere anche le
  // altre tre. (Stesso ripiego di `conRipiego` in api/admin/menu.ts.)
  const escluse = new Set<string>();
  for (let giro = 0; giro < MENU_COLONNE_NUOVE.length && res.error; giro++) {
    const msg = String(res.error.message ?? "");
    const colpevole = MENU_COLONNE_NUOVE.find((c) => !escluse.has(c) && msg.includes(c));
    if (!colpevole) break;
    escluse.add(colpevole);
    const sel = [MENU_SELECT_BASE, ...MENU_COLONNE_NUOVE.filter((c) => !escluse.has(c))].join(", ");
    res = await ordina(sel);
  }
  return { data: res.data };
}

async function caricaCategorie(): Promise<{ data: unknown[] | null }> {
  let res: { data: unknown[] | null; error: { message?: string } | null } = await supabaseAdmin
    .from("menu_categories")
    .select("id, name, sort_order, kind, parent_id, depth, name_i18n")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (res.error && String(res.error.message ?? "").includes("name_i18n")) {
    res = await supabaseAdmin
      .from("menu_categories")
      .select("id, name, sort_order, kind, parent_id, depth")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
  }
  if (res.error && (String(res.error.message ?? "").includes("parent_id") || String(res.error.message ?? "").includes("depth"))) {
    res = await supabaseAdmin
      .from("menu_categories")
      .select("id, name, sort_order, kind")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
  }
  return { data: res.data };
}

export async function caricaMenuPagina() {
  const [catsRes, itemsRes, countRes] = await Promise.all([
    caricaCategorie(),
    caricaItems(),
    supabaseAdmin.from("menu_items").select("category"),
  ]);

  const conteggi = new Map<string, number>();
  for (const r of countRes.data ?? []) {
    conteggi.set(r.category, (conteggi.get(r.category) ?? 0) + 1);
  }
  const categories = ((catsRes.data ?? []) as { name?: string }[]).map((c) => ({
    ...c,
    count: conteggi.get(String(c.name ?? "")) ?? 0,
  }));

  return { categories, items: itemsRes.data ?? [] };
}
