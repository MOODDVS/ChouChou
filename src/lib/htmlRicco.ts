/**
 * TESTO RICCO — ripulitura, e messa in forma per l'email.
 *
 * ⚠️ PERCHE' STA QUI. Questa ripulitura esisteva dal 10/2026 per la
 * descrizione lunga degli eventi, ma viveva DENTRO
 * `pages/api/admin/agenda.ts`: una difesa anti-XSS in fondo a un file di
 * API, senza una riga di prove. Quando la newsletter ha avuto bisogno dello
 * stesso editor (13/10/2026) la scelta era copiarla o tirarla fuori.
 * Copiarla voleva dire due liste bianche che si allontanano a ogni
 * correzione — e una lista bianca che si allontana e' un buco.
 *
 * ⚠️ REGOLE PURE, NESSUN IMPORT: entra una stringa, esce una stringa. Si
 * provano con node, senza un database ne' un browser. E' quello che
 * permette di provare «javascript:alert(1) viene scartato» in mezzo
 * secondo, cioe' di provarlo davvero.
 *
 * Tre funzioni, tre usi:
 *  - `pulisciHtml`   quello che si SALVA (lista bianca, link disinnescati);
 *  - `messaggioEmail` quello che si SPEDISCE (stili in linea: le email non
 *                     leggono i fogli di stile);
 *  - `testoNudo`     quello che si MOSTRA in un'anteprima di due righe.
 */

/**
 * ⚠️ LISTA BIANCA, volutamente minima: grassetto, corsivo, sottolineato,
 * titoli, paragrafi, a-capo, liste e link. Tutto il resto esce (il TESTO
 * resta). Una lista nera sarebbe il contrario: bisognerebbe indovinare in
 * anticipo tutti i modi di scrivere uno script, e ne basta uno dimenticato.
 */
const TAG_HTML_OK = new Set(["b", "strong", "i", "em", "u", "h2", "h3", "p", "br", "ul", "ol", "li", "a"]);

/**
 * ⚠️ L'UNICO ATTRIBUTO CHE SOPRAVVIVE OLTRE A `href`, e solo su un blocco.
 *
 * Centrare il testo vuol dire salvare da qualche parte «questo blocco e'
 * centrato», e la regola di sopra butta via tutti gli attributi. Delle due
 * strade possibili:
 *  - `style="text-align:center"`: vorrebbe far passare `style`, cioe' la
 *    porta da cui entrano `background:url(javascript:...)` e compagnia;
 *  - `align="center"`: un attributo deprecato in HTML, che pero' prende UN
 *    SOLO valore da un elenco chiuso e non puo' contenere altro.
 * Vince il secondo, ed e' anche quello che Outlook (motore Word) rispetta
 * meglio: `messaggioEmail` lo traduce comunque in `text-align` in linea per
 * tutti gli altri.
 */
const ALLINEAMENTI = new Set(["left", "center", "right"]);
const TAG_ALLINEABILI = new Set(["p", "h2", "h3", "ul", "ol", "li"]);

/** L'allineamento di un tag, se e' uno dei tre ammessi. */
export function allineamentoDi(attributi: string): string | null {
  const m = /align\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributi);
  const v = (m ? (m[2] ?? m[3] ?? m[4] ?? "") : "").trim().toLowerCase();
  return ALLINEAMENTI.has(v) ? v : null;
}

/** Solo schemi che non eseguono niente: `javascript:` e `data:` fuori. */
export function schemaHrefSicuro(href: string): string | null {
  const h = href.trim();
  if (/^(https?:|mailto:|tel:)/i.test(h)) return h;   // schemi consentiti
  if (/^\/\//.test(h)) return "https:" + h;           // protocol-relative → https
  if (/^\/(?!\/)/.test(h)) return h;                  // path relativo del sito
  return null;                                        // javascript:, data:, ecc. → scartato
}

/**
 * Ripulisce l'HTML che arriva da un editor (o da un incolla da Word).
 *
 * ⚠️ `maxLen` taglia alla fine: un testo enorme non e' solo brutto, e' una
 * email che i gestori di posta troncano a meta' o rifiutano.
 */
export function pulisciHtml(grezzo: unknown, maxLen: number): string {
  let s = String(grezzo ?? "");
  if (!s) return "";
  s = s.replace(/\u0000/g, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");                                        // commenti
  s = s.replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, ""); // elementi pericolosi col contenuto
  s = s.replace(/<\/?(script|style|iframe|object|embed)[^>]*>/gi, "");           // tag pericolosi residui
  s = s.replace(/<[^>]*>/g, (tag) => {
    const m = /^<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>$/.exec(tag);
    if (!m) return "";
    const chiuso = m[1] === "/";
    const nome = m[2].toLowerCase();
    if (!TAG_HTML_OK.has(nome)) return "";                     // non consentito → via (testo resta)
    if (chiuso) return `</${nome}>`;
    if (nome === "br") return "<br>";
    if (nome === "a") {
      const hm = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3]);
      const raw = hm ? (hm[2] ?? hm[3] ?? hm[4] ?? "") : "";
      const safe = schemaHrefSicuro(raw);
      if (!safe) return "";                                    // link non valido → via l'apertura
      const href = safe.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">`;
    }
    if (TAG_ALLINEABILI.has(nome)) {
      const all = allineamentoDi(m[3]);
      if (all) return `<${nome} align="${all}">`;              // l'unico attributo che resta
    }
    return `<${nome}>`;                                        // consentito: nessun altro attributo
  });
  return s.trim().slice(0, maxLen);
}

/** Il testo e basta, per un'anteprima o per il `title` di una card. */
export function testoNudo(grezzo: unknown): string {
  return String(grezzo ?? "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(br|\/p|\/h2|\/h3|\/li)\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * ⚠️ VERO O NO: c'e' dentro del formato, o e' testo scritto a mano?
 *
 * Serve per le newsletter di PRIMA dell'editor: sono righe di testo con
 * degli a-capo, salvate quando il campo era una textarea. Trattarle come
 * HTML le appiattirebbe in un unico blocco — e sono in archivio, quindi
 * ricompaiono ogni volta che qualcuno rilancia un invio passato.
 */
function haFormato(s: string): boolean {
  return /<(p|br|h2|h3|ul|ol|li|b|strong|i|em|u|a)\b[^>]*>/i.test(s);
}

export interface ColoriMessaggio {
  /** Il colore del testo nel tema del cliente. */
  testo: string;
  /** Il colore dei link (l'accento del marchio). */
  accento: string;
}

/**
 * IL MESSAGGIO COM'E' DENTRO L'EMAIL.
 *
 * ⚠️ GLI STILI VANNO IN LINEA, uno per tag. Non e' pignoleria: Gmail elimina
 * i blocchi `<style>` dalla posta, e Outlook (motore Word) ignora quasi
 * tutto quello che non e' scritto sull'elemento. Un `<p>` senza `margin`
 * esplicito in Outlook prende il margine di Word e i paragrafi si
 * incollano; una lista senza `margin-left` perde il rientro. Quindi qui si
 * riscrive ogni tag ammesso con la sua misura.
 *
 * ⚠️ Ripassa SEMPRE da `pulisciHtml`, anche se chi chiama l'ha gia' fatto:
 * questa funzione e' l'ultimo posto prima che il testo diventi un'email
 * spedita a tutta la rubrica. Una difesa che si fida del chiamante vale
 * quanto il chiamante piu' distratto.
 */
export function messaggioEmail(grezzo: unknown, colori: ColoriMessaggio): string {
  const pulito = pulisciHtml(grezzo, 20000);
  if (!pulito) return "";

  // Vecchio formato: testo e a-capo. Resta com'era.
  if (!haFormato(pulito)) {
    /* ⚠️ `esc` e non `testoNudo`: quest'ultimo schiaccia ogni sequenza di
       spazi in uno solo — compresi gli a-capo, che qui sono l'UNICO formato
       che il messaggio ha. Usarlo qui cancellava i paragrafi delle vecchie
       newsletter invece di conservarli. */
    return `<p style="margin:16px 0 22px;color:${colori.testo};font-size:15px;line-height:1.7;text-align:left;">${
      esc(pulito).replace(/\r?\n/g, "<br>")
    }</p>`;
  }

  const STILI: Record<string, string> = {
    p: `margin:0 0 14px;color:${colori.testo};font-size:15px;line-height:1.7;text-align:left;`,
    h2: `margin:22px 0 8px;color:${colori.testo};font-size:19px;line-height:1.35;font-weight:bold;text-align:left;`,
    h3: `margin:18px 0 6px;color:${colori.testo};font-size:16px;line-height:1.4;font-weight:bold;text-align:left;`,
    ul: `margin:0 0 14px;padding:0 0 0 22px;color:${colori.testo};font-size:15px;line-height:1.7;text-align:left;`,
    ol: `margin:0 0 14px;padding:0 0 0 22px;color:${colori.testo};font-size:15px;line-height:1.7;text-align:left;`,
    li: "margin:0 0 6px;",
    a: `color:${colori.accento};text-decoration:underline;`,
  };

  const corpo = pulito.replace(/<([a-z0-9]+)((?:\s[^>]*)?)>/gi, (intero, nome: string, resto: string) => {
    const tag = nome.toLowerCase();
    const stile = STILI[tag];
    if (!stile) return intero;
    /* ⚠️ Centrato: `align="center"` resta (Outlook lo rispetta), e in piu'
       si riscrive `text-align` nello stile in linea. Senza la seconda meta',
       lo stile scritto dopo vincerebbe sull'attributo e il blocco tornerebbe
       a sinistra nei client che leggono il CSS — cioe' quasi tutti. */
    const all = allineamentoDi(resto);
    const conAllineamento = all ? stile.replace(/text-align:[a-z]+;/, `text-align:${all};`) : stile;
    const finale = all && !/text-align:/.test(conAllineamento) ? `${conAllineamento}text-align:${all};` : conAllineamento;
    return `<${tag}${resto} style="${finale}">`;
  });

  // Un testo che inizia senza paragrafo (l'editor a volte rende la prima
  // riga nuda) resterebbe senza colore ne' misura: lo si avvolge.
  return /^\s*<(p|h2|h3|ul|ol)\b/i.test(corpo)
    ? `<div style="margin:16px 0 22px;">${corpo}</div>`
    : `<div style="margin:16px 0 22px;color:${colori.testo};font-size:15px;line-height:1.7;text-align:left;">${corpo}</div>`;
}
