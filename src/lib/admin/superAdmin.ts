/**
 * Super admin (MOODD): l'unico utente che vede il bottone "Admin"
 * (ingranaggio) e può decidere quali pagine dell'admin sono visibili
 * agli altri utenti (il ristorante). Vede sempre tutto.
 */
export const SUPER_EMAIL = "admin@moodd.online";

/** Pagine dell'admin che si possono nascondere agli altri utenti.
 *  "home" resta sempre accessibile: è l'approdo dopo il login. */
export const PAGINE_ADMIN: { key: string; label: string }[] = [
  { key: "orders", label: "Commandes" },
  { key: "reservations", label: "Réservations" },
  { key: "clients", label: "Clients" },
  { key: "menu", label: "Menu" },
  { key: "stats", label: "Statistiques" },
  { key: "marketing", label: "Marketing" },
  { key: "assets", label: "Assets" },
  { key: "agenda", label: "Agenda" },
  { key: "settings", label: "Admin" },
];

/** Tab interni alle pagine che si possono nascondere singolarmente.
 *  Chiave = key della pagina in PAGINE_ADMIN. La key del tab combacia con
 *  il valore usato nel markup (data-tab per Marketing, data-t per Réglages). */
export const TABS_ADMIN: Record<string, { key: string; label: string }[]> = {
  marketing: [
    { key: "popup", label: "Pop-up" },
    { key: "news", label: "Newsletter" },
    { key: "coupons", label: "Coupons" },
    { key: "giftcards", label: "Bons cadeaux" },
  ],
  menu: [
    { key: "food", label: "Plats" },
    { key: "drink", label: "Boissons" },
    { key: "lunch", label: "Lunch" },
    { key: "menus", label: "Menus" },
  ],
  settings: [
    { key: "general", label: "Général" },
    { key: "horaire", label: "Horaire" },
    { key: "reservations", label: "Réservations" },
    { key: "cuisine", label: "Cuisine" },
    { key: "liens", label: "Liens" },
    { key: "team", label: "Team" },
    { key: "documents", label: "Documents" },
    { key: "notifications", label: "Notifications" },
  ],
};

/** Tutte le combinazioni valide "pagina:tab" (per validare lato server). */
export const TABS_VALIDI: string[] = Object.entries(TABS_ADMIN).flatMap(
  ([pagina, tabs]) => tabs.map((t) => `${pagina}:${t.key}`)
);

/**
 * TEMA dell'admin: colori del BRAND del cliente, configurabili dal super
 * admin nella pagina Reglages (app_config "admin_theme"). Ogni chiave
 * corrisponde a una variabile CSS --c-<chiave> usata da tutte le pagine
 * admin. Assente/parziale => si usano questi default MOODD.
 * I colori SEMANTICI (verde ok, rossi errore/allarme) restano fissi.
 */
export const TEMA_DEFAULT: Record<string, string> = {
  accent: "#ff7300", // arancione MOODD: azioni, attivi, titoli
  hover: "#e04f00",  // arancione hover
  bg: "#ffffff",     // fondo pagina (e testo sui bottoni accent)
  header: "#ffffff", // barra in alto (indipendente dal fondo pagina)
  card: "#ffffff",   // card
  input: "#e6e6e6",  // input / elementi "off"
  line: "#ebebeb",   // linee e bordi
  muted: "#a6a6a6",  // testo secondario
  text: "#666666",   // testo principale
};
// Default non-colore del tema: effet verre SPENTO (opaco), ombre al 15%.
// Il verre si accende salvando glass:"on"; le ombre con shadow:"0".."100".
export const TEMA_CHIAVI = Object.keys(TEMA_DEFAULT);

/**
 * LINGUE PUBBLICHE (lato cliente): le lingue in cui il ristorante comunica
 * con i clienti — pillole del modale Nuovo ordine, selettore del widget
 * prenotazioni, e lingua dei template email. Stesso set delle lingue
 * dell'interfaccia admin (LINGUE_ADMIN): fr/en/it/nl/es. Endonimi (il nome
 * della lingua nella lingua stessa) + bandiera, indipendenti dalla lingua
 * dell'admin. Il super admin sceglie quali attivare e qual è la predefinita
 * (Réglages → Impostazioni). Storage in app_config:
 *   - public_languages    : array JSON dei codici attivi, es. ["fr","en","it"]
 *   - public_lang_default : codice della lingua predefinita, es. "fr"
 */
export const LINGUE_PUBBLICHE: { code: string; label: string; flag: string }[] = [
  { code: "fr", label: "Français",   flag: "🇫🇷" },
  { code: "en", label: "English",    flag: "🇬🇧" },
  { code: "it", label: "Italiano",   flag: "🇮🇹" },
  { code: "nl", label: "Nederlands", flag: "🇳🇱" },
  { code: "es", label: "Español",    flag: "🇪🇸" },
];
export const PUBLIC_LANG_CODES = LINGUE_PUBBLICHE.map((l) => l.code);
/** Attive di default se app_config è vuoto: FR+EN (comportamento storico). */
export const PUBLIC_LANGS_DEFAULT = ["fr", "en"];
/** Lingua predefinita di default: francese. */
export const PUBLIC_LANG_DEFAULT = "fr";

/**
 * Normalizza le lingue pubbliche lette da app_config in un set coerente:
 * solo codici noti, ordine canonico, almeno una attiva, predefinita sempre
 * dentro il set. Usata sia dall'API (/api/admin/pages) sia dal boot SSR,
 * cosi' la stessa regola vale ovunque.
 */
export function normalizzaLinguePubbliche(rawLangs: string, rawDefault: string): { langs: string[]; def: string } {
  let langs: string[] = [];
  try {
    const arr = JSON.parse(rawLangs || "[]");
    if (Array.isArray(arr)) {
      const set = new Set(arr.filter((c) => PUBLIC_LANG_CODES.includes(c)));
      langs = PUBLIC_LANG_CODES.filter((c) => set.has(c));
    }
  } catch { /* JSON rotto: default sotto */ }
  if (!langs.length) langs = [...PUBLIC_LANGS_DEFAULT];
  let def = (rawDefault || "").trim();
  if (!langs.includes(def)) def = langs.includes(PUBLIC_LANG_DEFAULT) ? PUBLIC_LANG_DEFAULT : langs[0];
  return { langs, def };
}

export function isSuper(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === SUPER_EMAIL;
}

/**
 * RUOLI (in `app_metadata.role`, scrivibile solo con la service key):
 *  - "super" : vede tutto + la pagina Réglages (design, users, permissions)
 *  - "admin" : eredita esattamente ciò che è attivo in Réglages  [default]
 *  - "user"  : come admin, MENO les pages Admin (settings) et Statistiques
 * Gli utenti creati prima dei ruoli non hanno il campo → valgono "admin",
 * cioè il comportamento storico.
 */
export type RuoloAdmin = "super" | "admin" | "user";

/** Pagine riservate: mai visibili al ruolo "user". */
export const PAGINE_SOLO_ADMIN = ["settings", "stats"];

export function ruoloDi(u: {
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
  role?: string;
  is_super?: boolean;
} | null | undefined): RuoloAdmin {
  if (!u) return "user";
  if (isSuper(u.email)) return "super";
  const am = (u.app_metadata ?? {}) as { role?: string; is_super?: boolean };
  const r = String(u.role ?? am.role ?? "");
  if (r === "super" || r === "admin" || r === "user") return r;
  // Retrocompatibilità col vecchio flag booleano
  if (u.is_super === true || am.is_super === true) return "super";
  return "admin";
}

/**
 * Super admin "vero": l'accesso MOODD (email fissa) OPPURE un utente
 * promosso, marcato in `app_metadata` — scrivibile solo con la
 * service key, quindi nessuno può auto-promuoversi dal browser.
 */
export function isSuperUser(u: {
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
  is_super?: boolean;
} | null | undefined): boolean {
  return ruoloDi(u) === "super";
}
