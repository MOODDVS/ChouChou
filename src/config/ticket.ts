import { ticketCucina } from "../lib/stampaRegole";
import type { OrdineDaStampare, RigaTicket } from "../lib/stampaRegole";

/**
 * IL DISEGNO DEL TICKET — di QUESTO cliente.
 *
 * ⚠️ QUESTO FILE E' DEL CLIENTE, e il motore non lo tocca piu' dopo averlo
 * creato. E' la stessa regola di `config/client.ts`: cio' che e' suo vive in
 * `config/`, cosi' un merge del motore non glielo riscrive e lui non si
 * prende un conflitto a ogni giro.
 *
 * Il ticket di cucina e' una cosa che ogni ristorante vuole a modo suo: chi
 * stampa il logo, chi vuole il telefono grande perche' richiama sempre, chi
 * l'ora in cima e chi in fondo. Finche' il disegno stava dentro
 * `lib/stampaRegole.ts` — un file del motore — cambiarlo voleva dire
 * modificare il motore dentro il cliente: funziona una volta, e poi litiga a
 * ogni `git merge` finche' qualcuno risolve il conflitto nel verso sbagliato
 * e il ristorante si ritrova il ticket di qualcun altro.
 *
 * COME SI CAMBIA: si riscrive il corpo di questa funzione. Le righe sono
 * logiche, non pixel — `taglia`, `grassetto`, `centrato`, `inverso`, `linea` —
 * e chi le trasforma in comandi per la stampante (`escpos.ts`) resta del
 * motore: cosi' un disegno nuovo non puo' rompere la stampa, al massimo esce
 * brutto. Le misure vere: 48 colonne in `normale` e `grande`, 24 in
 * `gigante` e `largo`, 64 in `piccolo`. ⚠️ `grande` e' doppia ALTEZZA sola —
 * tiene le 48 colonne ma le lettere sembrano strette; per scrivere davvero
 * grande servono `gigante` o `largo`, e si paga in colonne.
 *
 * `logo: true` su una riga stampa il marchio caricato DENTRO la stampante.
 * Vuole un passo a mano su ogni stampante (vedi `C.logo` in `escpos.ts`);
 * dove non e' stato fatto, non stampa niente e non rompe niente.
 *
 * ⚠️ `ticketCucina` del motore e' il RIPIEGO, non una base da copiare: finche'
 * si chiama lui, il cliente riceve anche i miglioramenti dei giri successivi.
 * Si sostituisce quando si vuole davvero un disegno proprio, non prima.
 */
export function disegnaTicket(o: OrdineDaStampare): RigaTicket[] {
  return ticketCucina(o);
}
