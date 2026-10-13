/**
 * EDITOR DI TESTO RICCO — il comportamento, in un posto solo.
 *
 * Grassetto, corsivo, H2, H3, link. Niente di piu': e' quello che serve per
 * una descrizione d'evento e per una newsletter, e ogni tasto in piu' e' un
 * tag in piu' da far sopravvivere a Outlook.
 *
 * ⚠️ Era dentro `agenda.astro`. Quando la newsletter ha avuto bisogno dello
 * stesso editor (13/10/2026) la scelta era copiarlo o tirarlo fuori: due
 * editor che si somigliano oggi si allontanano al primo difetto corretto in
 * uno solo dei due.
 *
 * Lo stile sta in `styles/rte.css` (caricato da AdminHead), la lista bianca
 * del contenuto in `lib/htmlRicco.ts`.
 *
 * ⚠️ `document.execCommand` e' deprecato e non ha un sostituto: l'alternativa
 * e' scrivere a mano la gestione della selezione, cioe' qualche centinaio di
 * righe e i difetti che vengono con loro. Funziona in tutti i browser che i
 * clienti usano, e il giorno che smettesse il punto da riscrivere e' questo,
 * uno.
 */
import { pulisciHtml, testoNudo } from "../htmlRicco";

export interface TitoliRte {
  bold: string;
  italic: string;
  h2: string;
  h3: string;
  /** Elenco puntato. */
  lista: string;
  /** Elenco numerato. */
  listaNum: string;
  /** Centra il blocco (e lo rimette a sinistra se gia' centrato). */
  centra: string;
  link: string;
  unlink: string;
  /** La domanda quando si chiede l'indirizzo di un link. */
  promptLink: string;
}

const escAttr = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Il markup dell'editor: barra dei tasti + riquadro scrivibile.
 *
 * `classi` e `dati` servono a chi ne monta piu' di uno (l'agenda ne fa uno
 * per lingua e li ritrova con `data-lang`).
 */
export function markupRte(o: {
  titoli: TitoliRte;
  segnaposto: string;
  /** Classi extra sul riquadro scrivibile. */
  classi?: string;
  /** Attributi `data-*` sul riquadro, es. `{ lang: "fr" }`. */
  dati?: Record<string, string>;
  /**
   * ⚠️ Il nome del campo per chi legge lo schermo con la voce. Un
   * `contenteditable` NON e' un `<input>`: una `<label for>` non lo
   * raggiunge, e senza questo il campo si annuncia come un riquadro senza
   * nome.
   */
  aria?: string;
}): string {
  const t = o.titoli;
  const dati = Object.entries(o.dati ?? {})
    .map(([k, v]) => ` data-${k}="${escAttr(v)}"`)
    .join("");
  const b = (cmd: string, titolo: string, etichetta: string) =>
    `<button type="button" class="rte-b" data-cmd="${cmd}" title="${escAttr(titolo)}" aria-label="${escAttr(titolo)}">${etichetta}</button>`;
  return (
    `<div class="rte">` +
      `<div class="rte-tb">` +
        b("bold", t.bold, "<b>B</b>") +
        b("italic", t.italic, "<i>I</i>") +
        b("h2", t.h2, "H2") +
        b("h3", t.h3, "H3") +
        b("lista", t.lista, "•─") +
        b("listaNum", t.listaNum, "1─") +
        b("centra", t.centra, "≡") +
        b("link", t.link, "🔗") +
        b("unlink", t.unlink, "⤫") +
      `</div>` +
      `<div class="rte-ed${o.classi ? " " + o.classi : ""}" contenteditable="true" role="textbox" aria-multiline="true"${o.aria ? ` aria-label="${escAttr(o.aria)}"` : ""}${dati} data-ph="${escAttr(o.segnaposto)}"></div>` +
    `</div>`
  );
}

/**
 * Il blocco in cui sta il cursore — paragrafo, titolo o voce di elenco.
 *
 * ⚠️ Ci si ferma al riquadro: salendo oltre si finirebbe ad allineare il
 * modale che lo contiene.
 */
const BLOCCHI = new Set(["P", "H2", "H3", "LI", "UL", "OL", "DIV"]);
function bloccoCorrente(ed: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  let n: Node | null = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null;
  while (n && n !== ed) {
    if (n.nodeType === 1 && BLOCCHI.has((n as HTMLElement).tagName)) return n as HTMLElement;
    n = n.parentNode;
  }
  return null;
}

function esegui(ed: HTMLElement, cmd: string, promptLink: string): void {
  ed.focus();
  if (cmd === "bold" || cmd === "italic") {
    document.execCommand(cmd, false);
    return;
  }
  if (cmd === "h2" || cmd === "h3") {
    let blocco = "";
    try {
      blocco = String(document.queryCommandValue("formatBlock") || "").toLowerCase();
    } catch {
      /* non supportato: si tratta come «nessun blocco» */
    }
    // Premuto su un titolo che c'e' gia': lo si toglie. Senza questo, i tasti
    // H2/H3 sarebbero di sola andata.
    document.execCommand("formatBlock", false, blocco === cmd ? "P" : cmd.toUpperCase());
    return;
  }
  if (cmd === "lista") {
    // Rende <ul><li>: tag gia' nella lista bianca, niente da aggiungere.
    document.execCommand("insertUnorderedList", false);
    return;
  }
  if (cmd === "listaNum") {
    document.execCommand("insertOrderedList", false);
    return;
  }
  if (cmd === "centra") {
    /* ⚠️ NON `execCommand("justifyCenter")`. Quello scrive
       `style="text-align:center"` (o un `<div>`, secondo il browser), e lo
       `style` la lista bianca lo butta via: a schermo il testo si centrava,
       salvando tornava a sinistra, e nessuno capiva perche'. Qui si scrive
       `align`, che e' l'unico attributo che la ripulitura lascia passare
       (vedi `lib/htmlRicco.ts`). */
    let blocco = bloccoCorrente(ed);
    if (!blocco) {
      document.execCommand("formatBlock", false, "P");
      blocco = bloccoCorrente(ed);
    }
    if (!blocco) return;
    // Premuto su un blocco gia' centrato: lo rimette a sinistra.
    if (blocco.getAttribute("align") === "center") blocco.removeAttribute("align");
    else blocco.setAttribute("align", "center");
    return;
  }
  if (cmd === "unlink") {
    document.execCommand("unlink", false);
    return;
  }
  if (cmd === "link") {
    const url = window.prompt(promptLink, "https://");
    if (url == null) return;
    const u = url.trim();
    if (!u) {
      document.execCommand("unlink", false);
      return;
    }
    document.execCommand("createLink", false, u);
  }
}

/**
 * Attacca i tasti (e l'incolla ripulito) a TUTTI gli editor dentro `radice`.
 *
 * Si ascolta la radice e non ogni editor, cosi' funziona anche con i
 * riquadri creati dopo (l'agenda li rifa a ogni cambio di lingue).
 */
export function collegaRte(radice: HTMLElement, titoli: TitoliRte): void {
  // Senza questo l'Invio produce <div>, che non e' nella lista bianca: il
  // testo arriverebbe tutto attaccato.
  try {
    document.execCommand("defaultParagraphSeparator", false, "p");
  } catch {
    /* non supportato */
  }

  /* ⚠️ `mousedown` + `preventDefault`, non `click`: premendo un tasto il
     riquadro perderebbe il fuoco PRIMA del click, e con lui la selezione —
     cioe' il grassetto si applicherebbe a niente. */
  radice.addEventListener("mousedown", (e) => {
    const b = (e.target as HTMLElement).closest(".rte-b") as HTMLElement | null;
    if (!b) return;
    e.preventDefault();
    const ed = b.closest(".rte")?.querySelector(".rte-ed") as HTMLElement | null;
    if (ed && b.dataset.cmd) esegui(ed, b.dataset.cmd, titoli.promptLink);
  });

  /**
   * ⚠️ L'INCOLLA. Mancava, e si vede solo quando capita: un testo copiato da
   * Word o da una pagina web porta dentro `<span style>`, `<font>`, classi
   * e a volte mezzo foglio di stile Microsoft. Il server lo ripulisce
   * comunque, ma troppo tardi: a schermo sembrava tutto a posto e l'email
   * usciva diversa da quello che si era visto.
   *
   * Si incolla il MINIMO che conserva il senso: la lista bianca sul
   * frammento HTML, o il testo nudo se l'HTML non c'e'.
   */
  radice.addEventListener("paste", (e) => {
    const ed = (e.target as HTMLElement | null)?.closest(".rte-ed") as HTMLElement | null;
    if (!ed) return;
    const dati = (e as ClipboardEvent).clipboardData;
    if (!dati) return;
    e.preventDefault();
    const html = dati.getData("text/html");
    const testo = dati.getData("text/plain");
    const pulito = html
      ? pulisciHtml(html, 20000)
      : testoNudo(testo).length === testo.trim().length
        ? testo.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>")
        : "";
    document.execCommand("insertHTML", false, pulito || testo);
  });
}
