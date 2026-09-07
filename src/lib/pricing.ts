// Calcolo del prezzo effettivo con sconto.
// USATO SIA dal sito pubblico (db.ts) SIA dal checkout (checkout.ts):
// un solo punto di verità per non incassare mai una cifra diversa
// da quella mostrata.

export type DiscountType = "fixed" | "percent" | null;

/**
 * Prezzo effettivo in centesimi.
 * - fixed   : PREZZO PROMO finale (discount_value in centesimi,
 *             es. piatto a 14€ in promo a 12€ -> value 1200)
 * - percent : riduzione percentuale (discount_value 1-99)
 * Un prezzo promo >= prezzo pieno non ha effetto.
 */
export function prezzoEffettivo(
  priceCents: number,
  type: DiscountType | string | null | undefined,
  value: number | null | undefined
): number {
  const v = Math.round(Number(value ?? 0));
  if (!type || v <= 0) return priceCents;
  if (type === "fixed") return Math.min(priceCents, v);
  if (type === "percent") return Math.max(0, Math.round(priceCents * (1 - Math.min(v, 100) / 100)));
  return priceCents;
}

// ============================================================
// Varianti / formati di un piatto (migrazione #71)
// Punto di verità condiviso: sito pubblico, checkout e ordini admin
// devono leggere i formati e i loro prezzi ALLO STESSO MODO.
// ============================================================

export interface VarianteDb {
  key: string;
  label_i18n: Record<string, string>;
  price_cents: number; // prezzo PIENO del formato (sconto non applicato)
  /** Ordinabile online (come `orderable` sul piatto). */
  orderable: boolean;
  /** Finito adesso: resta in carta, segnalato, ma non si può ordinare. */
  sold_out: boolean;
}

/** Legge il jsonb `variants` di un piatto in una lista pulita e ordinata.
 *  Righe malformate (senza chiave o prezzo) vengono ignorate: un dato
 *  sporco nel DB non deve mai far cadere il menu o il checkout.
 *  Chiavi duplicate: vince la prima. */
export function leggiVariantiDb(raw: unknown): VarianteDb[] {
  if (!Array.isArray(raw)) return [];
  const viste = new Set<string>();
  const out: VarianteDb[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const r = v as Record<string, unknown>;
    const key = String(r.key ?? "").trim();
    const price = Math.round(Number(r.price_cents));
    if (!key || viste.has(key) || !Number.isFinite(price) || price < 0) continue;
    viste.add(key);
    const et: Record<string, string> = {};
    if (r.label_i18n && typeof r.label_i18n === "object" && !Array.isArray(r.label_i18n)) {
      for (const [l, t] of Object.entries(r.label_i18n as Record<string, unknown>)) {
        if (typeof t === "string" && t.trim()) et[l] = t.trim();
      }
    }
    out.push({
      key,
      label_i18n: et,
      price_cents: price,
      orderable: r.orderable !== false,
      sold_out: r.sold_out === true,
    });
  }
  return out;
}

/** Il piatto è venduto in formati? */
export function haVarianti(raw: unknown): boolean {
  return leggiVariantiDb(raw).length > 0;
}

/** Il formato scelto dal cliente, o null se la chiave non esiste.
 *  `soloOrdinabili` (checkout) scarta i formati non ordinabili online
 *  E quelli esauriti: sono le due ragioni per cui non si può incassare. */
export function trovaVariante(
  raw: unknown,
  key: unknown,
  soloOrdinabili = false
): VarianteDb | null {
  const k = String(key ?? "").trim();
  if (!k) return null;
  const v = leggiVariantiDb(raw).find((x) => x.key === k);
  if (!v) return null;
  if (soloOrdinabili && (!v.orderable || v.sold_out)) return null;
  return v;
}

/** Etichetta del formato nella lingua richiesta, con ripiego ordinato:
 *  lingua chiesta → lingua predefinita → prima disponibile → chiave. */
export function etichettaVariante(
  v: { key: string; label_i18n: Record<string, string> },
  lang: string,
  langDefault = "fr"
): string {
  const l = v.label_i18n ?? {};
  return l[lang] || l[langDefault] || Object.values(l)[0] || v.key;
}
