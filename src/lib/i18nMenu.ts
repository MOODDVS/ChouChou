/**
 * Testi del menu nella lingua del sito.
 *
 * Modulo SENZA dipendenze, come `pricing.ts`: viene importato anche dalle
 * isole React (OrderApp), e `db.ts` non può esserlo — crea il client Supabase
 * con la service key, che nel bundle del browser non deve finire mai.
 *
 * Regola: niente ternari a due rami sulla lingua. Il ramo `else` diventa il
 * francese per qualunque lingua futura, ed è così che /order italiana finiva
 * per dire «Épuisé» accanto a una carta che diceva «Esaurito».
 */

/** Lingua di ultimo ripiego quando manca tutto il resto. */
export const LANG_RIPIEGO = "fr";

/** Un testo vuoto o di soli spazi conta come MANCANTE: una traduzione a metà
 *  non deve coprire il testo storico. */
export function i18nPulito(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [l, t] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof t === "string" && t.trim()) out[l] = t.trim();
  }
  return out;
}

/** Forma minima di un piatto: niente import da db.ts, così il modulo resta
 *  utilizzabile sia dal server sia dal browser. */
export interface PiattoTesti {
  name: string;
  description?: string | null;
  description_fr?: string | null;
  description_en?: string | null;
  name_i18n?: Record<string, string> | null;
  desc_i18n?: Record<string, string> | null;
}

/**
 * Nome e descrizione di un piatto nella lingua richiesta.
 * Cascata: i18n[lingua] → i18n[predefinita] → colonne storiche → base.
 *
 * ⚠️ Solo per MOSTRARE. `name` resta il nome canonico: è quello che va in
 * cucina, sui ticket e nelle email. Le righe d'ordine il server le ricostruisce
 * leggendo `name` dal database, mai dal browser.
 */
export function testoPiatto(
  item: PiattoTesti,
  lang: string,
  langDefault: string = LANG_RIPIEGO
): { name: string; description: string | null } {
  const n = i18nPulito(item.name_i18n);
  const d = i18nPulito(item.desc_i18n);
  const storica = lang === "en" ? item.description_en : item.description_fr;
  return {
    name: n[lang] || n[langDefault] || item.name,
    description:
      d[lang] || d[langDefault] || storica || item.description_fr || item.description || null,
  };
}

/**
 * Etichette fisse del menu (badge e stati), nelle 5 lingue pubbliche.
 * Il cliente può sovrascriverle passando la chiave nel proprio dizionario:
 * questi sono i valori di partenza, non una gabbia.
 */
export type ChiaveEtichetta = "soldOut" | "vegan" | "spicy" | "seasonal" | "suggestion" | "confirm";

export const ETICHETTE_MENU: Record<string, Record<ChiaveEtichetta, string>> = {
  fr: { soldOut: "Épuisé", vegan: "Végan", spicy: "Épicé", seasonal: "Saisonnier", suggestion: "Suggestion", confirm: "Confirmer ?" },
  en: { soldOut: "Sold out", vegan: "Vegan", spicy: "Spicy", seasonal: "Seasonal", suggestion: "Suggestion", confirm: "Confirm?" },
  it: { soldOut: "Esaurito", vegan: "Vegano", spicy: "Piccante", seasonal: "Stagionale", suggestion: "Consigliato", confirm: "Confermare?" },
  nl: { soldOut: "Uitverkocht", vegan: "Vegan", spicy: "Pittig", seasonal: "Seizoensgebonden", suggestion: "Aanbevolen", confirm: "Bevestigen?" },
  es: { soldOut: "Agotado", vegan: "Vegano", spicy: "Picante", seasonal: "De temporada", suggestion: "Sugerencia", confirm: "¿Confirmar?" },
};

/**
 * Etichetta nella lingua della pagina.
 * Ordine: dizionario del cliente → lingua richiesta → lingua di ripiego.
 * `dizionario` è l'oggetto `t` che la pagina passa al componente: se il
 * cliente ha la sua parola, vince la sua.
 */
export function etichettaMenu(
  chiave: ChiaveEtichetta,
  lang: string,
  dizionario?: Partial<Record<ChiaveEtichetta, string>>
): string {
  const suo = dizionario?.[chiave];
  if (typeof suo === "string" && suo.trim()) return suo.trim();
  return ETICHETTE_MENU[lang]?.[chiave] || ETICHETTE_MENU[LANG_RIPIEGO][chiave];
}
