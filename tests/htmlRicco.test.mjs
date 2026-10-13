/**
 * TESTO RICCO — la lista bianca, e il messaggio dentro l'email.
 *
 * ⚠️ Questa ripulitura difende da XSS stored dal 10/2026 e non aveva UNA
 * prova. Viveva in fondo a `pages/api/admin/agenda.ts`: nessuno la vedeva,
 * quindi nessuno la provava, quindi un «miglioramento» alla lista bianca
 * poteva aprire un buco senza che niente si lamentasse. Dal 13/10/2026 sta
 * in `lib/htmlRicco.ts` perche' la usano in due (eventi e newsletter), e
 * queste sono le prove che prima mancavano.
 *
 * ⚠️ Cosa difende, in concreto: il testo lo scrive lo staff del ristorante,
 * ma finisce (a) sul sito pubblico, nella pagina di un evento, e (b) in
 * un'email spedita a TUTTA la rubrica dal dominio verificato del
 * ristorante. Uno script che passa di qui non e' un fastidio: e' il
 * dominio del cliente che smette di essere affidabile.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { pulisciHtml, testoNudo, messaggioEmail, schemaHrefSicuro, allineamentoDi } from "../src/lib/htmlRicco.ts";

const COLORI = { testo: "#222222", accento: "#dfab4e" };

/* ---------------------------- LA LISTA BIANCA ---------------------------- */

test("il formato che serve passa", () => {
  const dentro = "<p>Ciao <b>Marco</b> e <em>benvenuto</em></p><h2>Menu</h2><ul><li>Pizza</li></ul>";
  assert.equal(pulisciHtml(dentro, 5000), dentro);
});

test("⚠️ lo script non passa, e il testo resta", () => {
  // Il testo resta di proposito: togliere anche il contenuto farebbe
  // sparire pezzi di messaggio scritti in buona fede, e chi scrive non
  // capirebbe perche'.
  assert.equal(pulisciHtml('<p>Ciao</p><script>alert(1)</script>', 5000), "<p>Ciao</p>");
  assert.equal(pulisciHtml('<p>A</p><style>body{display:none}</style>', 5000), "<p>A</p>");
  assert.equal(pulisciHtml('<iframe src="http://x"></iframe><p>B</p>', 5000), "<p>B</p>");
  assert.doesNotMatch(pulisciHtml('<img src=x onerror="alert(1)">Foto', 5000), /onerror|img/i);
});

test("⚠️ gli attributi se ne vanno TUTTI, tranne href sui link", () => {
  // Un `onclick` o uno `style` lasciato passare e' esattamente il buco.
  assert.equal(pulisciHtml('<p onclick="alert(1)" style="color:red">X</p>', 5000), "<p>X</p>");
  assert.equal(pulisciHtml('<b class="x" data-y="z">X</b>', 5000), "<b>X</b>");
});

test("⚠️ `javascript:` e `data:` nei link vengono scartati", () => {
  assert.equal(schemaHrefSicuro("javascript:alert(1)"), null);
  assert.equal(schemaHrefSicuro("data:text/html,<script>"), null);
  assert.equal(schemaHrefSicuro("  https://ok.be/x "), "https://ok.be/x");
  assert.equal(schemaHrefSicuro("mailto:a@b.be"), "mailto:a@b.be");
  assert.equal(schemaHrefSicuro("//cdn.be/x"), "https://cdn.be/x", "protocol-relative in un'email va forzato a https");
  assert.equal(schemaHrefSicuro("/carte"), "/carte");
  // E dal lato della ripulitura: l'apertura del link sparisce, il testo no.
  const out = pulisciHtml('<a href="javascript:alert(1)">clicca</a>', 5000);
  assert.doesNotMatch(out, /javascript/i);
  assert.match(out, /clicca/);
});

test("un link buono esce disinnescato", () => {
  const out = pulisciHtml('<a href="https://450gradi.be/carte">Carta</a>', 5000);
  assert.match(out, /rel="noopener noreferrer nofollow"/, "senza rel, la pagina aperta puo' toccare quella che l'ha aperta");
  assert.match(out, /target="_blank"/);
  assert.match(out, /href="https:\/\/450gradi\.be\/carte"/);
});

test("il taglio di lunghezza c'e' (un'email enorme la posta la tronca)", () => {
  assert.equal(pulisciHtml("<p>" + "a".repeat(500) + "</p>", 50).length, 50);
});

test("niente dentro, niente fuori", () => {
  for (const v of [null, undefined, "", "   ", 0]) {
    assert.equal(pulisciHtml(v, 100), v === 0 ? "0" : "", `inciampo su ${JSON.stringify(v)}`);
  }
});

/* ------------------------------ IL TESTO NUDO ----------------------------- */

test("il testo nudo serve alle anteprime di due righe", () => {
  assert.equal(testoNudo("<h2>Menu</h2><p>Pizza <b>napoletana</b></p>"), "Menu Pizza napoletana");
  assert.equal(testoNudo("<p>A</p><p>B</p>"), "A B", "senza spazio fra i blocchi le parole si attaccano");
  assert.equal(testoNudo("uno<br>due"), "uno due");
  assert.equal(testoNudo("Caf&eacute; &amp; co"), "Caf&eacute; & co");
  assert.equal(testoNudo(null), "");
});

/* --------------------------- DENTRO L'EMAIL ------------------------------- */

test("⚠️ ogni tag esce con lo stile IN LINEA", () => {
  // Gmail butta via i blocchi <style>, Outlook ignora quasi tutto quello che
  // non e' scritto sull'elemento: un <p> senza margin esplicito incolla i
  // paragrafi, una <ul> senza padding perde il rientro.
  const out = messaggioEmail("<p>Ciao</p><h2>Titolo</h2><ul><li>Uno</li></ul>", COLORI);
  for (const [tag, atteso] of [["p", "margin:0 0 14px"], ["h2", "font-size:19px"], ["ul", "padding:0 0 0 22px"], ["li", "margin:0 0 6px"]]) {
    const m = new RegExp(`<${tag} style="[^"]*${atteso.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    assert.match(out, m, `<${tag}> esce senza il suo stile in linea`);
  }
  assert.match(out, /color:#222222/, "il colore del testo non e' quello del tema del cliente");
});

test("i link prendono il colore dell'accento del marchio", () => {
  const out = messaggioEmail('<p><a href="https://x.be">qui</a></p>', COLORI);
  assert.match(out, /<a href="https:\/\/x\.be"[^>]*style="[^"]*color:#dfab4e/);
});

test("⚠️ le newsletter SCRITTE PRIMA dell'editor restano leggibili", () => {
  // In archivio ci sono invii salvati quando il campo era una textarea:
  // testo e a-capo. Trattarli come HTML li appiattirebbe in un blocco solo,
  // e ricompaiono ogni volta che qualcuno rilancia un invio passato.
  const out = messaggioEmail("Bonsoir,\nce vendredi on ouvre a 18h.\nA bientot !", COLORI);
  assert.equal((out.match(/<br>/g) ?? []).length, 2, "gli a-capo del vecchio formato sono spariti");
  assert.match(out, /Bonsoir,/);
  assert.doesNotMatch(out, /<p[^>]*>[\s\S]*<p/, "il vecchio formato resta un paragrafo solo");
});

test("⚠️ lo script non arriva nell'email nemmeno se chi chiama si distrae", () => {
  // `messaggioEmail` ripassa da `pulisciHtml` di proposito: e' l'ultimo
  // posto prima di un invio a tutta la rubrica, e una difesa che si fida
  // del chiamante vale quanto il chiamante piu' distratto.
  const out = messaggioEmail('<p>Ciao</p><script>alert(1)</script><p onclick="x">B</p>', COLORI);
  assert.doesNotMatch(out, /script|onclick/i);
  assert.match(out, /Ciao/);
});

test("un messaggio vuoto non lascia un blocco vuoto nell'email", () => {
  assert.equal(messaggioEmail("", COLORI), "");
  assert.equal(messaggioEmail("   ", COLORI), "");
  assert.equal(messaggioEmail(null, COLORI), "");
});

/* ------------------------- L'ALLINEAMENTO -------------------------------- */

test("⚠️ `align` passa, ma SOLO con uno dei tre valori", () => {
  // E' l'unico attributo che la lista bianca lascia entrare oltre a `href`:
  // vale la pena guardarlo da vicino.
  assert.equal(allineamentoDi(' align="center"'), "center");
  assert.equal(allineamentoDi(" align=right"), "right");
  assert.equal(allineamentoDi(" ALIGN='LEFT'"), "left");
  assert.equal(allineamentoDi(' align="justify"'), null, "un valore fuori elenco non deve passare");
  assert.equal(allineamentoDi(' align="center; background:url(javascript:alert(1))"'), null);
  assert.equal(allineamentoDi(' class="x"'), null);
});

test("⚠️ il centrato sopravvive al salvataggio", () => {
  // Il difetto che questa prova impedisce: `execCommand(\"justifyCenter\")`
  // scrive `style=\"text-align:center\"`, lo `style` viene buttato via, e il
  // testo si centra a schermo ma torna a sinistra appena si salva.
  assert.equal(pulisciHtml('<p align="center">Ciao</p>', 5000), '<p align="center">Ciao</p>');
  assert.equal(pulisciHtml('<h2 align="center">Titolo</h2>', 5000), '<h2 align="center">Titolo</h2>');
});

test("⚠️ `align` non diventa una porta per gli altri attributi", () => {
  assert.equal(pulisciHtml('<p align="center" onclick="alert(1)">X</p>', 5000), '<p align="center">X</p>');
  assert.equal(pulisciHtml('<p align="center" style="background:red">X</p>', 5000), '<p align="center">X</p>');
  // E su un tag che non e' un blocco non serve a niente, quindi non passa.
  assert.equal(pulisciHtml('<b align="center">X</b>', 5000), "<b>X</b>");
});

test("⚠️ nell'email il centrato c'e' due volte: attributo E stile", () => {
  // `align` perche' Outlook (motore Word) lo rispetta; `text-align` in linea
  // perche' nei client che leggono il CSS lo stile scritto dopo vincerebbe
  // sull'attributo, e il blocco tornerebbe a sinistra.
  const out = messaggioEmail('<p align="center">Ciao</p>', COLORI);
  assert.match(out, /align="center"/);
  assert.match(out, /style="[^"]*text-align:center/);
  assert.doesNotMatch(out, /text-align:left/, "lo stile a sinistra e' rimasto e vince su align");
});

test("gli elenchi arrivano nell'email col loro rientro", () => {
  const out = messaggioEmail("<ul><li>Pizza</li><li>Pasta</li></ul>", COLORI);
  assert.match(out, /<ul style="[^"]*padding:0 0 0 22px/, "senza padding esplicito Outlook perde il rientro");
  assert.match(out, /<li style="[^"]*margin:0 0 6px/);
  const num = messaggioEmail("<ol><li>Primo</li></ol>", COLORI);
  assert.match(num, /<ol style="/);
});
