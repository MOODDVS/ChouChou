/**
 * LA VALUTA — simbolo e misura, in un posto solo.
 *
 * ⚠️ IL MOTORE OGGI E' IN EURO, E NON SOLO PER MODO DI DIRE: `lib/soldi.ts`
 * scrive `currency: "EUR"` e `lib/stripe.ts` incassa `currency: "eur"` in
 * quattro punti. Finche' quei cinque posti non leggono da qui, `valutaDi()`
 * NON va collegata a nessuna schermata: un'icona in dollari accanto a un
 * totale in euro e' una card che mente — e mente sui soldi.
 * La mappa sta qui perche' il giorno in cui si fa, si fa in un file solo.
 * `tests/valuta.test.mjs` tiene chiuso l'uscio: fallisce se qualcuno collega
 * la mappa prima di aver sistemato soldi.ts e stripe.ts.
 */

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

/** Quello che il motore usa DAVVERO oggi. Una funzione e non una costante:
 *  il giorno in cui diventa `valutaDi(CLIENT.paese)` si cambia questa riga e
 *  tutto il pannello la segue. */
export function valutaDelMotore(): string {
  return "EUR";
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
