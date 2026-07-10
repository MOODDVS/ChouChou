export const languages = { fr: "Français", en: "English" } as const;
export const defaultLang = "fr";

export type Lang = keyof typeof languages;

import fr from "./fr.json";
import en from "./en.json";

const dictionaries: Record<Lang, Record<string, string>> = { fr, en };

/** Ricava la lingua dall'URL. FR è default (nessun prefisso), EN sta sotto /en/. */
export function getLangFromUrl(url: URL): Lang {
  const [, seg] = url.pathname.split("/");
  if (seg === "en") return "en";
  return defaultLang;
}

/** Restituisce una funzione t(key) che traduce nella lingua data, con fallback su FR. */
export function useTranslations(lang: Lang) {
  return function t(key: string): string {
    return dictionaries[lang][key] ?? dictionaries[defaultLang][key] ?? key;
  };
}

/** Costruisce un URL localizzato. FR senza prefisso, EN con /en. */
export function getLocalizedUrl(path: string, lang: Lang): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return lang === "en" ? `/en${clean}` : clean;
}