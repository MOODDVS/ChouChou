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

/**
 * Lingua e percorso «nudo» di un indirizzo del sito pubblico (27/10/2026,
 * il pop-up).
 *
 * ⚠️ Stessa regola di `getLangFromUrl` in `src/i18n/ui.ts`: il primo pezzo e'
 * una lingua solo se e' una delle lingue DICHIARATE e non e' quella di base.
 * Prima `SitePopup` scriveva a mano `/en` e `/it` con il francese alla
 * radice: su un sito con l'inglese alla radice e il francese sotto `/fr/`
 * le pagine inglesi chiedevano il pop-up francese, e quelle francesi non
 * trovavano la loro pagina (`/fr/menu` non e' nella mappa delle pagine).
 */
export function linguaEPercorso(
  pathname: string,
  lingue: readonly string[],
  predefinita: string,
): { lingua: string; path: string } {
  const raw = pathname.replace(/\/+$/, "") || "/";
  const [, seg] = raw.split("/");
  if (seg && seg !== predefinita && lingue.includes(seg)) {
    return { lingua: seg, path: raw.slice(seg.length + 1) || "/" };
  }
  return { lingua: predefinita, path: raw };
}

/**
 * Un link interno (es. un bottone del pop-up) nella lingua della pagina:
 * `/order` diventa `/en/order` solo se la pagina NON e' nella lingua di base.
 * Non si toccano i link esterni, le ancore (`#reserver`), quelli gia'
 * prefissati e i `//host` senza protocollo.
 * ⚠️ «Gia' prefissato» vuol dire `/en` o `/en/…`: con un `startsWith("/en")`
 * secco anche `/entree` passava per inglese.
 */
export function localizzaLink(url: string, lingua: string, predefinita: string): string {
  if (!url.startsWith("/") || url.startsWith("//")) return url;
  const p = prefissoLingua(lingua, predefinita);
  if (!p || url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`) || url.startsWith(`${p}#`)) return url;
  return url === "/" ? p : `${p}${url}`;
}
