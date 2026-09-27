// ⚠️ FILE PER-CLIENTE (`merge=ours`): qui si dichiarano le lingue del SITO
// pubblico e quale sta alla radice. Un cliente col sito in inglese cambia
// `defaultLang` e basta: le funzioni qui sotto non nominano nessuna lingua.
export const languages = { fr: "Français", en: "English" } as const;
export const defaultLang = "fr";

export type Lang = keyof typeof languages;

import { prefissoLingua, urlConLingua } from "../lib/linguaUrl";
import fr from "./fr.json";
import en from "./en.json";

const dictionaries: Record<Lang, Record<string, string>> = { fr, en };

/** Ricava la lingua dall'URL: la default sta alla radice, le altre sotto /xx/.
 *  ⚠️ Nessuna lingua scritta a mano: si guarda se il primo pezzo e' una delle
 *  lingue DICHIARATE qui sopra. Prima c'era `if (seg === "en")`, e un sito con
 *  l'inglese alla radice si sarebbe ritrovato /en davanti a tutto. */
export function getLangFromUrl(url: URL): Lang {
  const [, seg] = url.pathname.split("/");
  if (seg && seg !== defaultLang && Object.hasOwn(languages, seg)) return seg as Lang;
  return defaultLang;
}

/** Restituisce una funzione t(key) nella lingua data, con ripiego sulla lingua di default. */
export function useTranslations(lang: Lang) {
  return function t(key: string): string {
    return dictionaries[lang][key] ?? dictionaries[defaultLang][key] ?? key;
  };
}

/** Costruisce un URL localizzato: la lingua di default senza prefisso, le
 *  altre con `/<lingua>`. La regola sta in `lib/linguaUrl`, qui si lega
 *  soltanto alla lingua di default DI QUESTO sito. */
export function getLocalizedUrl(path: string, lang: Lang): string {
  return urlConLingua(path, lang, defaultLang);
}

/** Il prefisso da solo, per chi costruisce l'indirizzo a pezzi. */
export function prefissoDiLingua(lang: string | undefined): string {
  return prefissoLingua(lang, defaultLang);
}