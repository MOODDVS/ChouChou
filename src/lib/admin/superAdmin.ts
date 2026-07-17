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

export function isSuper(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === SUPER_EMAIL;
}
