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
  { key: "settings", label: "Réglages" },
];

/** Tab interni alle pagine che si possono nascondere singolarmente.
 *  Chiave = key della pagina in PAGINE_ADMIN. La key del tab combacia con
 *  il valore usato nel markup (data-tab per Marketing, data-t per Réglages). */
export const TABS_ADMIN: Record<string, { key: string; label: string }[]> = {
  marketing: [
    { key: "popup", label: "Pop-up" },
    { key: "news", label: "Newsletter" },
    { key: "coupons", label: "Coupons" },
  ],
  settings: [
    { key: "general", label: "Général" },
    { key: "horaire", label: "Horaire" },
    { key: "reservations", label: "Réservations" },
    { key: "cuisine", label: "Cuisine" },
    { key: "liens", label: "Liens" },
    { key: "team", label: "Team" },
  ],
};

/** Tutte le combinazioni valide "pagina:tab" (per validare lato server). */
export const TABS_VALIDI: string[] = Object.entries(TABS_ADMIN).flatMap(
  ([pagina, tabs]) => tabs.map((t) => `${pagina}:${t.key}`)
);

export function isSuper(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === SUPER_EMAIL;
}
