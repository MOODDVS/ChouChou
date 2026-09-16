import { DateTime } from "luxon";
import { caricaResaGiorno } from "./caricaResaGiorno";
import { caricaToday } from "./caricaToday";
import { leggi, type Ambito } from "./sede";
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
// La tile Menu della Accueil elenca anche i piatti ESAURITI, quindi qui serve
// `sold_out`. E' una colonna arrivata con una migrazione: su un cliente che non
// l'ha ancora lanciata la query fallirebbe INTERA e la home resterebbe senza
// dati. Quindi si prova con, e si ripiega senza.
const MENU_SELECT_HOME = MENU_SELECT + ", sold_out";

function menuOrdinato(sel: string, ambito: Ambito) {
  return leggi("menu_items", ambito, sel)
    .order("category_order", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
}

async function caricaMenuHome(ambito: Ambito): Promise<{ data: unknown[] | null }> {
  const res = await menuOrdinato(MENU_SELECT_HOME, ambito);
  if (!res.error) return { data: res.data as unknown[] | null };
  return { data: (await menuOrdinato(MENU_SELECT, ambito)).data as unknown[] | null };
}
const ORDERS_SELECT =
  "id, status, pickup_time, customer_name, customer_email, customer_phone, items, total_cents, lang, created_at";

export async function caricaHomeData(ambito: Ambito) {
  const oggi = DateTime.now().setZone(TIMEZONE);
  const oggiKey = oggi.toISODate() ?? "";
  const soglia = oggi.minus({ days: 7 }).startOf("day").toISO();

  const [ordersRes, resa, todayCfg, menuRes, catsRes, itemsCount] = await Promise.all([
    leggi("orders", ambito, ORDERS_SELECT)
      .in("status", ["paid", "done", "cancelled"])
      .gte("pickup_time", soglia)
      .order("pickup_time", { ascending: true }),
    caricaResaGiorno(oggiKey, ambito),
    caricaToday(ambito),
    caricaMenuHome(ambito),
    // ⚠️ `leggi` anche qui, non `supabaseAdmin.from`. Le sezioni del menu
    // sono del MARCHIO, quindi il filtro non c'e' e il risultato e' identico:
    // il punto e' che si vede a colpo d'occhio che la decisione e' stata
    // presa, invece di dover andare a controllare la classificazione. Una
    // lettura nuda accanto a cinque filtrate sembra una dimenticanza, e un
    // giorno qualcuno la "sistema" nel verso sbagliato.
    leggi("menu_categories", ambito, "id, name, sort_order, kind")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    leggi("menu_items", ambito, "category"),
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
