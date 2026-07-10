import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = import.meta.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    "Variabili Supabase mancanti: controlla SUPABASE_URL e SUPABASE_SERVICE_KEY nel file .env"
  );
}

// --- DIAGNOSTICA TEMPORANEA (rimuovere dopo aver risolto la connessione) ---
// Stampa, all'avvio del server, l'URL usato e il PREFISSO della service key
// (solo i primi 11 caratteri: rivela sb_secret_ vs sb_publishable_, non il segreto).
console.log("[db] SUPABASE_URL =", JSON.stringify(SUPABASE_URL));
console.log(
  "[db] SERVICE_KEY prefix =",
  String(SUPABASE_SERVICE_KEY).slice(0, 11)
);

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
  price_cents: number;
  image_url: string | null;
}

export interface MenuCategoria {
  category: string;
  category_order: number;
  items: MenuItem[];
}

const MENU_SELECT =
  "id, category, name, description, description_fr, description_en, allergens, price_cents, image_url, category_order, sort_order";

/** Trasforma le righe DB (già ordinate) in categorie raggruppate. */
function raggruppa(data: any[]): MenuCategoria[] {
  const gruppi: MenuCategoria[] = [];
  const indiceCategoria = new Map<string, number>();

  for (const riga of data) {
    const item: MenuItem = {
      id: riga.id,
      category: riga.category,
      category_order: riga.category_order,
      name: riga.name,
      description: riga.description,
      description_fr: riga.description_fr,
      description_en: riga.description_en,
      allergens: riga.allergens ?? [],
      price_cents: riga.price_cents,
      image_url: riga.image_url,
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
    // DIAGNOSTICA TEMPORANEA: stampa l'errore Supabase reale.
    console.error("[getMenu] Supabase error:", JSON.stringify(error));
    throw new Error("Impossibile leggere il menu da Supabase");
  }
  return raggruppa(data);
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
    // DIAGNOSTICA TEMPORANEA: stampa l'errore Supabase reale.
    console.error("[getMenuOrderable] Supabase error:", JSON.stringify(error));
    throw new Error("Impossibile leggere il menu ordinabile da Supabase");
  }
  return raggruppa(data);
}
