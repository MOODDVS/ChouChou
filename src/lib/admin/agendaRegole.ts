/**
 * AGENDA — QUALE EVENTO VIENE PRIMA, E QUALE E' GIA' PASSATO.
 *
 * ⚠️ ZERO IMPORT, DI PROPOSITO: lo carica il browser (la pagina agenda) e lo
 * carica il test. Un solo `import` che arrivi a `db.ts` e il test non parte
 * piu' — vitest direbbe «0 test», cioe' verde. Vedi ENGINE.md, come per
 * `ordiniRegole` e `temaColori`.
 *
 * IL PROBLEMA. L'agenda arrivava in ordine di data crescente, cosi' com'e'
 * salvata. Dopo un anno di eventi, chi apre la pagina trova in cima la festa
 * dell'anno scorso e deve scorrere tutto per arrivare a quella di sabato —
 * mentre l'unica che deve preparare e' quella.
 *
 * LA REGOLA. Prima quello che deve ancora succedere, dal piu' vicino: e' la
 * lista delle cose da fare. Poi lo storico, dal piu' recente: e' un archivio,
 * e di un archivio si guarda la fine, non l'inizio.
 *
 * ⚠️ UN EVENTO DI PIU' GIORNI E' PASSATO QUANDO FINISCE, non quando comincia:
 * una mostra dal 1° al 20 del mese, il giorno 10, e' in corso. Si guarda
 * `date_end` quando c'e', altrimenti `date_start`.
 */

export interface EventoOrdinabile {
  date_start: string;          // "AAAA-MM-GG"
  date_end?: string | null;
}

/** La data che conta per dire se e' finito: la fine se c'e', se no l'inizio. */
export function dataFine(e: EventoOrdinabile): string {
  const fine = typeof e.date_end === "string" ? e.date_end.trim() : "";
  return fine || e.date_start;
}

/**
 * `true` se l'evento e' gia' finito rispetto a `oggi` ("AAAA-MM-GG").
 * Il giorno stesso NON e' passato: l'evento di stasera e' ancora da fare.
 * Le date sono stringhe ISO, quindi si confrontano come testo senza fusi
 * orari di mezzo — che e' anche il motivo per cui `oggi` si passa da fuori:
 * chi chiama sa in che fuso vive il ristorante.
 */
export function eventoPassato(e: EventoOrdinabile, oggi: string): boolean {
  return dataFine(e) < oggi;
}

/**
 * Prima i prossimi (dal piu' vicino), poi i passati (dal piu' recente).
 * Non tocca la lista che riceve: ne restituisce una nuova.
 */
export function ordinaEventi<T extends EventoOrdinabile>(lista: readonly T[], oggi: string): T[] {
  const prossimi: T[] = [];
  const passati: T[] = [];
  for (const e of lista) (eventoPassato(e, oggi) ? passati : prossimi).push(e);
  prossimi.sort((a, b) => (a.date_start < b.date_start ? -1 : a.date_start > b.date_start ? 1 : 0));
  passati.sort((a, b) => (dataFine(a) > dataFine(b) ? -1 : dataFine(a) < dataFine(b) ? 1 : 0));
  return [...prossimi, ...passati];
}
