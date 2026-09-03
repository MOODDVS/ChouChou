/**
 * CATALOGO PRINT (MOODD) — prodotti fisici stampabili on-demand che il
 * ristorante ordina a MOODD (menu, e in futuro business cards, set de
 * table, flyer…). STEP 1: solo definizione + prezzi, gestiti dal super
 * admin nella pagina /admin/super (onglet « Print »).
 *
 * ARCHITETTURA: ogni cliente ha il SUO database. Non esiste un default
 * condiviso a livello DB. Quindi:
 *   - PRINT_DEFAULTS  = il « seed » consigliato, vive nel codice e viaggia
 *                       in ogni deployment (uguale per tutti i clienti).
 *   - app_config.print_catalog = i valori REALI di QUESTO cliente (JSON),
 *                       scritti solo dal super admin. Se assenti, si usano
 *                       i default. Nessun « merge »: o eredita il seed, o
 *                       ha il suo listino.
 *
 * PREZZI: in centesimi (come price_cents ovunque nel progetto), riferiti
 * al LOTTO (non al singolo pezzo), SENZA IVA (MOODD fattura da Dubai il
 * servizio di gestione senza IVA).
 *
 * NB: gli ORDINI (step 3) NON staranno qui — avranno una tabella dedicata
 * (print_orders) con lo snapshot del PDF. Qui vive solo la configurazione.
 */

export interface PrintTier {
  /** Quantità del lotto (numero di copie), intero > 0. */
  qty: number;
  /** Prezzo del lotto in centesimi, intero >= 0, senza IVA. */
  price_cents: number;
}

/** Caratteristiche fisse (etichette tradotte in admin.ts, valori liberi). */
export interface PrintMeta {
  /** Formato, es. "A3 plié en A4". */
  format?: string;
  /** Numero di pagine, es. "4". */
  pages?: string;
  /** Carta / grammatura, es. "170 g/m²". */
  paper?: string;
  /** Colore, es. "Quadrichromie". */
  color?: string;
}

export interface PrintProduct {
  /** Id stabile usato negli URL, non cambia mai (es. "menu"). */
  slug: string;
  /** Nome mostrato (es. "Menu"). */
  label: string;
  /** Pagina che genera il PDF di questo prodotto (es. "/print/menu"). */
  route: string;
  /** Mostrato o no nella (futura) pagina Print del cliente. */
  visible: boolean;
  /** Caratteristiche mostrate sulla card (formato, pagine, carta, colore). */
  meta: PrintMeta;
  /** Fasce di quantità con prezzo del lotto. */
  tiers: PrintTier[];
}

/** Chiavi meta ammesse (fisse). */
export const PRINT_META_KEYS = ["format", "pages", "paper", "color"] as const;
export type PrintMetaKey = (typeof PRINT_META_KEYS)[number];

/** Chiave in app_config che contiene il catalogo (JSON) del cliente. */
export const K_PRINT_CATALOG = "print_catalog";

/**
 * Seed consigliato MOODD. `visible: false` di default: un nuovo cliente
 * ha il prodotto definito ma nascosto finché il super admin non mette i
 * prezzi giusti e accende lo switch.
 */
export const PRINT_DEFAULTS: PrintProduct[] = [
  {
    slug: "menu",
    label: "Menu",
    route: "/print/menu",
    visible: false,
    meta: { format: "A3 plié en A4", pages: "4", paper: "170 g/m²", color: "Quadrichromie" },
    tiers: [
      { qty: 25, price_cents: 9000 },
      { qty: 50, price_cents: 15000 },
      { qty: 75, price_cents: 20000 },
      { qty: 100, price_cents: 24000 },
    ],
  },
  {
    slug: "business-cards",
    label: "Cartes de visite",
    route: "/print/businesscard",
    visible: false,
    meta: { format: "85 × 55 mm", pages: "2 (recto-verso)", paper: "350 g/m²", color: "Quadrichromie" },
    tiers: [
      { qty: 100, price_cents: 4000 },
      { qty: 250, price_cents: 6000 },
      { qty: 500, price_cents: 9000 },
      { qty: 1000, price_cents: 14000 },
    ],
  },
];

const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const MAX_PRODUCTS = 50;
const MAX_TIERS = 20;
const MAX_CENTS = 100_000_00; // 100 000 € per lotto: tetto di sicurezza

function toInt(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : NaN;
}

/** Ordina e ripulisce le fasce: qty intero > 0, prezzo intero valido, per qty crescente, senza duplicati di qty. */
function normalizzaTiers(raw: unknown): PrintTier[] {
  if (!Array.isArray(raw)) return [];
  const viste = new Set<number>();
  const out: PrintTier[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const qty = toInt((t as any).qty);
    const price = toInt((t as any).price_cents);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!Number.isFinite(price) || price < 0) continue;
    if (viste.has(qty)) continue;
    viste.add(qty);
    out.push({ qty, price_cents: Math.min(price, MAX_CENTS) });
  }
  out.sort((a, b) => a.qty - b.qty);
  return out.slice(0, MAX_TIERS);
}

/** Ripulisce le caratteristiche: solo chiavi note, stringhe trimmate (max 60). */
function normalizzaMeta(raw: unknown): PrintMeta {
  const out: PrintMeta = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of PRINT_META_KEYS) {
    const v = String((raw as any)[k] ?? "").trim().slice(0, 60);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * Normalizza un catalogo qualunque (da DB o da body API) in una forma
 * sicura. Non lancia mai: scarta ciò che non è valido.
 */
export function normalizzaCatalogo(raw: unknown): PrintProduct[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const slugVisti = new Set<string>();
  const out: PrintProduct[] = [];
  for (const p of arr) {
    if (!p || typeof p !== "object") continue;
    const slug = String((p as any).slug ?? "").trim().toLowerCase();
    if (!SLUG_RE.test(slug) || slugVisti.has(slug)) continue;
    slugVisti.add(slug);
    const label = String((p as any).label ?? slug).trim().slice(0, 80) || slug;
    const route = String((p as any).route ?? "").trim().slice(0, 120);
    out.push({
      slug,
      label,
      route: /^\//.test(route) ? route : "",
      visible: Boolean((p as any).visible),
      meta: normalizzaMeta((p as any).meta),
      tiers: normalizzaTiers((p as any).tiers),
    });
  }
  return out.slice(0, MAX_PRODUCTS);
}

/**
 * Valida un catalogo in arrivo dall'API (PUT). Ritorna il catalogo
 * ripulito, oppure un messaggio d'errore leggibile per il super admin.
 */
export function validaCatalogo(raw: unknown): { catalog?: PrintProduct[]; error?: string } {
  if (!Array.isArray(raw)) return { error: "Catalogue invalide." };
  const pulito = normalizzaCatalogo(raw);
  for (const p of pulito) {
    if (p.visible && p.tiers.length === 0) {
      return { error: `« ${p.label} » est visible mais n'a aucune quantité. Ajoute au moins un tarif ou masque le produit.` };
    }
  }
  return { catalog: pulito };
}
