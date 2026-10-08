/**
 * COME SI PAGA UN ORDINE — le regole pure, nessun import.
 *
 * Fino al 29/09/2026 il motore sapeva fare una cosa sola: si ordina e si paga
 * con la carta, subito, attraverso Stripe. Funziona per chi ce l'ha, e taglia
 * fuori chi non lo vuole — e ci sono ristoranti che vogliono gli ordini online
 * ma incassare in cassa, come hanno sempre fatto.
 *
 * Tre interruttori, e nessuno di loro e' una preferenza estetica:
 *
 *   `orders_pay_online`  — si puo' pagare con la carta al momento dell'ordine.
 *   `orders_pay_onsite`  — si puo' ordinare e pagare al ritiro.
 *   `orders_coupons`     — il campo «codice sconto» esiste.
 *   `orders_coupons_onsite` — e vale anche per chi paga in cassa.
 *
 * ⚠️ L'ULTIMO NON E' UN DETTAGLIO DEL PENULTIMO. Con Stripe lo sconto lo
 * applica il sistema all'incasso e nessuno puo' sbagliarsi. In cassa lo deve
 * applicare una persona, leggendo la comanda, mentre c'e' fila: se il
 * ristoratore non lo vuole, il campo del codice sparisce appena il cliente
 * sceglie di pagare al ritiro. Spento di ripiego, perche' promettere uno
 * sconto che alla cassa nessuno sa di dover fare e' peggio che non offrirlo.
 *
 * ⚠️ SONO CHIAVI DI SEDE. Su un gruppo con piu' punti, uno puo' accettare i
 * contanti e un altro no; uno puo' avere il conto Stripe e un altro non
 * ancora. A livello di marchio sarebbero una regola sola per tutti, e il
 * giorno che i punti non sono d'accordo si riscrive tutto — e' la stessa
 * forma di ogni guasto multi-sede che abbiamo pagato.
 *
 * ⚠️ IL RIPIEGO E' IL COMPORTAMENTO DI OGGI. Chiave assente = pagamento online
 * acceso, pagamento al locale spento, coupon accesi: cioe' esattamente come si
 * comportano i cinque clienti attuali, che non hanno nessuna di queste righe
 * nel database. Una funzione nuova non cambia sotto i piedi a chi non l'ha
 * chiesta.
 *
 * ⚠️ VOLERE NON E' POTERE. `online` qui dice che il ristoratore lo vuole
 * offrire; se poi il conto Stripe non e' configurato, non si puo' offrire lo
 * stesso. Le due cose si incrociano in `modiDiPagamento()`, e il sito
 * pubblico deve chiedere QUELLA, non questa.
 */
/**
 * ⚠️ PERCHE' QUESTO FILE ESISTE, SEPARATO DA `ordiniOpzioni.ts`.
 *
 * Le due funzioni che leggono il database stanno di la'. Qui ci sono solo
 * regole: quali chiavi esistono, e come si legge un interruttore.
 *
 * ⚠️ Non e' ordine, e' TESTABILITA'. `admin/sede.ts` importa `db.ts`, che
 * LANCIA all'import se mancano SUPABASE_URL e SUPABASE_SERVICE_KEY — e in
 * vitest mancano. Un file di prova che importi (anche indirettamente) quel
 * modulo non parte affatto, e vitest lo segnala come «0 test», non come un
 * errore: verde a colpo d'occhio, e nessuno si accorge che la rete non c'e'.
 * E' successo davvero con `slots.test.ts`, SEDICI prove ferme per mesi
 * (ENGINE.md, «Un modulo che lancia all'import non e' testabile»). Ed e'
 * successo di nuovo qui, il 29/09/2026, mezz'ora dopo aver scritto la rete.
 */

export interface OpzioniOrdini {
  /** Il ristoratore VUOLE il pagamento con carta. */
  online: boolean;
  /** Si puo' ordinare e pagare al ritiro. */
  locale: boolean;
  /** Il campo «codice sconto» esiste. */
  coupon: boolean;
  /** ...e vale anche per chi paga in cassa. */
  couponInCassa: boolean;
}

/** Le chiavi, con il valore che vale quando la riga non c'e'. */
export const RIPIEGO_ORDINI: Record<string, "1" | "0"> = {
  orders_pay_online: "1",
  orders_pay_onsite: "0",
  orders_coupons: "1",
  orders_coupons_onsite: "0",
};

export const CHIAVI_ORDINI = Object.keys(RIPIEGO_ORDINI);

/** Un valore di `app_config` letto come interruttore, col suo ripiego. */
export function acceso(valore: unknown, chiave: string): boolean {
  const v = String(valore ?? "").trim();
  if (v !== "1" && v !== "0") return RIPIEGO_ORDINI[chiave] === "1";
  return v === "1";
}

/* ───────── Come sono entrati i soldi ─────────
 *
 * ⚠️ La domanda non e' «l'ordine e' pagato?» ma «chi ha preso i soldi?».
 * Se li ha presi una persona al banco, non c'e' nessun incasso Stripe da
 * toccare: niente link per il supplemento dopo una modifica, niente rimborso
 * online, e l'email di annullo deve dire «passa in cassa», non «ti
 * rimborsiamo».
 *
 * `onsite` sta QUI insieme a `cash` e `card`: e' l'ordine preso dal sito e
 * pagato al ritiro. Finche' non lo si incassa resta `pending`; una volta
 * incassato e' denaro di cassa come gli altri due. Prima mancava da questa
 * lista, e un ordine incassato in contanti e poi modificato al rialzo mandava
 * al cliente un link Stripe per pagare la differenza di una cena gia' saldata.
 *
 * I metodi che NON sono qui — `link` e l'ordine del sito pagato con la carta,
 * che non scrive nessun metodo — sono passati da Stripe. */
export const METODI_IN_CASSA = ["cash", "card", "onsite"];

/** I soldi li ha presi (o li prendera') una persona al banco? */
export function inCassa(metodo: unknown): boolean {
  return METODI_IN_CASSA.includes(String(metodo ?? ""));
}

/** I due modi di incassare al banco: gli unici che lo staff puo' scegliere
 *  a mano su un ordine che esiste gia'. `link` non c'e' — mandare un link di
 *  pagamento e' un altro gesto, e `onsite` nemmeno: e' lo stato di partenza,
 *  non una scelta. */
export const METODI_CASSA_SCELTA = ["cash", "card"];

/** Si puo' cambiare il metodo di questo ordine?
 *
 * ⚠️ No su un ordine passato da Stripe: il metodo e' la prova di dove sono i
 * soldi. Cambiarlo in «contanti» farebbe sparire dal pannello il rimborso di
 * un incasso che esiste davvero sul conto. */
export function metodoCambiabile(metodo: unknown): boolean {
  return inCassa(metodo);
}
