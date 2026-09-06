import { createClient } from "@supabase/supabase-js";
import { prezzoEffettivo, leggiVariantiDb, haVarianti, type DiscountType } from "./pricing";

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

/** Un formato del piatto (pizza 30/40 cm, calice/bottiglia, porzione).
 *  I formati sono mutuamente esclusivi: il cliente ne sceglie UNO.
 *  `key` è l'identificatore stabile che viaggia negli ordini. */
export interface Variante {
  key: string;
  label_i18n: Record<string, string>;
  price_cents: number; // prezzo EFFETTIVO del formato (sconto già applicato)
  original_price_cents: number | null; // pieno, solo se scontato
  orderable: boolean;
  /** Finito adesso: si vede in carta, segnalato, ma non si ordina. */
  sold_out: boolean;
}

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
  is_seasonal: boolean;
  /** Piatto segnalato «esaurito»: resta in carta ma non è ordinabile. */
  is_sold_out: boolean;
  /** Formati del piatto. Vuoto = prezzo unico (comportamento storico).
   *  Se pieno, `price_cents` è il prezzo «a partire da» (il più basso). */
  variants: Variante[];
}

export interface MenuCategoria {
  category: string;
  category_order: number;
  items: MenuItem[];
  parent?: string | null; // nome della categoria madre (null = principale)
  depth?: number; // 0 = principale, 1..3 = sotto-categoria
  root?: string; // nome della categoria di PRIMO livello (antenato radice)
  name_i18n?: Record<string, string> | null; // traduzioni del nome sezione
  root_i18n?: Record<string, string> | null; // traduzioni del nome della radice
}

const MENU_SELECT =
  "id, category, name, description, description_fr, description_en, allergens, price_cents, image_url, category_order, sort_order, discount_type, discount_value, discount_scope, is_bestseller, is_vegan, is_spicy, is_suggestion, is_seasonal";
/** Colonne aggiunte da migrazioni successive: su un cliente che non le ha
 *  ancora lanciate la select fallisce, e si riprova senza QUELLA colonna. */
export const MENU_COLONNE_NUOVE = ["sold_out", "variants"];

export type RisultatoQuery = { data: any[] | null; error: { message?: string } | null };

/**
 * Esegue una query su menu_items togliendo, una alla volta, le colonne
 * opzionali che QUEL database non conosce ancora (migrazione non lanciata).
 * Meglio perdere una colonna che far cadere il menu o un ordine.
 * Condivisa da sito pubblico, checkout e ordini dello staff.
 */
export async function conRipiegoColonne(
  campiBase: string,
  esegui: (campi: string) => Promise<RisultatoQuery>
): Promise<RisultatoQuery> {
  const escluse = new Set<string>();
  let ultimo: RisultatoQuery = { data: null, error: { message: "" } };
  for (let giro = 0; giro <= MENU_COLONNE_NUOVE.length; giro++) {
    const campi = [campiBase, ...MENU_COLONNE_NUOVE.filter((c) => !escluse.has(c))].join(", ");
    ultimo = await esegui(campi);
    const msg = String(ultimo.error?.message ?? "");
    const colpevole = ultimo.error ? MENU_COLONNE_NUOVE.find((c) => !escluse.has(c) && msg.includes(c)) : undefined;
    if (!colpevole) return ultimo;
    escluse.add(colpevole);
  }
  return ultimo;
}

/**
 * Trasforma le righe DB (già ordinate) in categorie raggruppate.
 * `online = true` (take-away): applica TUTTI gli sconti.
 * `online = false` (vetrina): applica solo gli sconti con scope 'all'.
 */
/** Normalizza il jsonb `variants` in array tipizzato per il sito, applicando
 *  lo sconto del piatto a ogni formato. La lettura grezza sta in pricing.ts
 *  (stessa funzione usata dal checkout: un solo punto di verità).
 *  `soloOrdinabili` scarta i formati non ordinabili (menu take-away). */
function leggiVarianti(
  raw: unknown,
  applicabile: boolean,
  type: unknown,
  value: unknown,
  soloOrdinabili: boolean
): Variante[] {
  return leggiVariantiDb(raw)
    .filter((v) => !soloOrdinabili || v.orderable)
    .map((v) => {
      const eff = applicabile
        ? prezzoEffettivo(v.price_cents, type as DiscountType, value as number | null)
        : v.price_cents;
      return {
        key: v.key,
        label_i18n: v.label_i18n,
        price_cents: eff,
        original_price_cents: eff < v.price_cents ? v.price_cents : null,
        orderable: v.orderable,
        sold_out: v.sold_out,
      };
    });
}

function raggruppa(data: any[], online: boolean): MenuCategoria[] {
  const gruppi: MenuCategoria[] = [];
  const indiceCategoria = new Map<string, number>();

  for (const riga of data) {
    const applicabile = online || riga.discount_scope === "all";
    const varianti = leggiVarianti(riga.variants, applicabile, riga.discount_type, riga.discount_value, online);
    // Un piatto con formati, ma nessun formato ordinabile, sparisce dal
    // menu take-away (come un piatto con orderable = false).
    if (online && haVarianti(riga.variants) && varianti.length === 0) continue;
    const base = applicabile
      ? prezzoEffettivo(riga.price_cents, riga.discount_type, riga.discount_value)
      : riga.price_cents;
    // Con i formati il prezzo mostrato è il più basso («à partir de»).
    // «à partir de»: si guarda ai formati ancora disponibili; se sono tutti
    // esauriti si ripiega su tutti, così un prezzo si vede comunque.
    const perPrezzo = varianti.filter((v) => !v.sold_out);
    const daPrezzare = perPrezzo.length ? perPrezzo : varianti;
    const effettivo = daPrezzare.length ? Math.min(...daPrezzare.map((v) => v.price_cents)) : base;
    const pienoRiferimento = daPrezzare.length
      ? (daPrezzare.find((v) => v.price_cents === effettivo)?.original_price_cents ?? null)
      : (effettivo < riga.price_cents ? riga.price_cents : null);
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
      original_price_cents: pienoRiferimento,
      image_url: riga.image_url,
      is_bestseller: !!riga.is_bestseller,
      is_vegan: !!riga.is_vegan,
      is_spicy: !!riga.is_spicy,
      is_suggestion: !!riga.is_suggestion,
      is_seasonal: !!riga.is_seasonal,
      is_sold_out: !!riga.sold_out,
      variants: varianti,
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
async function mappaCategorie(): Promise<Map<string, { parent: string | null; depth: number; name_i18n: Record<string, string> | null }>> {
  const out = new Map<string, { parent: string | null; depth: number; name_i18n: Record<string, string> | null }>();
  try {
    let res = await supabaseAdmin.from("menu_categories").select("id, name, parent_id, depth, name_i18n");
    if (res.error && String(res.error.message ?? "").includes("name_i18n")) {
      res = await supabaseAdmin.from("menu_categories").select("id, name, parent_id, depth");
    }
    if (res.error && (String(res.error.message ?? "").includes("parent_id") || String(res.error.message ?? "").includes("depth"))) {
      res = await supabaseAdmin.from("menu_categories").select("id, name");
    }
    const righe = (res.data ?? []) as { id: string; name: string; parent_id?: string | null; depth?: number; name_i18n?: Record<string, string> | null }[];
    const perId = new Map(righe.map((r) => [r.id, r]));
    for (const r of righe) {
      const parent = r.parent_id ? (perId.get(r.parent_id)?.name ?? null) : null;
      out.set(r.name, { parent, depth: Number(r.depth ?? 0), name_i18n: r.name_i18n ?? null });
    }
  } catch { /* nessuna gerarchia */ }
  return out;
}

/** Aggiunge parent/depth/root a ogni categoria del menu. */
function arricchisci(gruppi: MenuCategoria[], mappa: Map<string, { parent: string | null; depth: number; name_i18n: Record<string, string> | null }>): MenuCategoria[] {
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
    g.name_i18n = info?.name_i18n ?? null;
    g.root = radiceDi(g.category);
    g.root_i18n = mappa.get(g.root)?.name_i18n ?? null;
  }
  return gruppi;
}

/** Id dei piatti da NASCONDERE dal menu pubblico perché inseriti in un
 *  lunch/formula attivo (con hide_items) e attualmente valido per data.
 *  Tollerante: se la tabella/colonna manca, ritorna un insieme vuoto. */
async function piattiNascostiDaLunch(): Promise<Set<string>> {
  const nascosti = new Set<string>();
  try {
    // Prova con hide_by_course (nascondi per portata); se la colonna non esiste
    // ancora, ricade sul vecchio select con solo hide_items (flag globale).
    let sel = await supabaseAdmin
      .from("lunch_menus")
      .select("items, active, date_from, date_to, hide_items, hide_by_course");
    if (sel.error) {
      sel = await supabaseAdmin
        .from("lunch_menus")
        .select("items, active, date_from, date_to, hide_items");
    }
    const { data, error } = sel;
    if (error || !data) return nascosti;
    const oggi = new Date().toISOString().slice(0, 10);
    for (const l of data as {
      items?: Record<string, unknown> | null;
      active?: boolean | null;
      date_from?: string | null;
      date_to?: string | null;
      hide_items?: boolean | null;
      hide_by_course?: Record<string, boolean> | null;
    }[]) {
      if (l.active === false) continue;
      if (l.date_from && oggi < l.date_from) continue;
      if (l.date_to && oggi > l.date_to) continue;
      const hbc = l.hide_by_course;
      if (hbc && typeof hbc === "object" && !Array.isArray(hbc)) {
        // Per portata: nascondi solo le portate col flag attivo.
        for (const [portata, arr] of Object.entries(l.items ?? {})) {
          if (!hbc[portata]) continue;
          if (Array.isArray(arr)) for (const id of arr) nascosti.add(String(id));
        }
      } else if (l.hide_items) {
        // Retrocompat: vecchio flag globale → nasconde tutte le portate.
        for (const arr of Object.values(l.items ?? {})) {
          if (Array.isArray(arr)) for (const id of arr) nascosti.add(String(id));
        }
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
        courses?: { items?: unknown; hide?: boolean | null }[] | null;
        active?: boolean | null;
        date_from?: string | null;
        date_to?: string | null;
        hide_items?: boolean | null;
      }[]) {
        if (m.active === false) continue;
        if (m.date_from && oggi < m.date_from) continue;
        if (m.date_to && oggi > m.date_to) continue;
        const corsi = m.courses ?? [];
        // Nuovo modello: flag "hide" per singola portata. Retrocompat: se
        // nessuna portata ha il flag ma è attivo il vecchio hide_items globale,
        // nasconde i piatti di tutte le portate.
        const perCorso = corsi.some((c) => typeof c?.hide === "boolean");
        for (const corso of corsi) {
          const nascondi = perCorso ? corso?.hide === true : m.hide_items === true;
          if (!nascondi) continue;
          const arr = corso?.items;
          if (Array.isArray(arr)) for (const id of arr) nascosti.add(String(id));
        }
      }
    }
  } catch { /* set_menus assente */ }
  return nascosti;
}

/** Legge i piatti dal DB. Se la colonna `variants` non esiste ancora
 *  (migrazione #71 non lanciata su quel cliente) ripiega sulla select senza,
 *  così il sito continua a funzionare col prezzo unico. */
type RisultatoPiatti = { data: any[] | null; error: { message?: string } | null };

async function leggiPiatti(soloOrdinabili: boolean): Promise<RisultatoPiatti> {
  // La lista di colonne è una variabile (serve per il ripiego), quindi
  // supabase-js non può inferire la forma della riga: si tipizza a mano.
  const query = async (campi: string): Promise<RisultatoPiatti> => {
    let q = supabaseAdmin.from("menu_items").select(campi).eq("available", true);
    if (soloOrdinabili) q = q.eq("orderable", true);
    return (await q
      .order("category_order", { ascending: true })
      .order("sort_order", { ascending: true })) as unknown as RisultatoPiatti;
  };
  return await conRipiegoColonne(MENU_SELECT, query);
}

/**
 * Menu VETRINA: tutti i piatti disponibili (available = true).
 * Usata in /menu.
 */
export async function getMenu(): Promise<MenuCategoria[]> {
  const { data, error } = await leggiPiatti(false);
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
  const { data, error } = await leggiPiatti(true);
  if (error || !data) {
    throw new Error("Impossibile leggere il menu ordinabile da Supabase");
  }
  const nascosti = await piattiNascostiDaLunch();
  const visibili = nascosti.size ? data.filter((r: { id: string }) => !nascosti.has(String(r.id))) : data;
  return arricchisci(raggruppa(visibili, true), await mappaCategorie());
}
