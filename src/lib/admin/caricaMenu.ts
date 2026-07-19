import { supabaseAdmin } from "../db";

// Pre-carica lato server (SSR, Fase 2) i dati della pagina /admin/menu:
// categorie (con conteggio piatti, come /api/admin/categories) + piatti
// (come /api/admin/menu). Query semplici e stabili: copia leggera, gli
// endpoint restano la fonte per le mutazioni.

const MENU_SELECT =
  "id, category, category_order, sort_order, name, description_fr, description_en, image_url, allergens, price_cents, available, orderable, discount_type, discount_value, discount_scope, is_bestseller, is_vegan, is_spicy, is_suggestion";

export async function caricaMenuPagina() {
  const [catsRes, itemsRes, countRes] = await Promise.all([
    supabaseAdmin
      .from("menu_categories")
      .select("id, name, sort_order, kind")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabaseAdmin
      .from("menu_items")
      .select(MENU_SELECT)
      .order("category_order", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabaseAdmin.from("menu_items").select("category"),
  ]);

  const conteggi = new Map<string, number>();
  for (const r of countRes.data ?? []) {
    conteggi.set(r.category, (conteggi.get(r.category) ?? 0) + 1);
  }
  const categories = (catsRes.data ?? []).map((c) => ({
    ...c,
    count: conteggi.get(c.name) ?? 0,
  }));

  return { categories, items: itemsRes.data ?? [] };
}
