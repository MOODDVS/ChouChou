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

const MODULI = import.meta.glob("/src/pages/print/*.astro");

/** Le pagine di stampa di QUESTO cliente. Vuoto se non ne ha nessuna. */
export function pagineStampa(): PaginaStampa[] {
  return derivaPagine(Object.keys(MODULI));
}
