/**
 * LE PAGINE DI STAMPA DI QUESTO CLIENTE, LETTE DAL FILESYSTEM.
 *
 * Il motore SCOPRE le pagine `/print/` del cliente invece di doverle sapere.
 * Prima un prodotto nuovo voleva una riga in `PRINT_DEFAULTS` e una chiave in
 * `admin.ts`, ogni volta: adesso basta creare la pagina nel sito, e il super
 * admin la trova nel pannello col bottone per metterla a catalogo.
 *
 * Vite risolve il glob in BUILD, quindi ogni deployment conosce le proprie
 * pagine: codice del motore, dato del cliente. Non si importa nessun modulo
 * — servono solo i nomi dei file — quindi non costa niente a runtime.
 *
 * ⚠️ La scoperta e' in build. Una pagina nuova compare nel pannello dopo il
 * deploy, ed e' giusto cosi': prima del deploy quella rotta non risponde a
 * nessuno, e un prodotto che la puntasse darebbe un 404.
 *
 * ⚠️ SOLO LATO SERVER. Le regole pure stanno in `printRegole.ts`: importare
 * questo file nel browser trascinerebbe le pagine del sito nel pacchetto.
 */
import { derivaPagine, type PaginaStampa } from "./printRegole";

// ⚠️ `query: "?raw"` NON E' UN DETTAGLIO, ed e' costato un pomeriggio.
//
// `import.meta.glob` non rende soltanto i NOMI dei file: aggancia quei moduli
// al grafo delle dipendenze di chi lo chiama. Astro poi raccoglie il CSS delle
// dipendenze di una pagina, quindi il foglio `is:global` di una pagina di
// stampa finiva addosso a `/admin/print`. Su L'Huile sur le Feu quel foglio ha
// `@media screen { body { background:#4a4a4a; padding:24px } }` per l'anteprima
// del PDF: il pannello si ritrovava il fondo grigio e l'header staccato di 24px
// dal bordo, senza piu' sembrare attaccato in alto. Nessun errore, da nessuna
// parte — solo una pagina che non somigliava piu' alle altre.
//
// Con `?raw` i moduli diventano stringhe: le chiavi sono le stesse, il CSS non
// segue. E le funzioni non si chiamano mai: qui servono solo i nomi.
const MODULI = import.meta.glob("/src/pages/print/*.astro", { query: "?raw", import: "default" });

/** Le pagine di stampa di QUESTO cliente. Vuoto se non ne ha nessuna. */
export function pagineStampa(): PaginaStampa[] {
  return derivaPagine(Object.keys(MODULI));
}
