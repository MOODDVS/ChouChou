import { createClient } from "@supabase/supabase-js";
import { prezzoEffettivo } from "./pricing";

const SUPABASE_URL = import.meta.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = import.meta.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    "Variabili Supabase mancanti: controlla SUPABASE_URL e SUPABASE_SERVICE_KEY nel file .env"
  );
}

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// ============================================================
// Menu
// ============================================================

export interface MenuItem {
  id: string;
  category: string;
  category_order: number;
  name: string;
  description: string | null;
  description_fr: string | null;
  description_en: string | null;
  allergens: number[];
  price_cents: number; // prezzo EFFETTIVO (già scontato se applicabile)
  original_price_cents: number | null; // prezzo pieno, solo se scontato
  image_url: string | null;
  is_bestseller: boolean;
  is_vegan: boolean;
  is_spicy: boolean;
  is_suggestion: boolean;
}

export interface MenuCategoria {
  category: string;
  category_order: number;
  items: MenuItem[];
  parent?: string | null; // nome della categoria madre (null = principale)
  depth?: number; // 0 = principale, 1..3 = sotto-categoria
  root?: string; // nome della categoria di PRIMO livello (antenato radice)
}

const MENU_SELECT =
  "id, category, name, description, description_fr, description_en, allergens, price_cents, image_url, category_order, sort_order, discount_type, discount_value, discount_scope, is_bestseller, is_vegan, is_spicy, is_suggestion";

/**
 * Trasforma le righe DB (già ordinate) in categorie raggruppate.
 * `online = true` (take-away): applica TUTTI gli sconti.
 * `online = false` (vetrina): applica solo gli sconti con scope 'all'.
 */
function raggruppa(data: any[], online: boolean): MenuCategoria[] {
  const gruppi: MenuCategoria[] = [];
  const indiceCategoria = new Map<string, number>();

  for (const riga of data) {
    const applicabile = online || riga.discount_scope === "all";
    const effettivo = applicabile
      ? prezzoEffettivo(riga.price_cents, riga.discount_type, riga.discount_value)
      : riga.price_cents;
    const item: MenuItem = {
      id: riga.id,
      category: riga.category,
      category_order: riga.category_order,
      name: riga.name,
      description: riga.description,
      description_fr: riga.description_fr,
      description_en: riga.description_en,
      allergens: riga.allergens ?? [],
      price_cents: effettivo,
      original_price_cents: effettivo < riga.price_cents ? riga.price_cents : null,
      image_url: riga.image_url,
      is_bestseller: !!riga.is_bestseller,
      is_vegan: !!riga.is_vegan,
      is_spicy: !!riga.is_spicy,
      is_suggestion: !!riga.is_suggestion,
    };

    if (!indiceCategoria.has(riga.category)) {
      indiceCategoria.set(riga.category, gruppi.length);
      gruppi.push({
        category: riga.category,
        category_order: riga.category_order,
        items: [],
      });
    }
    gruppi[indiceCategoria.get(riga.category)!].items.push(item);
  }

  return gruppi;
}

/** Mappa nome-categoria -> { parent(nome) , depth } dalla tabella menu_categories.
 *  Tollerante: se parent_id/depth non sono migrate, ritorna tutto depth 0. */
async function mappaCategorie(): Promise<Map<string, { parent: string | null; depth: number }>> {
  const out = new Map<string, { parent: string | null; depth: number }>();
  try {
    let res = await supabaseAdmin.from("menu_categories").select("id, name, parent_id, depth");
    if (res.error && (String(res.error.message ?? "").includes("parent_id") || String(res.error.message ?? "").includes("depth"))) {
      res = await supabaseAdmin.from("menu_categories").select("id, name");
    }
    const righe = (res.data ?? []) as { id: string; name: string; parent_id?: string | null; depth?: number }[];
    const perId = new Map(righe.map((r) => [r.id, r]));
    for (const r of righe) {
      const parent = r.parent_id ? (perId.get(r.parent_id)?.name ?? null) : null;
      out.set(r.name, { parent, depth: Number(r.depth ?? 0) });
    }
  } catch { /* nessuna gerarchia */ }
  return out;
}

/** Aggiunge parent/depth/root a ogni categoria del menu. */
function arricchisci(gruppi: MenuCategoria[], mappa: Map<string, { parent: string | null; depth: number }>): MenuCategoria[] {
  const radiceDi = (nome: string): string => {
    let cur = nome;
    let guard = 0;
    while (guard < 12) {
      const info = mappa.get(cur);
      if (!info || !info.parent) return cur;
      cur = info.parent;
      guard++;
    }
    return cur;
  };
  for (const g of gruppi) {
    const info = mappa.get(g.category);
    g.parent = info?.parent ?? null;
    g.depth = info?.depth ?? 0;
    g.root = radiceDi(g.category);
  }
  return gruppi;
}

/** Id dei piatti da NASCONDERE dal menu pubblico perché inseriti in un
 *  lunch/formula attivo (con hide_items) e attualmente valido per data.
 *  Tollerante: se la tabella/colonna manca, ritorna un insieme vuoto. */
async function piattiNascostiDaLunch(): Promise<Set<string>> {
  const nascosti = new Set<string>();
  try {
    const { data, error } = await supabaseAdmin
      .from("lunch_menus")
      .select("items, active, date_from, date_to, hide_items");
    if (error || !data) return nascosti;
    const oggi = new Date().toISOString().slice(0, 10);
    for (const l of data as {
      items?: Record<string, unknown> | null;
      active?: boolean | null;
      date_from?: string | null;
      date_to?: string | null;
      hide_items?: boolean | null;
    }[]) {
      if (!l.hide_items || l.active === false) continue;
      if (l.date_from && oggi < l.date_from) continue;
      if (l.date_to && oggi > l.date_to) continue;
      for (const arr of Object.values(l.items ?? {})) {
        if (Array.isArray(arr)) for (const id of arr) nascosti.add(String(id));
      }
    }
  } catch { /* tabella/colonna assente: niente da nascondere */ }
  // Menù fissi (set_menus): stessa logica, portate = array { items: [] }.
  try {
    const { data, error } = await supabaseAdmin
      .from("set_menus")
      .select("courses, active, date_from, date_to, hide_items");
    if (!error && data) {
      const oggi = new Date().toISOString().slice(0, 10);
      for (const m of data as {
        courses?: { items?: unknown }[] | null;
        active?: boolean | null;
        date_from?: string | null;
        date_to?: string | null;
        hide_items?: boolean | null;
      }[]) {
        if (!m.hide_items || m.active === false) continue;
        if (m.date_from && oggi < m.date_from) continue;
        if (m.date_to && oggi > m.date_to) continue;
        for (const corso of m.courses ?? []) {
          const arr = corso?.items;
          if (Array.isArray(arr)) for (const id of arr) nascosti.add(String(id));
        }
      }
    }
  } catch { /* set_menus assente */ }
  return nascosti;
}

/**
 * Menu VETRINA: tutti i piatti disponibili (available = true).
 * Usata in /menu.
 */
export async function getMenu(): Promise<MenuCategoria[]> {
  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select(MENU_SELECT)
    .eq("available", true)
    .order("category_order", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error || !data) {
    throw new Error("Impossibile leggere il menu da Supabase");
  }
  const nascosti = await piattiNascostiDaLunch();
  const visibili = nascosti.size ? data.filter((r: { id: string }) => !nascosti.has(String(r.id))) : data;
  return arricchisci(raggruppa(visibili, false), await mappaCategorie());
}

/**
 * Menu TAKE-AWAY: solo piatti ordinabili (available = true AND orderable = true).
 * Usata in /order.
 */
export async function getMenuOrderable(): Promise<MenuCategoria[]> {
  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select(MENU_SELECT)
    .eq("available", true)
    .eq("orderable", true)
    .order("category_order", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error || !data) {
    throw new Error("Impossibile leggere il menu ordinabile da Supabase");
  }
  const nascosti = await piattiNascostiDaLunch();
  const visibili = nascosti.size ? data.filter((r: { id: string }) => !nascosti.has(String(r.id))) : data;
  return arricchisci(raggruppa(visibili, true), await mappaCategorie());
}
