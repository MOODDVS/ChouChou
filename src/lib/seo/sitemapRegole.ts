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
  // ⚠️ LE PAGINE DI STAMPA (`/print/menu`, `/print/setdetable`…) portano
  // gia' `noindex`: sono un PDF da mandare in tipografia, non una pagina da
  // trovare. Restavano pero' in sitemap — e una sitemap che consegna a
  // Google un indirizzo che poi gli dice di non indicizzare e' esattamente
  // l'avviso «Inviata, ma con tag noindex» documentato qui sotto per
  // /feedback. Verificato leggendo @astrojs/sitemap 3.7.4: la sitemap
  // unisce le pagine COSTRUITE e TUTTE le rotte di tipo `page`, quindi una
  // pagina `prerender = false` ci finisce lo stesso (11/10/2026).
  "/print",
];

/**
 * Pagine che restano fuori QUALUNQUE sia il prefisso di lingua.
 *
 * ⚠️ Qui si guarda l'ULTIMO PEZZO del percorso, non l'inizio, e non e' un
 * vezzo: la proposta diceva di elencare `/order-confirm` e `/en/order-confirm`.
 * Ma L'Huile ha `/it/` e `/nl/`, Educazione Napoletana ha `/it/`: con un
 * elenco di inizi, due clienti si sarebbero tenuti in sitemap le pagine di
 * ritorno da Stripe in italiano e in olandese. Il motore non sa quali lingue
 * ha un cliente, e non deve saperlo.
 *
 * Sono pagine dove si ARRIVA dopo aver pagato, con un id di sessione
 * nell'URL: in ricerca non ci vanno, e senza quell'id non mostrano niente.
 */
export const PAGINE_FUORI_SITEMAP: readonly string[] = [
  "order-confirm", // ritorno da Stripe dopo il pagamento
  "order-cancel", //  ritorno da Stripe se il cliente rinuncia
  "404", //           la pagina d'errore non e' un contenuto
  // ⚠️ Ci si arriva SOLO dalle stelle 1-3 dell'email recensione, e la pagina
  // porta gia' `noindex`. Restava pero' in sitemap: quattro clienti su
  // quattro consegnavano a Google una pagina che poi le dice di non
  // indicizzare — in Search Console «Inviata, ma con tag noindex»
  // (29/09/2026). Qui si guarda l'ultimo pezzo, quindi vale anche per
  // /en/feedback, /it/feedback e /nl/feedback in un colpo solo.
  "feedback",
  // ⚠️ `/links` e' la stessa navigazione del sito in un'altra forma, per il
  // QR e la biografia Instagram: la pagina porta `noindex` da sempre (lo
  // dice il suo commento), ma nessuno l'aveva tolta dalla sitemap. Qui, e
  // non in `FUORI_SITEMAP`, perche' si guarda l'ultimo pezzo: cosi' vale
  // anche per /en/links, /it/links e /nl/links in un colpo solo.
  "links",
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

/**
 * `true` se l'URL puo' stare in sitemap. Accetta un URL intero o un path.
 *
 * ⚠️ `/order` NON E' IN NESSUNA DELLE DUE LISTE, ed e' una scelta.
 *
 * E' una pagina vera il giorno che il ristorante prende ordini, e una pagina
 * `noindex` finche' non li prende. Una riga fissa qui la terrebbe fuori
 * dalla sitemap anche dopo, e quel giorno nessuno verrebbe a rileggere
 * questo file. Il motore non puo' saperlo da solo — quel `noindex` e' una
 * proprieta' che la PAGINA passa al telaio — quindi finche' gli ordini sono
 * spenti Search Console segnala «Inviata, ma con tag noindex» su /order.
 * E' un avviso, non un errore: sparisce da solo quando si accende la presa
 * d'ordine. Chi non lo vuole vedere toglie il `noindex` dalla pagina: dice
 * «arriva presto, intanto telefonate», ed e' una risposta utile a chi cerca.
 */
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
  if (FUORI_SITEMAP.some((v) => pulito === v || pulito.startsWith(`${v}/`))) return false;
  // ⚠️ Il pezzo INTERO, non «inizia con»: una pagina `/order-confirmation`
  // del cliente non c'entra niente e deve restare in sitemap.
  const ultimo = pulito.slice(pulito.lastIndexOf("/") + 1);
  return !PAGINE_FUORI_SITEMAP.includes(ultimo);
}
