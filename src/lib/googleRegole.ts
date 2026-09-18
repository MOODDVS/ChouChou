/**
 * GOOGLE — le regole, pure, senza rete e senza database.
 *
 * Stesso patto di `sedeRegole.ts` e compagnia: qui non si legge niente.
 *
 * ⚠️ IL MODELLO, che e' misto e va tenuto a mente:
 *
 *   l'AUTORIZZAZIONE e' del marchio — un conto Google gestisce le tre schede,
 *                                     quindi un token solo (`google_oauth_refresh`)
 *   la SCHEDA e' della sede         — tre pizzerie, tre schede, tre indirizzi
 *   le RECENSIONI sono della sede   — vengono dalla sua scheda
 *   il PLACE ID e' della sede       — identifica UN'ATTIVITA' FISICA
 *
 * Il token e' l'unica cosa condivisa, ed e' voluto: chi collega Google e'
 * MOODD, una volta, in super admin. I ristoratori non hanno questa
 * possibilita' da nessuna parte.
 */
import type { Ambito } from "./admin/sedeRegole";

/** Percorso v4 di una scheda: `accounts/{id}/locations/{id}`. */
const RE_SCHEDA = /^accounts\/[^/]+\/locations\/[^/]+$/;

export function schedaValida(path: unknown): boolean {
  return RE_SCHEDA.test(String(path ?? "").trim());
}

/**
 * A QUALE SEDE appartengono le recensioni che stiamo scaricando.
 *
 *   `multiSede` falso  -> null, e non e' un ripiego: a sede unica NULL E' la
 *                         verita', ed e' quello che c'e' scritto da sempre.
 *   ambito di una sede -> quella. Stiamo sincronizzando il suo punto.
 *   altrimenti         -> la sede che ha DICHIARATO questa scheda. Serve al
 *                         cron, che passa su tutto senza una sede scelta.
 *
 * `null` in un gruppo vuol dire «non lo so», e il chiamante deve trattarlo
 * come tale: vedi `campoSede`.
 */
export function sedeDaAttribuire(opz: {
  ambito: Ambito;
  dichiarata: string | null;
  multiSede: boolean;
}): string | null {
  if (!opz.multiSede) return null;
  if (opz.ambito.modo === "sede") return opz.ambito.id;
  return opz.dichiarata;
}

/**
 * ⚠️⚠️ LA RIGA DI TRE CARATTERI CHE HA QUASI CANCELLATO 276 RECENSIONI.
 *
 * Le recensioni si salvano con un upsert su `review_id`. Un upsert scrive
 * QUELLO CHE GLI PASSI: mettendo `location_id: null` quando la sede non si
 * sa, ogni sincronizzazione azzererebbe l'attribuzione di tutte le
 * recensioni gia' assegnate — l'esatto contrario di quello che serve, e
 * senza un errore da nessuna parte.
 *
 * Non sapendo, si TACE: la colonna non entra nel payload, le righe vecchie
 * restano dove sono e le nuove nascono orfane — e come tali si contano.
 *
 * «Non lo so» e «e' di nessuno» sono due cose diverse. Un campo assente dice
 * la prima; un `null` esplicito dice la seconda.
 */
export function campoSede(sede: string | null): { location_id?: string } {
  return sede ? { location_id: sede } : {};
}

/**
 * Si puo' assegnare questa scheda a questa sede?
 *
 * ⚠️ NO se un ALTRO punto l'ha gia' dichiarata. Due sedi sulla stessa scheda
 * vuol dire che scaricano le stesse recensioni, e siccome `review_id` e' la
 * chiave primaria, ogni sincronizzazione riscrive l'attribuzione: le stesse
 * recensioni rimbalzano fra Stockel e Jourdan a ogni giro. I conteggi
 * diventano casuali, e chi prova a rispondere a una recensione sua si sente
 * dire che non e' sua — a volte.
 *
 * Non e' un caso di scuola: le tre schede si scelgono a mano da un elenco a
 * tendina, e i nomi si assomigliano tutti.
 */
export function schedaLibera(opz: {
  /** Chi dichiara oggi questa scheda (id sede), se qualcuno. */
  giaDi: string | null;
  /** La sede a cui si vorrebbe assegnarla. */
  ambito: Ambito;
}): boolean {
  if (!opz.giaDi) return true;
  // Riassegnare alla STESSA sede e' un salvataggio, non un conflitto.
  return opz.ambito.modo === "sede" && opz.giaDi === opz.ambito.id;
}

// ============================================================
// STATO DEL COLLEGAMENTO GOOGLE (18/09/2026)
//
// Prima c'erano due bugie opposte, e nessuna delle due era un errore:
//  - `accessToken()` rendeva `null` sia quando non si era MAI collegato sia
//    quando il token era morto, e tutte le API rispondevano «Google non
//    collegato»: il ristoratore pensava di non aver mai cliccato il pulsante;
//  - `integrations.ts` diceva «collegato» perche' la STRINGA del token era
//    nel database, anche se Google l'aveva revocata da giorni.
//
// ⚠️ PERCHE' SUCCEDE DAVVERO, E SPESSO. Finche' l'app OAuth resta in
// «Testing», Google emette refresh token che scadono dopo SETTE GIORNI. Non
// e' una scadenza che si rinnova usandola: e' un muro. L'unico rimedio vero e'
// pubblicare l'app e farla verificare — questo codice non lo evita, lo rende
// visibile.
// ============================================================

export type StatoGoogle =
  | "spento"    // niente GOOGLE_CLIENT_ID/SECRET: la funzione non e' attiva
  | "mai"       // nessun refresh token salvato: non si e' mai collegato
  | "scaduto"   // c'era, Google l'ha rifiutato: va ricollegato
  | "incerto"   // non si e' potuto chiedere (rete): NON dire che e' scaduto
  | "ok";

/**
 * Perche' Google ha rifiutato il rinnovo.
 *
 * ⚠️ Solo `invalid_grant` vuol dire «ricollegati». Un 500 di Google o una rete
 * che cade NON sono una revoca: dirlo manderebbe il ristoratore a rifare il
 * collegamento per un raffreddore, e la volta dopo che succede davvero non ci
 * crederebbe piu'.
 */
export function classificaErroreToken(stato: number, corpo: string): StatoGoogle {
  const testo = String(corpo ?? "");
  if (stato === 400 || stato === 401) {
    if (/invalid_grant|token has been expired or revoked/i.test(testo)) return "scaduto";
    // 400 con un altro errore (client sbagliato, parametro mancante) non e'
    // colpa del ristoratore e non si risolve ricollegando.
    return "incerto";
  }
  return "incerto";
}

/** Il collegamento va rifatto dall'utente? */
export function daRicollegare(s: StatoGoogle): boolean {
  return s === "mai" || s === "scaduto";
}
