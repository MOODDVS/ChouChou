/**
 * IL PREFISSO DI LINGUA NEGLI URL DEL SITO PUBBLICO — regola pura.
 *
 * La lingua di DEFAULT sta alla radice, le altre sotto `/<lingua>`.
 *
 * ⚠️ QUALE sia la lingua di default NON lo decide il motore: e' una scelta
 * del cliente, e vive in `src/i18n/ui.ts`, che e' `merge=ours`. Qui c'e'
 * solo la REGOLA, e la si passa come parametro.
 *
 * Non e' pedanteria: e' l'unico modo di PROVARE che un sito in inglese non
 * si ritrovi `/en` davanti a ogni indirizzo. Con la lingua letta da una
 * costante importata, una prova puo' solo verificare il caso francese — cioe'
 * l'unico che non ci preoccupa.
 */

/** `""` per la lingua di default, `/xx` per tutte le altre. */
export function prefissoLingua(lang: string | undefined | null, predefinita: string): string {
  const l = String(lang ?? "").trim();
  return !l || l === predefinita ? "" : `/${l}`;
}

/** Un indirizzo del sito pubblico nella lingua data. */
export function urlConLingua(
  path: string,
  lang: string | undefined | null,
  predefinita: string,
): string {
  const pulito = path.startsWith("/") ? path : `/${path}`;
  return `${prefissoLingua(lang, predefinita)}${pulito}`;
}
