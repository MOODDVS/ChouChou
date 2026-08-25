// Pagine del SITO PUBBLICO di QUESTO cliente — fonte di verità unica.
//
// Usata da:
//  • Admin → Marketing → Pop-up: le pillole «Pagine dove appare».
//  • components/SitePopup.astro: mappa rotta pubblica → chiave pagina,
//    per decidere su quale pagina mostrare il pop-up.
//
// Ogni cliente adatta QUESTA lista alle pagine reali del suo sito.
// - `k`     : chiave stabile (non cambiarla: è salvata nei pop-up esistenti).
// - `path`  : rotta pubblica in lingua di default ("/", "/menu", "/events"…).
//             Le versioni /en, /it… sono derivate automaticamente dal prefisso.
// - label   : per le pagine STANDARD usare `labelKey` (chiave i18n admin, così
//             la pillola è tradotta nella lingua dell'admin); per una pagina
//             CUSTOM del cliente usare `label` (testo libero).
export type SitePage = {
  k: string;
  path: string;
  labelKey?: string;
  label?: string;
};

export const SITE_PAGES: SitePage[] = [
  { k: "home", path: "/", labelKey: "nav.home" },
  { k: "menu", path: "/menu", labelKey: "mk.pageMenu" },
  { k: "order", path: "/order", labelKey: "mk.pageOrder" },
  { k: "ambiance", path: "/ambiance", labelKey: "mk.pageAmbiance" },
  { k: "contact", path: "/contact", labelKey: "mk.pageContact" },
  { k: "links", path: "/links", labelKey: "mk.pageLinks" },
];
