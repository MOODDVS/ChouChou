/**
 * SONO IL MOTORE, O SONO UN CLIENTE?
 *
 * ⚠️ Alcune reti sorvegliano una proprieta' del MOTORE — «il motore non ha
 * un sito» — ma `tests/**` e' `merge` in .gitattributes, quindi il merge le
 * consegna anche ai repo dei clienti. E un cliente un sito ce l'ha: riscrive
 * `index.astro` con la sua home, aggiunge le sue rotte, si fa il suo layout.
 * Da lui quelle prove non misurano niente — sono rosse per costruzione.
 *
 * Il costo non e' il fastidio. Un `npm test` con una rossa fissa smette di
 * essere un semaforo: si impara a leggerlo a occhio, e il giorno che si
 * accende quella vera non se ne accorge nessuno. E' il modo in cui una rete
 * smette di proteggere restando scritta.
 *
 * ⚠️ Questo vale SOLO per le reti che parlano del confine del motore. Quelle
 * su font, immagini, sede e SEO sono nate per girare anche nei clienti — ed
 * e' li' che hanno gia' trovato guasti veri. Non si saltano.
 *
 * IL MARCATORE. `demo01` e' la vetrina di dimostrazione: il motore ce l'ha,
 * e ogni cliente la cancella al clone (il conflitto delete/modify a ogni
 * merge e' proprio quello). Non e' una bandierina da mantenere: e' una cosa
 * che si sa gia' dei due repo.
 *
 * Se un giorno un cliente decidesse di TENERE il demo, da lui quelle prove
 * tornerebbero a girare e sarebbero rosse — ad alta voce, non in silenzio,
 * e con questo commento a dire perche'. Un file-bandierina da cancellare al
 * clone fallirebbe allo stesso modo, in cambio di un passo in piu' da
 * ricordare ogni volta.
 *
 * ⚠️ Sta in un file SOLO, e non copiato in ognuno dei test che lo usa: due
 * copie della stessa definizione sono due copie che prima o poi divergono,
 * e la spiegazione resterebbe attaccata a una sola delle due.
 */
import { existsSync } from "node:fs";

export const SONO_IL_MOTORE = existsSync("src/pages/demo01");
