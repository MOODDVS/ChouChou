/**
 * IL CONTESTO DEI PERMESSI — chi guarda, e cosa gli tocca.
 *
 * `permessiRegole.ts` contiene la REGOLA (pura, senza database). Qui c'e'
 * l'unico posto che la riempie con i dati veri: il ruolo dalle claims del
 * token, le pagine spuntate nel modale utente, le pagine spente dal super.
 *
 * ⚠️ Esiste perche' ne servivano DUE copie: il middleware, che decide se una
 * richiesta passa, e l'SSR della home, che decide cosa mettere nell'HTML. Due
 * copie della stessa domanda e' il modo in cui si smette di sapere quale
 * risponde — e qui la risposta sbagliata non da' nessun errore: da' dati che
 * chi guarda non doveva vedere.
 */
import { claimsDaToken, type StaffUser } from "./adminAuth";
import { caricaBootAdmin } from "./adminBoot";
import { ruoloDi, PAGINE_ADMIN } from "./superAdmin";
import { puoVederePagina } from "./permessiRegole";

export interface ContestoPermessi {
  ruolo: ReturnType<typeof ruoloDi>;
  pagineUtente?: string[] | null;
  nascoste: string[];
  tutte: string[];
}

/** Il contesto di uno staff gia' verificato. */
export async function contestoDiStaff(staff: StaffUser): Promise<ContestoPermessi> {
  let nascoste: string[] = [];
  try {
    nascoste = (await caricaBootAdmin()).hiddenPages;
  } catch {
    // ⚠️ Boot illeggibile: si considera «niente nascosto». Il ripiego va in
    // questa direzione apposta — un database lento non deve chiudere fuori
    // dall'admin chi ha diritto di entrare.
    nascoste = [];
  }
  return {
    ruolo: ruoloDi(staff),
    pagineUtente: staff.pages,
    nascoste,
    tutte: PAGINE_ADMIN.map((pg) => pg.key),
  };
}

/** Il contesto a partire dal token. `null` se le claims non si leggono. */
export async function contestoDaToken(token: string): Promise<ContestoPermessi | null> {
  const staff = await claimsDaToken(token);
  if (!staff) return null;
  return contestoDiStaff(staff);
}

/** Scorciatoia leggibile sul posto: `puo(ctx, "orders")`. */
export function puo(ctx: ContestoPermessi, pagina: string): boolean {
  return puoVederePagina(pagina, ctx);
}
