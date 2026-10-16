/**
 * LA VALUTA — una domanda, una risposta, un posto solo.
 *
 * Collegata il 15/10/2026. Prima l'euro era scritto a mano in tre file e
 * cinque punti: `soldi.ts` per come l'importo si SCRIVE, `stripe.ts` per cosa
 * si INCASSA (quattro volte), e l'icona del rimborso. Cambiarne uno solo
 * produceva una card che mente sui soldi — un simbolo e un importo che non
 * parlano della stessa moneta. Adesso leggono tutti da qui.
 *
 * ⚠️ LA DOMANDA E' IL PAESE, NON IL CONTINENTE. Zurigo e' in Europa e paga in
 * franchi, Londra in sterline. «Europa = euro» e' la scorciatoia che mette
 * l'euro sul conto di un ristorante svizzero.
 *
 * ⚠️ DUE COSE DA FARE **PRIMA** DI ACCENDERE UN CLIENTE FUORI DALL'EURO, e
 * nessuna delle due e' codice:
 *
 *   1. IL CONTO STRIPE HA UNA VALUTA SUA. Un conto belga che addebita in
 *      franchi si puo' fare, ma cambiano commissioni e accrediti: va
 *      verificato con Stripe, non deciso qui.
 *   2. GLI ORDINI GIA' SCRITTI NON DICONO IN CHE VALUTA SONO. La colonna e'
 *      `total_cents` e basta: oggi «euro» e' un'assunzione implicita di tutto
 *      lo storico. Cambiare il paese di un cliente ESISTENTE farebbe
 *      rileggere i suoi vecchi ordini nella valuta nuova, e le statistiche
 *      sommerebbero franchi ed euro come se fossero la stessa cosa. Per un
 *      cliente NUOVO non c'e' storico e il problema non esiste; per uno
 *      vecchio serve prima una colonna `currency` sugli ordini.
 */
import { CLIENT } from "../config/client";

/** Il paese (ISO 3166-1 alfa-2) → la valuta che ci si paga. */
const VALUTA_DI: Record<string, string> = {
  BE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", DE: "EUR", NL: "EUR", LU: "EUR",
  PT: "EUR", AT: "EUR", IE: "EUR", FI: "EUR", GR: "EUR",
  CH: "CHF", GB: "GBP", US: "USD", CA: "CAD",
};

/** ⚠️ Europa NON vuol dire euro: Zurigo paga in franchi, Londra in sterline.
 *  La domanda giusta e' il PAESE, non il continente. */
export function valutaDi(paese: unknown): string {
  return VALUTA_DI[String(paese ?? "").toUpperCase()] ?? "EUR";
}

/** La valuta di QUESTA installazione: la decide il paese del cliente.
 *  ⚠️ Una funzione e non una costante calcolata all'import: `config/client.ts`
 *  e' del cliente e puo' cambiare, e una costante congelerebbe il valore nel
 *  bundle senza che nessuno se ne accorga. */
export function valutaDelMotore(): string {
  return valutaDi(CLIENT.paese);
}

/** La stessa, come la vuole Stripe: minuscola, ISO 4217.
 *  ⚠️ Esiste perche' `"eur"` minuscolo era scritto a mano in quattro punti di
 *  `stripe.ts`, e tre su quattro e' esattamente il modo in cui un incasso
 *  finisce nella valuta sbagliata. */
export function valutaStripe(): string {
  return valutaDelMotore().toLowerCase();
}

/**
 * IL SIMBOLO, E QUANTO E' ALTO IL SUO INCHIOSTRO.
 *
 * ⚠️ Un'icona disegnata riempie il riquadro da bordo a bordo; un CARATTERE no.
 * L'icona «rimetti in corso» occupa 21 unita' su 24, e un `€` a corpo 17 ne
 * occupa meno di 13: accanto sembra rimpicciolito. Per pareggiarlo serve
 * corpo 27,6 — un numero che sembra assurdo ed e' quello giusto.
 *
 * ⚠️ E NON E' LO STESSO PER TUTTI: il `$` ha l'asta che scende sotto la linea
 * di base, l'`€` no. A parita' di corpo il dollaro verrebbe piu' alto. Qui
 * ogni simbolo porta la SUA misura, ricavata dall'altezza reale del suo
 * inchiostro (`actualBoundingBox`) in `system-ui` grassetto.
 *
 * ⚠️ La misura e' NOMINALE: `system-ui` e' SF Pro su Mac e Segoe su Windows, e
 * le due hanno metriche un po' diverse. Lo scarto e' di qualche punto
 * percentuale, invisibile; se un giorno su una macchina stonasse, i numeri da
 * toccare sono questi tre e nessun altro.
 */
export interface MisuraSimbolo { simbolo: string; corpo: number; linea: number }

/** Altezza d'inchiostro voluta, in unita' del viewBox 24: quella del rollback. */
export const ALTEZZA_SIMBOLO = 21;

const SIMBOLI: Record<string, MisuraSimbolo> = {
  EUR: { simbolo: "€", corpo: 27.63, linea: 22.22 },
  USD: { simbolo: "$", corpo: 23.08, linea: 19.04 },
  CAD: { simbolo: "$", corpo: 23.08, linea: 19.04 },
  GBP: { simbolo: "£", corpo: 28.38, linea: 22.50 },
  CHF: { simbolo: "₣", corpo: 28.77, linea: 22.50 },
};

export function misuraDi(valuta: string): MisuraSimbolo {
  return SIMBOLI[String(valuta).toUpperCase()] ?? SIMBOLI.EUR;
}

/** L'icona del rimborso: il simbolo e basta. ⚠️ Niente freccia, niente
 *  cornice — provate tutte e due, e a 24px la punta di una freccia sparisce
 *  dentro il tratto del cerchio. In quel piede di card, accanto a «rimetti in
 *  corso» e sotto la pastiglia «Annulee», un simbolo di valuta non puo'
 *  voler dire altro che soldi. */
export function iconaValuta(valuta: string): string {
  const m = misuraDi(valuta);
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="${m.linea}" text-anchor="middle" font-size="${m.corpo}" font-weight="700" fill="currentColor" font-family="system-ui,sans-serif">${m.simbolo}</text></svg>`;
}
