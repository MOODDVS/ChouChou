/**
 * LE REGOLE DELLE PAGINE DI STAMPA — pure, senza dipendenze, senza glob.
 *
 * Il catalogo Print (`config/printCatalog.ts`) dice cosa MOODD vende e a che
 * prezzo; le PAGINE che generano i PDF sono di ogni cliente — ChouChou si e'
 * scritto `/print/menu` e `/print/lunch`, un altro avra' i suoi. Il ponte fra
 * i due strati e' un campo solo, `route`.
 *
 * ⚠️ Questo file sta separato da `printRoutes.ts` per un motivo preciso: li'
 * c'e' `import.meta.glob`, che Vite risolve in un oggetto di import pigri
 * verso le pagine del sito. Il pannello ha bisogno delle REGOLE anche nel
 * browser (per ricalcolare l'elenco dopo un clic, senza tornare al server), e
 * importarle da li' trascinerebbe quelle pagine nel pacchetto del browser.
 * Stessa divisione di `sedeRegole.ts` accanto a `sede.ts`.
 */

export interface PaginaStampa {
  /** Nome del file senza estensione: `lunch` per `/src/pages/print/lunch.astro`. */
  slug: string;
  /** La rotta pubblica che genera il PDF: `/print/lunch`. */
  route: string;
}

export interface ConfrontoStampa {
  /** Pagine che esistono nel sito ma non sono ancora a catalogo. */
  nuove: PaginaStampa[];
  /** Slug a catalogo la cui pagina non esiste (piu'): l'anteprima darebbe 404. */
  senzaPagina: string[];
}

/** Come lo slug dei prodotti: minuscole, cifre e trattini. */
const NOME_OK = /^[a-z0-9-]{1,40}$/;

/**
 * Dai percorsi dei file alle pagine. E' la parte che si puo' provare: il glob
 * non si prova, perche' il motore non ha nessuna pagina `/print/` propria.
 */
export function derivaPagine(percorsi: string[]): PaginaStampa[] {
  const viste = new Set<string>();
  const fuori: PaginaStampa[] = [];
  for (const p of percorsi) {
    const m = /\/src\/pages\/print\/([^/]+)\.astro$/.exec(p);
    if (!m) continue;
    const slug = m[1].toLowerCase();
    // ⚠️ Le rotte dinamiche (`[qualcosa].astro`) cadono qui, ed e' voluto:
    // senza un parametro non esiste un URL da anteprimare, e l'iframe del
    // pannello mostrerebbe un 404 al ristoratore.
    if (!NOME_OK.test(slug) || viste.has(slug)) continue;
    viste.add(slug);
    fuori.push({ slug, route: `/print/${slug}` });
  }
  return fuori.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Confronta il catalogo con le pagine trovate.
 *
 * ⚠️ Si confrontano le ROTTE, non gli slug. Nel seed il prodotto
 * `business-cards` punta a `/print/businesscard`: slug del prodotto e nome del
 * file non coincidono, e non devono essere costretti a coincidere.
 */
export function confrontaCatalogo(
  catalogo: { slug: string; route: string }[],
  pagine: PaginaStampa[],
): ConfrontoStampa {
  const rotteEsistenti = new Set(pagine.map((p) => p.route));
  const rotteACatalogo = new Set(catalogo.map((p) => p.route).filter(Boolean));
  return {
    nuove: pagine.filter((p) => !rotteACatalogo.has(p.route)),
    senzaPagina: catalogo.filter((p) => p.route && !rotteEsistenti.has(p.route)).map((p) => p.slug),
  };
}
