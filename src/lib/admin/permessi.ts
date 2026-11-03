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
import { claimsDaToken, staffAutorizzato, type StaffUser } from "./adminAuth";
import { caricaBootAdmin } from "./adminBoot";
import { ruoloDi, PAGINE_ADMIN } from "./superAdmin";
import { puoVederePagina, funzioneAccesa, PAGINE_PALMARE } from "./permessiRegole";

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
  // ⚠️ AUDIT 3/11/2026: una firma valida non basta. Un account senza ruolo
  // (auto-registrato) per `ruoloDi` vale «admin»: senza questo controllo le
  // pagine SSR — home, sala — gli mostravano i dati. Contesto sterile: vede
  // solo la home vuota, e le API (verificaStaff) gli rispondono 401.
  if (!staffAutorizzato(staff)) {
    // ⚠️ `salle` va nell'elenco apposta: una pagina SCONOSCIUTA e' aperta a
    // tutti (permessiRegole), e la sala non sta in PAGINE_ADMIN.
    return { ruolo: "user", pagineUtente: [], nascoste: [], tutte: [...PAGINE_ADMIN.map((pg) => pg.key), ...PAGINE_PALMARE] };
  }
  return contestoDiStaff(staff);
}

/** Scorciatoia leggibile sul posto: `puo(ctx, "orders")`. */
export function puo(ctx: ContestoPermessi, pagina: string): boolean {
  return puoVederePagina(pagina, ctx);
}

/**
 * Lo mettiamo nella Accueil? — il permesso di chi guarda E la funzione accesa.
 *
 * ⚠️ E' la domanda che deve fare la HOME, non `puo`. `puo` e' la serratura:
 * dice se una richiesta passa, e al super passa sempre. Questa dice se la cosa
 * ha senso in questo locale. L'interruttore «Pages visibles» del super e' il
 * comando: spento Commandes, tutto cio' che riguarda gli ordini sparisce dalla
 * Accueil — colonna, tile e numeri — per tutti, lui compreso.
 */
export function mostra(ctx: ContestoPermessi, pagina: string): boolean {
  return puo(ctx, pagina) && funzioneAccesa(pagina, ctx);
}

/**
 * Questa persona ha QUESTA pagina? Per le API che una pagina in piu' puo'
 * chiamare solo in parte (API_ANCHE): Commandes chiude gli ordini con
 * `PATCH /settings`, ma la mail del mattino col fatturato resta di Réglages.
 */
export async function haLaPagina(staff: StaffUser, pagina: string): Promise<boolean> {
  return puoVederePagina(pagina, await contestoDiStaff(staff));
}
