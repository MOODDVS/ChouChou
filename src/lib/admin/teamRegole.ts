/**
 * CHI DEL TEAM PUO' RICEVERE UNA NOTA.
 *
 * ⚠️ `team` NON e' l'elenco del personale: e' una RUBRICA. Le sue categorie
 * sono direction, cuisine, salle, admin, fournisseurs, technique, marketing,
 * consultants, partenaires — dentro ci sono il commercialista, l'idraulico e
 * i fornitori. Un menu' «Assegna a» che li elenca tutti rende facilissimo
 * assegnare «ordinare la farina» AL FORNITORE della farina, e spedirgli una
 * nota interna. L'interfaccia non deve rendere comodo l'errore.
 *
 * Regola pura, nessuna rete: la applicano sia l'elenco che si vede nel
 * modale sia l'email che parte dal server. Scritta in due posti sarebbe una
 * lista che mostra una persona a cui poi non si puo' scrivere, o il
 * contrario.
 */

/** Le categorie di chi lavora QUI DENTRO. Le altre sono gente di fuori. */
export const CATEGORIE_INTERNE = ["direction", "cuisine", "salle", "admin"] as const;

export interface PersonaTeam {
  id?: string;
  name?: string | null;
  email?: string | null;
  category?: string | null;
  active?: boolean | null;
}

/**
 * Si puo' assegnare una nota a questa persona?
 *
 * ⚠️ Serve anche l'EMAIL. Assegnare a chi non ne ha non e' meta' funzione:
 * e' una nota che dice «tocca a Marco» mentre Marco non lo sa, e chi l'ha
 * scritta crede di averglielo detto. Meglio non offrirlo.
 *
 * ⚠️ E solo chi e' `active`: una persona disattivata e' uscita dal giro, e
 * continuare a proporla nell'elenco e' il modo di mandare un promemoria a
 * qualcuno che non lavora piu' qui.
 */
export function assegnabile(p: PersonaTeam | null | undefined): boolean {
  if (!p || p.active === false) return false;
  if (!String(p.email ?? "").trim()) return false;
  if (!String(p.name ?? "").trim()) return false;
  return (CATEGORIE_INTERNE as readonly string[]).includes(String(p.category ?? ""));
}

/** Le persone assegnabili, nell'ordine in cui arrivano. */
export function assegnabili<T extends PersonaTeam>(righe: T[] | null | undefined): T[] {
  return (righe ?? []).filter((p) => assegnabile(p));
}
