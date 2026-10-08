/**
 * TESTO DENTRO HTML — da un posto solo.
 *
 * Ogni volta che una riga di elenco si costruisce con `innerHTML`, il nome
 * che ci finisce dentro e' testo di qualcuno: il nome di una categoria, il
 * titolo di una scheda Google, l'email di un utente. Un apice o un `<`
 * basta a rompere il markup, e con un po' di sfortuna a far eseguire
 * qualcosa.
 *
 * ⚠️ La funzione esisteva QUATTRO volte nella sola pagina super, con TRE
 * implementazioni diverse — e una dimenticava l'apostrofo. Nel resto del
 * progetto le copie sono una quarantina. Le pagine si convertono quando le
 * si tocca, non tutte insieme: questo file e' la destinazione.
 *
 * I cinque caratteri sono quelli che contano dentro un attributo quotato o
 * in mezzo al testo. Il risultato va in `innerHTML`: messo in `textContent`
 * si leggerebbe «&#39;» al posto dell'apostrofo.
 */
const MAPPA: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => MAPPA[c]);
}
