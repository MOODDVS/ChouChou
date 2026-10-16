/**
 * I SOLDI, SCRITTI — una riga, un posto solo.
 *
 * ⚠️ Era la stessa funzione copiata in cinque `<script>` di pannello
 * (Accueil, Commandes, Clients, Menu, Statistiques): identica cinque volte,
 * cioe' cinque posti in cui cambiare valuta o arrotondamento e quattro in cui
 * dimenticarselo.
 *
 * ⚠️ SI CHIAMAVA `euroDa`, e il 15/10/2026 non e' piu' vero: la valuta la
 * decide il paese del cliente (`lib/valuta.ts`). Un nome che dice «euro»
 * sopra una funzione che puo' scrivere franchi e' la stessa bugia che si
 * voleva togliere dal pannello. Il guscio locale di ogni pagina si chiama
 * ancora `euro()`: quello e' una scorciatoia di quella pagina, e si legge nel
 * suo contesto.
 *
 * ⚠️ NESSUN IMPORT DI SERVER: la usano gli script del browser, e una
 * dipendenza di server qui dentro finirebbe nel bundle della pagina.
 * `valuta.ts` e `config/client.ts` sono regole e dati puri: nessun database,
 * nessuna chiave.
 */
import { valutaDelMotore } from "./valuta";

/** Centesimi → «12,50 €» nella lingua del pannello e nella valuta del
 *  cliente. Un valore illeggibile diventa zero: `NaN €` su una card e' peggio
 *  di «0,00 €», perche' chi legge non sa se e' un prezzo o un guasto.
 *  ⚠️ `valuta` e' un parametro con un valore di ripiego, non una lettura
 *  nascosta: cosi' le prove possono chiedere i franchi senza cambiare il
 *  paese del cliente. */
export function importoDa(cents: unknown, loc: string, valuta: string = valutaDelMotore()): string {
  const n = Number(cents);
  return ((Number.isFinite(n) ? n : 0) / 100).toLocaleString(loc, {
    style: "currency",
    currency: valuta,
  });
}
