import { supabaseAdmin } from "../db";

// Pre-carica lato server (SSR, Fase 2) i dati della pagina /admin/menu:
// categorie (con conteggio piatti, come /api/admin/categories) + piatti
// (come /api/admin/menu). Query semplici e stabili: copia leggera, gli
// endpoint restano la fonte per le mutazioni.

const MENU_SELECT_BASE =
  "id, category, category_order, sort_order, name, description_fr, description_en, image_url, allergens, price_cents, available, orderable, discount_type, discount_value, discount_scope, is_bestseller, is_vegan, is_spicy, is_suggestion";
const MENU_SELECT = MENU_SELECT_BASE + ", sold_out, name_i18n, desc_i18n";

async function caricaItems(): Promise<{ data: unknown[] | null }> {
  const ordina = (sel: string) =>
    supabaseAdmin
      .from("menu_items")
      .select(sel)
      .order("category_order", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
  let res: { data: unknown[] | null; error: { message?: string } | null } = await ordina(MENU_SELECT);
  if (res.error && (String(res.error.message ?? "").includes("name_i18n") || String(res.error.message ?? "").includes("desc_i18n") || String(res.error.message ?? "").includes("sold_out"))) {
    res = await ordina(MENU_SELECT_BASE); // colonne i18n non ancora migrate
  }
  return { data: res.data };
}

async function caricaCategorie(): Promise<{ data: unknown[] | null }> {
  let res: { data: unknown[] | null; error: { message?: string } | null } = await supabaseAdmin
    .from("menu_categories")
    .select("id, name, sort_order, kind, parent_id, depth")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
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
