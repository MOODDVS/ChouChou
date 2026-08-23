import { DateTime } from "luxon";
import { supabaseAdmin } from "../db";
import { caricaResaGiorno } from "./caricaResaGiorno";
import { caricaToday } from "./caricaToday";
import { TIMEZONE } from "../slots";

// Pre-carica lato server (SSR, Fase 2) le 5 isole principali della Accueil,
// nella STESSA forma restituita dai rispettivi endpoint /api/admin/*:
//   - orders      → { orders: [...] }      (come GET /api/admin/orders)
//   - resa        → caricaResaGiorno(oggi)  (come GET /api/admin/reservations?date=)
//   - today       → { config }             (come GET /api/admin/today)
//   - menu        → { items: [...] }        (come GET /api/admin/menu)
//   - categories  → { categories: [...] }   (come GET /api/admin/categories)
// Le statistiche restano lato client (3 chiamate), quindi NON sono qui.

const MENU_SELECT =
  "id, category, category_order, sort_order, name, description_fr, description_en, image_url, allergens, price_cents, available, orderable, discount_type, discount_value, discount_scope, is_bestseller, is_vegan, is_spicy, is_suggestion, is_seasonal";
const ORDERS_SELECT =
  "id, status, pickup_time, customer_name, customer_email, customer_phone, items, total_cents, lang, created_at";

export async function caricaHomeData() {
  const oggi = DateTime.now().setZone(TIMEZONE);
  const oggiKey = oggi.toISODate() ?? "";
  const soglia = oggi.minus({ days: 7 }).startOf("day").toISO();

  const [ordersRes, resa, todayCfg, menuRes, catsRes, itemsCount] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select(ORDERS_SELECT)
      .in("status", ["paid", "done", "cancelled"])
      .gte("pickup_time", soglia)
      .order("pickup_time", { ascending: true }),
    caricaResaGiorno(oggiKey),
    caricaToday(),
    supabaseAdmin
      .from("menu_items")
      .select(MENU_SELECT)
      .order("category_order", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabaseAdmin
      .from("menu_categories")
      .select("id, name, sort_order, kind")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabaseAdmin.from("menu_items").select("category"),
  ]);

  // Categorie con conteggio piatti (come /api/admin/categories)
  const conteggi = new Map<string, number>();
  for (const r of itemsCount.data ?? []) {
    conteggi.set(r.category, (conteggi.get(r.category) ?? 0) + 1);
  }
  const categories = (catsRes.data ?? []).map((c) => ({
    ...c,
    count: conteggi.get(c.name) ?? 0,
  }));

  return {
    orders: { orders: ordersRes.data ?? [] },
    resa,
    today: todayCfg,
    menu: { items: menuRes.data ?? [] },
    categories: { categories },
  };
}
