/**
 * QUALI URL ENTRANO NELLA SITEMAP — regole pure, nessun import.
 *
 * ⚠️ IL GUASTO CHE QUESTO FILE CHIUDE (21/09/2026)
 *
 * `sitemap()` era senza filtro, e una sitemap comprende OGNI pagina che il
 * progetto sa costruire. La sitemap del motore conteneva **15 URL `/admin/`
 * su 29**: `/admin/orders`, `/admin/stats`, `/admin/super`…
 *
 * Non e' un problema teorico. Quegli URL rispondono con un 302 al login,
 * quindi ogni cliente stava consegnando a Google un elenco di pagine che
 * reindirizzano — in Search Console diventano errori «Pagina con
 * reindirizzamento» — e lasciava la pagina di login del pannello
 * indicizzabile sul dominio del ristorante. Su 5 clienti, 4 non avevano
 * nemmeno un `Disallow: /admin` in robots.txt.
 *
 * Una sitemap dice a Google «queste sono le pagine che voglio in ricerca».
 * Il pannello non lo e'.
 *
 * ⚠️ Sta in `src/lib/` (che il merge porta ai clienti) e NON in
 * `astro.config.mjs` (che e' `merge=ours` e non arriva). Nel cliente resta
 * da scrivere a mano la sola riga che lo aggancia — vedi PRESTAZIONI.md.
 */

/**
 * Prefissi che NON vanno in sitemap. Ognuno con la sua ragione: se un giorno
 * la ragione non vale piu', si toglie la riga, non si aggira il filtro.
 */
export const FUORI_SITEMAP: readonly string[] = [
  "/admin", //              il pannello: risponde 302 al login
  "/reservation-embed", //  pensata per stare dentro un iframe
  "/reservation-test", //   banco di prova
  "/order/cancel", //       si arriva qui solo dal proprio link firmato
  "/reservation/cancel", // idem
];

/**
 * ⚠️ QUI NON C'E' `/demo01`, e non e' una dimenticanza.
 *
 * La prima stesura ce l'aveva, e la prova «il motore non nomina un demo in
 * una DECISIONE» (tests/motore.test.mjs) e' andata rossa subito. Aveva
 * ragione lei: un demo nominato nel motore significa che il secondo demo si
 * aggiunge toccando il motore, e che nel cliente che l'ha cancellato resta
 * una riga morta che nessuno sa piu' a cosa serviva.
 *
 * E non serve: il cliente che cancella `demo01` non ha niente da escludere,
 * quello che lo tiene lo chiude in `robots.txt` (che e' un file per-cliente),
 * e il motore un sito non ce l'ha — vedi tests/motore.test.mjs.
 */

/** `true` se l'URL puo' stare in sitemap. Accetta un URL intero o un path. */
export function inSitemap(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  if (!path.startsWith("/")) path = `/${path}`;
  // `/admin/` e `/admin` sono la stessa cosa: la sitemap scrive la barra finale.
  const pulito = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return !FUORI_SITEMAP.some((v) => pulito === v || pulito.startsWith(`${v}/`));
}
